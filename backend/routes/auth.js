// routes/auth.js — login / refresh / logout + forgot password + 2FA verify.

import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import {
  signAccess, issueRefresh, rotateRefresh, revokeRefresh, revokeAllForUser,
} from '../utils/tokens.js';
import { verifyToken as verifyTotp, hashBackupCode } from '../utils/totp.js';
import { loginLimiter, loginBurstLimiter, forgotLimiter } from '../middleware/rateLimit.js';
import { enforceIpGuard, recordIpFailure, clearIpFailures } from '../middleware/ipGuard.js';
import { verifyCaptcha } from '../middleware/captcha.js';
import { validate, loginBody } from '../middleware/validate.js';
import { rotateCsrfCookie } from '../middleware/csrf.js';
import { hashIp, safeText } from '../utils/sanitize.js';
import { sendMail } from '../utils/email.js';
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

authRouter.post('/login', enforceIpGuard, loginBurstLimiter, loginLimiter, verifyCaptcha, validate(loginBody), async (req, res) => {
  const { loginId, password, totpCode, backupCode } = req.body;
  const ipHash = hashIp(req.ip);
  const ua = safeText(req.get('user-agent') || '', 200);

  const user = await User.findOne({ loginId })
    .select('+passwordHash +failedLoginCount +lockUntil +totpSecret +totpBackupCodes');

  if (!user) {
    await User.verifyDummy(password);
    await recordIpFailure(req, 'login_unknown');
    await AuditLog.create({ actorEmail: loginId, action: 'login_unknown', outcome: 'failure', ipHash, userAgent: ua });
    return res.status(401).json(GENERIC_LOGIN_FAIL);
  }

  const inactive = !!user.disabledAt;
  const locked = user.isLocked();
  const ok = await user.verifyPassword(password);

  if (inactive || locked || !ok) {
    if (!inactive && !locked && !ok) {
      await User.atomicRecordFail(user._id);
      await recordIpFailure(req, 'login_fail');
    }
    await AuditLog.create({
      actorId: user._id, actorEmail: user.loginId,
      action: inactive ? 'login_disabled' : locked ? 'login_locked' : 'login_fail',
      outcome: 'failure', ipHash, userAgent: ua,
    });
    return res.status(401).json(GENERIC_LOGIN_FAIL);
  }

  // 2FA challenge
  if (user.totpEnabled) {
    if (!totpCode && !backupCode) {
      return res.status(401).json({ error: 'totp_required' });
    }
    let totpOk = false;
    if (totpCode) totpOk = verifyTotp(user.totpSecret, totpCode);
    if (!totpOk && backupCode) {
      // Constant-time backup-code check. Array.prototype.includes stops at
      // the first match — so timing leaks which stored hash matches earliest.
      // We scan every code unconditionally with timingSafeEqual and accumulate
      // any match in a single bit.
      const candidateHex = hashBackupCode(backupCode);
      const candidate = Buffer.from(candidateHex, 'hex');
      let matched = 0;
      for (const stored of (user.totpBackupCodes || [])) {
        let storedBuf;
        try { storedBuf = Buffer.from(String(stored), 'hex'); } catch { storedBuf = null; }
        if (!storedBuf || storedBuf.length !== candidate.length) continue;
        if (crypto.timingSafeEqual(storedBuf, candidate)) matched = 1;
      }
      if (matched) {
        // Atomic single-use: only succeed if the code was still present at
        // consume time. Two concurrent logins with the same backup code can
        // race here — exactly one sees modifiedCount=1, the other is rejected.
        const consume = await User.updateOne(
          { _id: user._id, totpBackupCodes: candidateHex },
          { $pull: { totpBackupCodes: candidateHex } },
        );
        if (consume.modifiedCount > 0) totpOk = true;
      }
    }
    if (!totpOk) {
      await User.atomicRecordFail(user._id);
      await recordIpFailure(req, 'totp_fail');
      await AuditLog.create({
        actorId: user._id, actorEmail: user.loginId,
        action: 'login_totp_fail', outcome: 'failure', ipHash, userAgent: ua,
      });
      return res.status(401).json({ error: 'invalid_totp' });
    }
  }

  const fresh = await User.atomicRecordSuccess(user._id, req.ip, false);
  await clearIpFailures(req);
  const accessToken = signAccess(fresh);
  const { token: refresh } = await issueRefresh(fresh, { ip: req.ip, userAgent: ua });

  res.cookie(REFRESH_COOKIE, refresh, refreshCookieOpts());
  rotateCsrfCookie(res);
  await AuditLog.create({ actorId: user._id, actorEmail: user.loginId, action: 'login_success', ipHash, userAgent: ua });

  res.json({
    accessToken,
    user: {
      id: String(user._id),
      loginId: user.loginId,
      displayName: user.displayName || '',
      role: user.role,
      totpEnabled: !!user.totpEnabled,
      mustChangePassword: !!user.mustChangePassword,
    },
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
    return res.status(401).json({ error: 'invalid_refresh' });
  }

  const user = await User.findById(result.userId);
  if (!user || user.disabledAt) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth', domain: env.COOKIE_DOMAIN || undefined });
    return res.status(401).json({ error: 'invalid_refresh' });
  }
  if (result.grace) return res.json({ accessToken: signAccess(user) });

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

// ── Forgot password ─────────────────────────────────────────
const forgotBody = z.object({
  loginId: z.string().min(3).max(64).transform(s => s.toLowerCase().trim()),
});

authRouter.post('/forgot-password', enforceIpGuard, forgotLimiter, verifyCaptcha, async (req, res) => {
  // Signal email availability via header so UI can show an informational
  // message. This does NOT leak whether the account exists.
  if (!env.SMTP_HOST) res.set('X-Email-Available', '0');

  const parsed = forgotBody.safeParse(req.body);
  // Always return 204 to avoid user enumeration.
  if (!parsed.success) return res.status(204).end();
  const user = await User.findOne({ loginId: parsed.data.loginId });
  if (!user || user.disabledAt || !user.email) return res.status(204).end();

  const tokenId = crypto.randomBytes(8).toString('hex');
  const rawSecret = crypto.randomBytes(24).toString('base64url');
  const token = `${tokenId}.${rawSecret}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await PasswordResetToken.create({
    _id: tokenId, userId: user._id, tokenHash,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),   // 30 min
    ipHash: hashIp(req.ip),
  });

  const base = env.APP_PUBLIC_URL || `https://${req.get('host') || 'localhost'}`;
  const link = `${base}/?reset=${encodeURIComponent(token)}`;

  try {
    await sendMail({
      to: user.email,
      subject: 'รีเซ็ตรหัสผ่าน',
      text: `คลิกลิงก์เพื่อตั้งรหัสผ่านใหม่ (ลิงก์หมดอายุใน 30 นาที):\n\n${link}\n\nหากคุณไม่ได้เป็นผู้ขอ ไม่ต้องดำเนินการใด ๆ`,
    });
  } catch {}
  await AuditLog.create({ actorId: user._id, actorEmail: user.loginId, action: 'password_reset_request', ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200) });
  res.status(204).end();
});

const resetBody = z.object({
  token: z.string().min(10).max(300),
  newPassword: z.string().min(12).max(200),
});

authRouter.post('/reset-password', enforceIpGuard, forgotLimiter, async (req, res) => {
  const parsed = resetBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { token, newPassword } = parsed.data;
  const dot = token.indexOf('.');
  if (dot <= 0) return res.status(400).json({ error: 'invalid_token' });
  const tokenId = token.slice(0, dot);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const record = await PasswordResetToken.findOneAndUpdate(
    { _id: tokenId, tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: false },
  );
  if (!record) return res.status(400).json({ error: 'invalid_token' });

  const user = await User.findById(record.userId);
  if (!user || user.disabledAt) return res.status(400).json({ error: 'invalid_token' });

  try { await user.setPassword(newPassword, [user.loginId, user.email]); }
  catch (e) {
    return res.status(400).json({ error: e.reason || 'weak_password', suggestions: e.details?.suggestions || [] });
  }
  user.mustChangePassword = false;
  user.failedLoginCount = 0;
  user.lockUntil = null;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await revokeAllForUser(user._id, 'password_reset');

  await AuditLog.create({ actorId: user._id, actorEmail: user.loginId, action: 'password_reset_complete', ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200) });
  res.json({ ok: true });
});
