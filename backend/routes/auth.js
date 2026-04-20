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
import { verifyTokenDelta as verifyTotpDelta, currentTotpStep, hashBackupCode } from '../utils/totp.js';
import { loginLimiter, loginBurstLimiter, forgotLimiter } from '../middleware/rateLimit.js';
import { enforceIpGuard, recordIpFailure, clearIpFailures } from '../middleware/ipGuard.js';
import { verifyCaptcha } from '../middleware/captcha.js';
import { validate, loginBody } from '../middleware/validate.js';
import { rotateCsrfCookie, clearCsrfCookie } from '../middleware/csrf.js';
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

// Equalize wall-clock time on every failure path so an attacker can't
// distinguish "user exists, wrong password" (which does one extra
// atomicRecordFail write) from "no such user" (which skips it) via
// timing. 600ms comfortably exceeds the tail latency of argon2id
// verify + a couple of Mongo writes on the slowest supported
// hardware; tune downward if p99 login is consistently faster.
const LOGIN_FAIL_FLOOR_MS = 600;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function floorLoginTime(t0) {
  const elapsed = Date.now() - t0;
  if (elapsed < LOGIN_FAIL_FLOOR_MS) await sleep(LOGIN_FAIL_FLOOR_MS - elapsed);
}

authRouter.post('/login', enforceIpGuard, loginBurstLimiter, loginLimiter, verifyCaptcha, validate(loginBody), async (req, res) => {
  const t0 = Date.now();
  const { loginId, password, totpCode, backupCode } = req.body;
  const ipHash = hashIp(req.ip);
  const ua = safeText(req.get('user-agent') || '', 200);

  const user = await User.findOne({ loginId })
    .select('+passwordHash +failedLoginCount +lockUntil +totpSecret +totpBackupCodes +lastTotpStep');

  if (!user) {
    await User.verifyDummy(password);
    await recordIpFailure(req, 'login_unknown');
    await AuditLog.create({ actorEmail: loginId, action: 'login_unknown', outcome: 'failure', ipHash, userAgent: ua });
    await floorLoginTime(t0);
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
    await floorLoginTime(t0);
    return res.status(401).json(GENERIC_LOGIN_FAIL);
  }

  // 2FA challenge
  if (user.totpEnabled) {
    if (!totpCode && !backupCode) {
      return res.status(401).json({ error: 'totp_required' });
    }
    let totpOk = false;
    if (totpCode) {
      // Resolve which step the code matched, then atomically bump
      // lastTotpStep so the SAME code (or any earlier code still in
      // the ±1-step window) cannot be replayed — even if an attacker
      // captured it via phishing / MITM / shoulder-surf.
      const delta = verifyTotpDelta(user.totpSecret, totpCode);
      if (delta !== null) {
        const usedStep = currentTotpStep() + delta;
        const prev = Number(user.lastTotpStep) || 0;
        if (usedStep > prev) {
          const bump = await User.updateOne(
            { _id: user._id, $or: [{ lastTotpStep: { $lt: usedStep } }, { lastTotpStep: { $exists: false } }] },
            { $set: { lastTotpStep: usedStep } },
          );
          if (bump.modifiedCount > 0) totpOk = true;
          // If modifiedCount === 0 another request won the race — the
          // code was already consumed this step, reject as replay.
        }
        // usedStep <= prev ⇒ replay of an already-consumed code
      }
    }
    if (!totpOk && backupCode) {
      // True constant-time backup-code check. We pad to a fixed slot count
      // (MAX_BACKUP_SLOTS) and always run timingSafeEqual exactly that many
      // times against a same-length buffer, so the wall-clock cost is
      // independent of (a) which code matched, (b) how many codes remain
      // after previous consumptions, and (c) whether any stored code had
      // a length mismatch. Every iteration performs the same work.
      const MAX_BACKUP_SLOTS = 10;
      const candidateHex = hashBackupCode(backupCode);
      const candidate = Buffer.from(candidateHex, 'hex');
      const zeroBuf = Buffer.alloc(candidate.length);
      const stored = user.totpBackupCodes || [];
      let matched = 0;
      for (let i = 0; i < MAX_BACKUP_SLOTS; i++) {
        let buf = zeroBuf;
        const s = stored[i];
        if (s) {
          try {
            const tmp = Buffer.from(String(s), 'hex');
            if (tmp.length === candidate.length) buf = tmp;
          } catch { /* fall through with zeroBuf */ }
        }
        // Always run the compare — even against the zero buffer — so the
        // iteration cost is identical whether a slot is empty, malformed,
        // or a real hash.
        if (crypto.timingSafeEqual(buf, candidate)) matched = 1;
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
  // Also drop the CSRF cookie so no stale double-submit token lingers
  // in the browser after the session it was bound to is gone.
  clearCsrfCookie(res);
  res.status(204).end();
});

// ── Forgot password ─────────────────────────────────────────
const forgotBody = z.object({
  loginId: z.string().min(3).max(64).transform(s => s.toLowerCase().trim()),
});

authRouter.post('/forgot-password', enforceIpGuard, forgotLimiter, verifyCaptcha, async (req, res) => {
  // Fixed minimum response time defeats timing-based user enumeration:
  // without it, non-existent users return in tens of ms while real
  // users trigger a full token-generate + sendMail cycle taking 1-5s,
  // and attackers can distinguish the two by latency.
  const startedAt = Date.now();
  const MIN_RESPONSE_MS = 900;
  const padResponse = async () => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_RESPONSE_MS) {
      await new Promise(r => setTimeout(r, MIN_RESPONSE_MS - elapsed));
    }
  };

  // Signal email availability via header so UI can show an informational
  // message. This does NOT leak whether the account exists.
  if (!env.SMTP_HOST) res.set('X-Email-Available', '0');

  const parsed = forgotBody.safeParse(req.body);
  // Always return 204 to avoid user enumeration.
  if (!parsed.success) { await padResponse(); return res.status(204).end(); }
  const user = await User.findOne({ loginId: parsed.data.loginId });
  if (!user || user.disabledAt || !user.email) { await padResponse(); return res.status(204).end(); }

  const tokenId = crypto.randomBytes(8).toString('hex');
  const rawSecret = crypto.randomBytes(24).toString('base64url');
  const token = `${tokenId}.${rawSecret}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await PasswordResetToken.create({
    _id: tokenId, userId: user._id, tokenHash,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),   // 30 min
    ipHash: hashIp(req.ip),
  });

  // Never derive the link base from the request Host header — an
  // attacker can send forgot-password with Host: attacker.com and
  // the victim would get an email linking to attacker.com/?reset=...
  // Production enforces APP_PUBLIC_URL at boot (config/env.js). For
  // dev/test we allow the request Host so local loopback works.
  const base = env.APP_PUBLIC_URL
    || (env.NODE_ENV === 'production' ? null : `https://${req.get('host') || 'localhost'}`);
  if (!base) {
    log.error('reset_link_base_missing — APP_PUBLIC_URL not set in production');
    return res.status(204).end();
  }
  const link = `${base}/?reset=${encodeURIComponent(token)}`;

  try {
    await sendMail({
      to: user.email,
      subject: 'รีเซ็ตรหัสผ่าน',
      text: `คลิกลิงก์เพื่อตั้งรหัสผ่านใหม่ (ลิงก์หมดอายุใน 30 นาที):\n\n${link}\n\nหากคุณไม่ได้เป็นผู้ขอ ไม่ต้องดำเนินการใด ๆ`,
    });
  } catch {}
  await AuditLog.create({ actorId: user._id, actorEmail: user.loginId, action: 'password_reset_request', ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200) });
  await padResponse();
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
