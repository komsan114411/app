// routes/auth.js — login / refresh / logout with timing-safety + atomic rotation.

import { Router } from 'express';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import {
  signAccess, issueRefresh, rotateRefresh, revokeRefresh, revokeAllForUser,
} from '../utils/tokens.js';
import { loginLimiter, loginBurstLimiter } from '../middleware/rateLimit.js';
import { validate, loginBody } from '../middleware/validate.js';
import { rotateCsrfCookie } from '../middleware/csrf.js';
import { hashIp, safeText } from '../utils/sanitize.js';
import { env } from '../config/env.js';
import { log } from '../utils/logger.js';

export const authRouter = Router();

export const REFRESH_COOKIE = env.COOKIE_SECURE ? '__Secure-refresh_token' : 'refresh_token';

const refreshCookieOpts = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api/auth',
  domain: env.COOKIE_DOMAIN || undefined,
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

const GENERIC_LOGIN_FAIL = { error: 'invalid_credentials' };

authRouter.post('/login', loginBurstLimiter, loginLimiter, validate(loginBody), async (req, res) => {
  const { email, password } = req.body;
  const ipHash = hashIp(req.ip);
  const ua = safeText(req.get('user-agent') || '', 200);

  const user = await User.findOne({ email }).select('+passwordHash +failedLoginCount +lockUntil');

  // Branch A: user not found → verify against dummy hash (same time), return generic.
  if (!user) {
    await User.verifyDummy(password);
    await AuditLog.create({ actorEmail: email, action: 'login_unknown', outcome: 'failure', ipHash, userAgent: ua });
    return res.status(401).json(GENERIC_LOGIN_FAIL);
  }

  // Branch B: user disabled or locked → still run verify to equalize timing.
  const inactive = !!user.disabledAt;
  const locked = user.isLocked();
  const ok = await user.verifyPassword(password);

  if (inactive || locked || !ok) {
    if (!inactive && !locked && !ok) await User.atomicRecordFail(user._id);
    await AuditLog.create({
      actorId: user._id,
      actorEmail: user.email,
      action: inactive ? 'login_disabled' : locked ? 'login_locked' : 'login_fail',
      outcome: 'failure',
      ipHash, userAgent: ua,
    });
    return res.status(401).json(GENERIC_LOGIN_FAIL);
  }

  // Success path
  const fresh = await User.atomicRecordSuccess(user._id, req.ip, /*bumpTokenVersion*/ false);
  const accessToken = signAccess(fresh);
  const { token: refresh } = await issueRefresh(fresh, { ip: req.ip, userAgent: ua });

  res.cookie(REFRESH_COOKIE, refresh, refreshCookieOpts());
  rotateCsrfCookie(res);
  await AuditLog.create({ actorId: user._id, actorEmail: user.email, action: 'login_success', ipHash, userAgent: ua });

  res.json({
    accessToken,
    user: { id: String(user._id), email: user.email, role: user.role },
  });
});

authRouter.post('/refresh', async (req, res) => {
  const raw = req.cookies && req.cookies[REFRESH_COOKIE];
  if (!raw) return res.status(401).json({ error: 'no_refresh' });

  const result = await rotateRefresh(raw, { ip: req.ip, userAgent: req.get('user-agent') });

  if (!result) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth', domain: env.COOKIE_DOMAIN || undefined });
    return res.status(401).json({ error: 'invalid_refresh' });
  }

  if (result.reuse) {
    log.warn({ ip: req.ip, userId: String(result.userId) }, 'refresh_reuse_detected');
    await revokeAllForUser(result.userId, 'reuse_detected');
    await User.findOneAndUpdate({ _id: result.userId }, { $inc: { tokenVersion: 1 } });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth', domain: env.COOKIE_DOMAIN || undefined });
    return res.status(401).json({ error: 'invalid_refresh' });   // same code as other fails
  }

  const user = await User.findById(result.userId);
  if (!user || user.disabledAt) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth', domain: env.COOKIE_DOMAIN || undefined });
    return res.status(401).json({ error: 'invalid_refresh' });
  }

  // Grace hit: the inbound token was just rotated within window. Don't revoke,
  // but we DO issue a fresh access token (no new refresh) so both tabs proceed.
  if (result.grace) {
    return res.json({ accessToken: signAccess(user) });
  }

  const { token: newRefresh } = await issueRefresh(user, { ip: req.ip, userAgent: req.get('user-agent') });
  res.cookie(REFRESH_COOKIE, newRefresh, refreshCookieOpts());
  rotateCsrfCookie(res);
  res.json({ accessToken: signAccess(user) });
});

authRouter.post('/logout', async (req, res) => {
  const raw = req.cookies && req.cookies[REFRESH_COOKIE];
  if (raw) await revokeRefresh(raw);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth', domain: env.COOKIE_DOMAIN || undefined });
  res.status(204).end();
});
