// routes/admin.js — authenticated admin endpoints.

import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import webPush from 'web-push';
import { getAppConfig } from '../models/AppConfig.js';
import { ClickEvent } from '../models/ClickEvent.js';
import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { PushSubscription } from '../models/PushSubscription.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { adminWriteLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { validate, configBody, createUserBody } from '../middleware/validate.js';
import { uploadSingle, uploadApk, isApkBuffer, isImageBuffer, verifyApkApiBase, MIME_TO_EXT, APK_MIME } from '../middleware/upload.js';
import { MediaAsset } from '../models/MediaAsset.js';
import { sanitizeConfig, hashIp, safeText, safeUrl } from '../utils/sanitize.js';
import { revokeAllForUser, revokeOne } from '../utils/tokens.js';
import { generateSecret, qrDataUrl, verifyTokenDelta as verifyTotpDelta, currentTotpStep, generateBackupCodes, hashBackupCode } from '../utils/totp.js';
import { toCsvStream } from '../utils/csv.js';
import { invalidateConfigCache } from './public.js';
import { env } from '../config/env.js';
import { log } from '../utils/logger.js';

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.use(verifyCsrf);

// Configure web-push VAPID once if keys are set
let vapidConfigured = false;
if (env.PUSH_VAPID_PUBLIC && env.PUSH_VAPID_PRIVATE) {
  try {
    webPush.setVapidDetails(env.PUSH_VAPID_SUBJECT, env.PUSH_VAPID_PUBLIC, env.PUSH_VAPID_PRIVATE);
    vapidConfigured = true;
  } catch (e) { log.warn({ err: e.message }, 'vapid_config_invalid'); }
}

// ── System health / feature status ─────────────────────────
// Reports which optional features are configured / working so the admin UI
// can surface warnings like "email is not set up — password reset will not
// send actual emails". No sensitive values are leaked — only booleans.
adminRouter.get('/health/features', async (req, res) => {
  const checks = [];

  // Email (password reset)
  const emailOk = !!env.SMTP_HOST;
  checks.push({
    id: 'email',
    label: 'ส่งอีเมล (รีเซ็ตรหัสผ่าน)',
    status: emailOk ? 'ok' : 'disabled',
    severity: emailOk ? 'info' : (env.NODE_ENV === 'production' ? 'warn' : 'info'),
    detail: emailOk
      ? `SMTP: ${env.SMTP_HOST}:${env.SMTP_PORT || 587}`
      : 'SMTP_HOST ไม่ได้ตั้ง · การขอรีเซ็ตรหัสจะไม่ส่งอีเมลจริง (เฉพาะ log)',
    impact: emailOk ? null : 'ผู้ใช้ที่ลืมรหัสจะไม่ได้รับอีเมล',
    envVars: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'APP_PUBLIC_URL'],
  });

  // CAPTCHA (Cloudflare Turnstile)
  const captchaOk = !!env.TURNSTILE_SECRET;
  checks.push({
    id: 'captcha',
    label: 'CAPTCHA ป้องกันบอท',
    status: captchaOk ? 'ok' : 'disabled',
    severity: captchaOk ? 'info' : (env.NODE_ENV === 'production' ? 'warn' : 'info'),
    detail: captchaOk
      ? 'Cloudflare Turnstile เปิดใช้'
      : 'TURNSTILE_SECRET ไม่ได้ตั้ง · ฟอร์ม login/forgot-password ไม่มี CAPTCHA',
    impact: captchaOk ? null : 'ยังมี rate-limit ป้องกันอยู่ แต่ไม่มีการตรวจจับบอท',
    envVars: ['TURNSTILE_SECRET'],
  });

  // Web Push (VAPID)
  const pushOk = !!(env.PUSH_VAPID_PUBLIC && env.PUSH_VAPID_PRIVATE && vapidConfigured);
  let pushSubCount = 0;
  if (pushOk) { try { pushSubCount = await PushSubscription.countDocuments({}); } catch {} }
  checks.push({
    id: 'push',
    label: 'Web Push Notifications',
    status: pushOk ? 'ok' : 'disabled',
    severity: 'info',
    detail: pushOk
      ? `VAPID ตั้งค่าแล้ว · ${pushSubCount} subscriber`
      : 'PUSH_VAPID_PUBLIC / PUSH_VAPID_PRIVATE ไม่ได้ตั้ง · ปุ่ม subscribe และ broadcast ใช้งานไม่ได้',
    impact: pushOk ? null : 'ผู้ใช้ไม่สามารถ opt-in รับแจ้งเตือน และ admin ไม่สามารถ broadcast ได้',
    envVars: ['PUSH_VAPID_PUBLIC', 'PUSH_VAPID_PRIVATE', 'PUSH_VAPID_SUBJECT'],
  });

  // Redis (shared rate-limit store)
  const redisOk = !!env.REDIS_URL;
  checks.push({
    id: 'redis',
    label: 'Redis (rate-limit ข้ามอินสแตนซ์)',
    status: redisOk ? 'ok' : 'disabled',
    severity: 'info',
    detail: redisOk
      ? 'Redis ตั้งค่าแล้ว · rate-limit ใช้ได้ทุก instance'
      : 'REDIS_URL ไม่ได้ตั้ง · rate-limit เก็บในหน่วยความจำ (process เดียว)',
    impact: redisOk ? null : 'ถ้าเปิดหลาย instance attacker หลบ rate-limit ได้โดยกระจาย request',
    envVars: ['REDIS_URL'],
  });

  // 2FA (TOTP) — global feature always available, but admin may not enable
  const totpEnabledUsers = await User.countDocuments({ totpEnabled: true });
  const totalAdmins = await User.countDocuments({ role: 'admin', disabledAt: null });
  checks.push({
    id: '2fa',
    label: 'การยืนยันตัวตน 2 ขั้น (2FA/TOTP)',
    status: totpEnabledUsers > 0 ? 'ok' : 'partial',
    severity: totpEnabledUsers === 0 ? 'warn' : 'info',
    detail: `${totpEnabledUsers}/${totalAdmins} ผู้ดูแลเปิด 2FA แล้ว`,
    impact: totpEnabledUsers === 0
      ? 'ยังไม่มีผู้ดูแลเปิด 2FA — บัญชีเสี่ยงถ้ารหัสผ่านรั่ว'
      : null,
    envVars: [],
  });

  // Config cookie security in production
  const cookieSecureOk = env.NODE_ENV !== 'production' || env.COOKIE_SECURE;
  checks.push({
    id: 'cookie_secure',
    label: 'Cookie Secure Flag',
    status: cookieSecureOk ? 'ok' : 'broken',
    severity: cookieSecureOk ? 'info' : 'error',
    detail: cookieSecureOk
      ? 'Secure cookie เปิดใช้'
      : 'COOKIE_SECURE=false ใน production — refresh token ส่งผ่าน plain HTTP ได้',
    impact: cookieSecureOk ? null : 'Session hijacking risk — ต้องตั้ง COOKIE_SECURE=true',
    envVars: ['COOKIE_SECURE'],
  });

  // Log transport
  checks.push({
    id: 'logs',
    label: 'ระบบบันทึก Log',
    status: env.LOG_TRANSPORT === 'loki' && !env.LOKI_URL ? 'broken' : 'ok',
    severity: env.LOG_TRANSPORT === 'loki' && !env.LOKI_URL ? 'error' : 'info',
    detail: env.LOG_TRANSPORT === 'loki' && !env.LOKI_URL
      ? 'LOG_TRANSPORT=loki แต่ LOKI_URL ไม่ได้ตั้ง — log อาจไม่ได้ส่งออก'
      : `Transport: ${env.LOG_TRANSPORT}`,
    impact: env.LOG_TRANSPORT === 'loki' && !env.LOKI_URL
      ? 'Log ไม่ถูกส่งไป Loki — สูญหายเมื่อ restart'
      : null,
    envVars: ['LOG_TRANSPORT', 'LOKI_URL'],
  });

  const summary = {
    total: checks.length,
    ok: checks.filter(c => c.status === 'ok').length,
    warn: checks.filter(c => c.severity === 'warn').length,
    error: checks.filter(c => c.severity === 'error').length,
    disabled: checks.filter(c => c.status === 'disabled').length,
  };

  res.json({
    nodeEnv: env.NODE_ENV,
    summary,
    features: checks,
  });
});

// ── Current user ("me") ─────────────────────────────────────
adminRouter.get('/me', async (req, res) => {
  const me = await User.findById(req.user.id, {
    loginId: 1, displayName: 1, email: 1, role: 1, mustChangePassword: 1,
    totpEnabled: 1, lastLoginAt: 1, lastLoginIp: 1, createdAt: 1,
  }).lean();
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  res.json({
    id: String(me._id),
    loginId: me.loginId,
    displayName: me.displayName || '',
    email: me.email || '',
    role: me.role,
    mustChangePassword: !!me.mustChangePassword,
    totpEnabled: !!me.totpEnabled,
    lastLoginAt: me.lastLoginAt,
    lastLoginIp: me.lastLoginIp,
    createdAt: me.createdAt,
  });
});

const profileBody = z.object({
  displayName: z.string().max(80).optional(),
  email: z.string().email().max(254).optional().or(z.literal('')),
});

adminRouter.patch('/me', adminWriteLimiter, async (req, res) => {
  const parsed = profileBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const up = {};
  if (parsed.data.displayName !== undefined) up.displayName = parsed.data.displayName;
  if (parsed.data.email !== undefined) up.email = parsed.data.email;
  await User.updateOne({ _id: req.user.id }, { $set: up });
  res.json({ ok: true });
});

// ── Dashboard summary + 7-day timeseries ────────────────────
adminRouter.get('/stats', requireRole('admin', 'editor'), async (req, res) => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [userCount, activeUsers, clickToday, clickWeek, failedToday, cfg] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ disabledAt: null }),
    ClickEvent.countDocuments({ createdAt: { $gte: dayAgo } }),
    ClickEvent.countDocuments({ createdAt: { $gte: weekAgo } }),
    AuditLog.countDocuments({ action: { $in: ['login_fail', 'login_unknown', 'login_locked', 'login_totp_fail'] }, createdAt: { $gte: dayAgo } }),
    getAppConfig(),
  ]);

  res.json({
    users:    { total: userCount, active: activeUsers },
    clicks:   { today: clickToday, week: clickWeek },
    security: { failedLogins24h: failedToday },
    config:   { appName: cfg.appName, buttons: cfg.buttons.length, banners: cfg.banners.length, updatedAt: cfg.updatedAt },
  });
});

adminRouter.get('/stats/timeseries', requireRole('admin', 'editor'), async (req, res) => {
  const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const clicks = await ClickEvent.aggregate([
    { $match: { createdAt: { $gte: from } } },
    { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Bangkok' } },
        count: { $sum: 1 },
    } },
    { $sort: { _id: 1 } },
  ]);
  const logins = await AuditLog.aggregate([
    { $match: { action: 'login_success', createdAt: { $gte: from } } },
    { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Bangkok' } },
        count: { $sum: 1 },
    } },
    { $sort: { _id: 1 } },
  ]);
  res.json({ days, clicks, logins });
});

// ── Config read / write ─────────────────────────────────────
adminRouter.get('/config', requireRole('admin', 'editor'), async (req, res) => {
  const cfg = await getAppConfig();
  res.json({
    appName: cfg.appName, tagline: cfg.tagline, appIcon: cfg.appIcon || '',
    theme: cfg.theme,
    language: cfg.language || 'th', darkMode: cfg.darkMode || 'auto',
    banners: cfg.banners, buttons: cfg.buttons, contact: cfg.contact,
    featureFlags: cfg.featureFlags || {},
    downloadLinks: cfg.downloadLinks || {},
    updatedAt: cfg.updatedAt,
  });
});

adminRouter.patch('/config', adminWriteLimiter, requireRole('admin', 'editor'), validate(configBody), async (req, res) => {
  let clean;
  try { clean = sanitizeConfig(req.body); }
  catch { return res.status(400).json({ error: 'invalid_input' }); }

  const cfg = await getAppConfig();
  const before = cfg.toObject();
  Object.assign(cfg, {
    appName: clean.appName, tagline: clean.tagline, appIcon: clean.appIcon, theme: clean.theme,
    language: clean.language, darkMode: clean.darkMode,
    featureFlags: clean.featureFlags,
    downloadLinks: clean.downloadLinks,
    banners: clean.banners, buttons: clean.buttons, contact: clean.contact,
    updatedBy: req.user.id,
  });
  try { await cfg.save(); }
  catch (e) {
    if (e && e.name === 'VersionError') return res.status(409).json({ error: 'stale_version' });
    throw e;
  }

  invalidateConfigCache();
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'config_update', target: 'AppConfig:singleton',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { before: slim(before), after: slim(cfg.toObject()) },
  });
  res.json({ ok: true, updatedAt: cfg.updatedAt });
});

// ── Direct downloadLinks setter ─────────────────────────────
// Admin clients whose browsers cached an OLD security.jsx (pre-apk regex)
// silently strip /media/*.apk URLs via SafeState.sanitize before a regular
// PATCH /config request leaves the browser. This endpoint bypasses that by
// accepting a raw patch and sanitizing ONLY server-side (which has the
// correct regex). Also used by the ApkUploader as a "write-through" path
// so uploaded URLs can't be clobbered by the polling loop racing the
// debounced save.
const downloadLinksBody = z.object({
  android:      z.string().max(2048).optional().or(z.literal('')),
  ios:          z.string().max(2048).optional().or(z.literal('')),
  androidLabel: z.string().max(40).optional().or(z.literal('')),
  iosLabel:     z.string().max(40).optional().or(z.literal('')),
  note:         z.string().max(140).optional().or(z.literal('')),
}).strict();

adminRouter.post('/config/download-links', adminWriteLimiter, requireRole('admin', 'editor'), async (req, res) => {
  const p = downloadLinksBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid_input' });

  // Validate URLs with the server-side safeUrl (which accepts /media/*.apk)
  const clean = {};
  for (const k of ['android', 'ios']) {
    if (p.data[k] !== undefined) {
      const s = safeUrl(p.data[k]);
      // Allow blanking via explicit empty string
      if (p.data[k] === '' || s) clean[k] = s;
      else return res.status(400).json({ error: 'invalid_url', field: k });
    }
  }
  for (const k of ['androidLabel', 'iosLabel', 'note']) {
    if (p.data[k] !== undefined) clean[k] = safeText(p.data[k], k === 'note' ? 140 : 40);
  }

  const cfg = await getAppConfig();
  const before = { ...(cfg.downloadLinks?.toObject?.() || cfg.downloadLinks || {}) };
  cfg.downloadLinks = { ...before, ...clean };
  cfg.updatedBy = req.user.id;
  try { await cfg.save(); }
  catch (e) {
    if (e && e.name === 'VersionError') return res.status(409).json({ error: 'stale_version' });
    throw e;
  }
  invalidateConfigCache();

  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'download_links_set',
    target: 'AppConfig:downloadLinks',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { before, after: cfg.downloadLinks?.toObject?.() || cfg.downloadLinks },
  });
  res.json({ ok: true, downloadLinks: cfg.downloadLinks });
});

// ── Upload banner image (multipart) ─────────────────────────
// Buffers the file in memory via multer, then stores the bytes in the
// MediaAsset collection. Serving happens at GET /media/:id (server.js).
// This avoids the ephemeral-filesystem problem on Railway etc.
function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    uploadSingle(req, res, (err) => err ? reject(err) : resolve());
  });
}

adminRouter.post('/upload/banner', uploadLimiter, requireRole('admin', 'editor'), async (req, res) => {
  try {
    await runUpload(req, res);
  } catch (err) {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
    if (err && err.message === 'unsupported_media_type') return res.status(415).json({ error: 'unsupported_media_type' });
    log.warn({ err: err?.message }, 'upload_multer_failed');
    return res.status(400).json({ error: 'upload_failed' });
  }
  if (!req.file) return res.status(400).json({ error: 'no_file' });

  // Server-side magic-byte verification. multer only checked the
  // client-supplied MIME header; an attacker could lie about it.
  if (!isImageBuffer(req.file.buffer, req.file.mimetype)) {
    return res.status(415).json({ error: 'not_an_image' });
  }

  const ext = MIME_TO_EXT[req.file.mimetype] || '.img';
  const id = crypto.randomBytes(12).toString('hex') + ext;
  try {
    await MediaAsset.create({
      _id: id,
      mime: req.file.mimetype,
      size: req.file.size,
      data: req.file.buffer,
      uploadedBy: req.user.id,
    });
  } catch (err) {
    log.error({ err: err?.message }, 'media_persist_failed');
    return res.status(500).json({ error: 'upload_failed' });
  }

  const url = '/media/' + id;
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'banner_upload', target: url,
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true, url, size: req.file.size });
});

// ── APK upload (self-hosted Android distribution) ──────────
// Admin can upload an .apk directly without depending on GitHub Releases,
// Google Drive, or object storage. File is stored in MongoDB MediaAsset
// and served via /media/<id>.apk with Content-Disposition: attachment, so
// Android Chrome triggers a download prompt and the user can tap-install.
function runApkUpload(req, res) {
  return new Promise((resolve, reject) => {
    uploadApk(req, res, (err) => err ? reject(err) : resolve());
  });
}

adminRouter.post('/upload/apk', uploadLimiter, requireRole('admin'), async (req, res) => {
  try { await runApkUpload(req, res); }
  catch (err) {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
    if (err && err.message === 'unsupported_media_type') return res.status(415).json({ error: 'unsupported_media_type' });
    log.warn({ err: err?.message }, 'apk_upload_multer_failed');
    return res.status(400).json({ error: 'upload_failed' });
  }
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  // Verify real APK bytes — MIME is client-supplied and untrustworthy.
  if (!isApkBuffer(req.file.buffer)) return res.status(415).json({ error: 'not_an_apk' });

  // Verify the APK was built with window.API_BASE pointing to THIS backend.
  // Without this guard admins can (and have) uploaded a locally-built APK
  // missing API_BASE, users install it, the Capacitor WebView falls back
  // to DEFAULT_STATE, and admin edits never appear on the device. Catch
  // this at upload time instead of after users complain.
  const expectedOrigin = backendOriginOf(req);
  const check = verifyApkApiBase(req.file.buffer, expectedOrigin);
  if (!check.ok) {
    log.warn({ code: check.code, expectedOrigin, size: req.file.size }, 'apk_upload_rejected');
    return res.status(400).json({ error: check.code, detail: check.detail });
  }

  const id = crypto.randomBytes(12).toString('hex') + '.apk';
  const origName = safeText(req.file.originalname || 'app.apk', 120);
  try {
    await MediaAsset.create({
      _id: id, mime: APK_MIME, size: req.file.size,
      filename: origName, kind: 'apk',
      data: req.file.buffer, uploadedBy: req.user.id,
    });
  } catch (err) {
    log.error({ err: err?.message, size: req.file.size }, 'apk_persist_failed');
    return res.status(500).json({ error: 'upload_failed' });
  }

  const url = '/media/' + id;
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'apk_upload', target: url,
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { filename: origName, size: req.file.size },
  });
  res.json({ ok: true, url, size: req.file.size, filename: origName });
});

// ── Install-link token ──────────────────────────────────────
// Admin generates a fresh token whenever they want to kill all previously
// shared install URLs. Token is kept on AppConfig so it's just one doc to
// maintain. No history preserved — rotation is irreversible by design.
adminRouter.get('/install-token', requireRole('admin', 'editor'), async (req, res) => {
  const cfg = await getAppConfig();
  res.json({
    current: cfg.installToken?.current || '',
    rotatedAt: cfg.installToken?.rotatedAt || null,
    rotationCount: cfg.installToken?.rotationCount || 0,
  });
});

adminRouter.post('/install-token/rotate', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  const token = crypto.randomBytes(18).toString('base64url');  // 24-char URL-safe
  const cfg = await getAppConfig();
  cfg.installToken = {
    current: token,
    rotatedAt: new Date(),
    rotatedBy: req.user.id,
    rotationCount: (cfg.installToken?.rotationCount || 0) + 1,
  };
  await cfg.save();
  invalidateConfigCache();
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'install_token_rotate',
    target: 'AppConfig:installToken',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { rotationCount: cfg.installToken.rotationCount },
  });
  res.json({
    token, url: `/install/${token}`,
    rotatedAt: cfg.installToken.rotatedAt,
    rotationCount: cfg.installToken.rotationCount,
  });
});

adminRouter.post('/install-token/revoke', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  const cfg = await getAppConfig();
  cfg.installToken = {
    current: '',
    rotatedAt: new Date(),
    rotatedBy: req.user.id,
    rotationCount: (cfg.installToken?.rotationCount || 0) + 1,
  };
  await cfg.save();
  invalidateConfigCache();
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'install_token_revoke',
    target: 'AppConfig:installToken',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

// ── Admin-access token ──────────────────────────────────────
// Rotates the URL that end-users must hit to even SEE the admin login
// form. Mirrors install-token but for the admin surface.
adminRouter.get('/admin-token', requireRole('admin'), async (req, res) => {
  const cfg = await getAppConfig();
  res.json({
    current: cfg.adminAccessToken?.current || '',
    rotatedAt: cfg.adminAccessToken?.rotatedAt || null,
    rotationCount: cfg.adminAccessToken?.rotationCount || 0,
  });
});

adminRouter.post('/admin-token/rotate', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  const token = crypto.randomBytes(18).toString('base64url');
  const cfg = await getAppConfig();
  cfg.adminAccessToken = {
    current: token,
    rotatedAt: new Date(),
    rotatedBy: req.user.id,
    rotationCount: (cfg.adminAccessToken?.rotationCount || 0) + 1,
  };
  await cfg.save();
  invalidateConfigCache();
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'admin_token_rotate',
    target: 'AppConfig:adminAccessToken',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { rotationCount: cfg.adminAccessToken.rotationCount },
  });
  log.warn({ token: token.slice(0, 4) + '***' }, 'admin_token_rotated');
  res.json({ token, url: `/admin/${token}`, rotatedAt: cfg.adminAccessToken.rotatedAt });
});

// List recent APK uploads so the admin can reuse / rotate old versions.
adminRouter.get('/uploads/apks', requireRole('admin'), async (req, res) => {
  const rows = await MediaAsset.find({ kind: 'apk' }, { data: 0 })
    .sort({ createdAt: -1 }).limit(20).lean();
  res.json({
    rows: rows.map(r => ({
      url: '/media/' + r._id,
      filename: r.filename,
      size: r.size,
      uploadedAt: r.createdAt,
    })),
  });
});

adminRouter.delete('/uploads/apks/:id', requireRole('admin'), async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[a-f0-9]{12,64}\.apk$/i.test(id)) return res.status(400).json({ error: 'invalid_id' });
  await MediaAsset.deleteOne({ _id: id });
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'apk_delete', target: '/media/' + id,
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

// ── Remote APK build (GitHub Actions dispatch) ──────────────
// Railway can't build Android APKs directly — not enough RAM/disk and
// no Android SDK. Instead the admin panel triggers the existing
// GitHub Actions workflow, then the resulting APK is pulled from the
// `latest-apk` release. Requires GITHUB_OWNER + GITHUB_REPO + GITHUB_TOKEN
// env vars (token needs actions:write + contents:read).

const WORKFLOW_FILE = 'android.yml';

function ghConfigured() {
  return !!(env.GITHUB_OWNER && env.GITHUB_REPO && env.GITHUB_TOKEN);
}

// Resolve the public backend origin as the browser sees it, honouring
// Railway/Fly proxies. We bake THIS URL into the APK so the Capacitor
// WebView (origin https://localhost) can reach /api/config on the real
// backend instead of falling back to DEFAULT_STATE ("ตัวอย่างแอป",
// "ปุ่มที่ 1-6" etc.).
//
// TRUST_PROXY gate: only honour X-Forwarded-* when we actually trust
// the upstream proxy that set the header. With TRUST_PROXY=0 (direct
// exposure) an attacker-in-the-middle could craft X-Forwarded-Host:
// evil.com and this endpoint would bake evil.com into the APK that
// users install — persistent phishing. Mirrors the gate in
// server.js:195 and the origin-guard middleware.
function backendOriginOf(req) {
  const trusted = env.TRUST_PROXY > 0;
  const fwdHost  = trusted ? (req.get('x-forwarded-host')  || '').split(',')[0].trim() : '';
  const fwdProto = trusted ? (req.get('x-forwarded-proto') || '').split(',')[0].trim() : '';
  const host  = fwdHost  || req.get('host') || '';
  const proto = fwdProto || (req.secure ? 'https' : 'http');
  if (!host) return '';
  return proto + '://' + host;
}

async function ghFetch(path, init = {}) {
  const url = 'https://api.github.com' + path;
  return fetch(url, {
    ...init,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'myapp-admin',
      ...(init.headers || {}),
    },
  });
}

adminRouter.get('/build-apk/status', requireRole('admin'), async (req, res) => {
  if (!ghConfigured()) return res.json({ configured: false });
  try {
    const runsRes = await ghFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=5`);
    if (!runsRes.ok) {
      const body = await runsRes.text().catch(() => '');
      log.warn({ status: runsRes.status, body: body.slice(0, 300) }, 'gh_list_runs_failed');
      return res.status(502).json({ error: 'github_unreachable', status: runsRes.status });
    }
    const runs = await runsRes.json();
    const latest = (runs.workflow_runs || [])[0];
    const releaseRes = await ghFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/releases/tags/latest-apk`);
    let apkUrl = null, apkUpdatedAt = null, apkSize = 0;
    if (releaseRes.ok) {
      const rel = await releaseRes.json();
      const asset = (rel.assets || []).find(a => a.name === 'app-debug.apk');
      if (asset) { apkUrl = asset.browser_download_url; apkUpdatedAt = asset.updated_at; apkSize = asset.size; }
    }
    res.json({
      configured: true,
      latestRun: latest ? {
        id: latest.id,
        status: latest.status,              // queued | in_progress | completed
        conclusion: latest.conclusion,      // success | failure | null
        html_url: latest.html_url,
        created_at: latest.created_at,
        updated_at: latest.updated_at,
        head_commit_message: latest.head_commit?.message || '',
      } : null,
      apk: apkUrl ? { url: apkUrl, updatedAt: apkUpdatedAt, size: apkSize } : null,
    });
  } catch (e) {
    log.warn({ err: e?.message }, 'gh_status_error');
    res.status(502).json({ error: 'github_unreachable' });
  }
});

adminRouter.post('/build-apk', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  if (!ghConfigured()) return res.status(400).json({ error: 'github_not_configured' });

  // Cheap rate-limit: refuse if a run is in_progress in the last 10 minutes.
  try {
    const runsRes = await ghFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=3`);
    if (runsRes.ok) {
      const runs = await runsRes.json();
      const busy = (runs.workflow_runs || []).find(r => r.status === 'in_progress' || r.status === 'queued');
      if (busy) return res.status(409).json({ error: 'build_in_progress', runId: busy.id, html_url: busy.html_url });
    }
  } catch {}

  // Pass the backend's own public origin as the api_base workflow input.
  // Without this, prepare-web.js ships an APK with window.API_BASE empty,
  // the Capacitor WebView hits https://localhost/api/config, fetch fails,
  // and the user sees DEFAULT_STATE demo data instead of the admin-edited
  // config. No repo secret needed — we detect the real origin per-request.
  //
  // Reject the build if origin detection failed: sending inputs:{} would
  // fall through to secrets.API_BASE_URL (likely unset) and produce a
  // silently-broken APK — admin would see "build started" then wonder
  // why the new APK still shows demo data. Loud failure > silent trap.
  const apiBase = backendOriginOf(req);
  if (!apiBase) {
    log.warn({ headers: { host: req.get('host'), xfh: req.get('x-forwarded-host') } }, 'build_apk_origin_detection_failed');
    return res.status(400).json({
      error: 'api_base_detection_failed',
      detail: 'Cannot detect backend origin from request. Check that the proxy forwards X-Forwarded-Host and TRUST_PROXY is configured.',
    });
  }
  try {
    const dispatchRes = await ghFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: 'main',
        inputs: { api_base: apiBase },
      }),
    });
    if (!dispatchRes.ok) {
      const body = await dispatchRes.text().catch(() => '');
      log.warn({ status: dispatchRes.status, body: body.slice(0, 300) }, 'gh_dispatch_failed');
      return res.status(502).json({ error: 'dispatch_failed', status: dispatchRes.status });
    }
    await AuditLog.create({
      actorId: req.user.id, actorEmail: req.user.loginId,
      action: 'apk_build_dispatch', target: `gh:${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
      ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    });
    // GitHub doesn't return a runId from workflow_dispatch; client polls status endpoint.
    res.json({ ok: true, hint: 'build_started' });
  } catch (e) {
    log.warn({ err: e?.message }, 'gh_dispatch_error');
    res.status(502).json({ error: 'github_unreachable' });
  }
});

// ── Analytics (detailed per-button) ─────────────────────────
adminRouter.get('/analytics', requireRole('admin'), async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const byButton = await ClickEvent.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { buttonId: '$buttonId', ipHash: '$ipHash' } } },
    { $group: { _id: '$_id.buttonId', uniques: { $sum: 1 } } },
    { $lookup: {
        from: 'clickevents',
        let: { bid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$buttonId', '$$bid'] }, createdAt: { $gte: since } } },
          { $count: 'n' },
        ],
        as: 'total',
      } },
    { $project: { _id: 0, buttonId: '$_id', uniques: 1, clicks: { $ifNull: [{ $arrayElemAt: ['$total.n', 0] }, 0] } } },
    { $sort: { clicks: -1 } },
    { $limit: 50 },
  ]).allowDiskUse(true);
  res.json({ since, byButton });
});

adminRouter.get('/analytics/button/:id', requireRole('admin'), async (req, res) => {
  const bid = String(req.params.id || '').slice(0, 64);
  if (!bid) return res.status(400).json({ error: 'invalid_id' });
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const byHour = await ClickEvent.aggregate([
    { $match: { buttonId: bid, createdAt: { $gte: since } } },
    { $group: { _id: { $hour: { date: '$createdAt', timezone: 'Asia/Bangkok' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const byVariant = await ClickEvent.aggregate([
    { $match: { buttonId: bid, createdAt: { $gte: since } } },
    { $group: { _id: { $ifNull: ['$variant', ''] }, count: { $sum: 1 } } },
  ]);
  res.json({ buttonId: bid, byHour, byVariant });
});

// ── Audit log read + CSV export ─────────────────────────────
const auditQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  action: z.string().max(64).optional(),
});

adminRouter.get('/audit', requireRole('admin'), async (req, res) => {
  const parsed = auditQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { limit, cursor, action } = parsed.data;
  const q = {};
  if (cursor) { const d = new Date(cursor); if (!isNaN(d)) q.createdAt = { $lt: d }; }
  if (action) q.action = action;
  const rows = await AuditLog.find(q, { diff: 0 }).sort({ createdAt: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  res.json({ rows: page, nextCursor: hasMore ? page[page.length - 1].createdAt : null });
});

adminRouter.get('/audit/export', requireRole('admin'), async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await AuditLog.find({ createdAt: { $gte: since } }, { diff: 0 })
    .sort({ createdAt: -1 }).limit(50000).lean();
  const cols = ['createdAt', 'action', 'actorEmail', 'target', 'outcome', 'ipHash', 'userAgent'];
  const out = toCsvStream(rows.map(r => ({
    ...r, createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : '',
  })), cols);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(out);
});

// ── Users list + search ─────────────────────────────────────
const listUsersQuery = z.object({
  q:     z.string().max(64).optional(),
  role:  z.enum(['', 'admin', 'editor']).optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

adminRouter.get('/users', requireRole('admin'), async (req, res) => {
  const parsed = listUsersQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { q, role, page, limit } = parsed.data;
  const filter = {};
  if (q) filter.$or = [
    { loginId: { $regex: q.toLowerCase().replace(/[^a-z0-9._@-]/g, ''), $options: 'i' } },
    { displayName: { $regex: q.replace(/[^\p{L}\p{N}\s]/gu, ''), $options: 'i' } },
  ];
  if (role) filter.role = role;
  const total = await User.countDocuments(filter);
  const users = await User.find(filter, {
    loginId: 1, displayName: 1, email: 1, role: 1, lastLoginAt: 1, lastLoginIp: 1,
    disabledAt: 1, createdAt: 1, tokenVersion: 1, mustChangePassword: 1, totpEnabled: 1,
  }).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit).lean();
  res.json({
    rows: users.map(u => ({ ...u, _id: String(u._id) })),
    total, page, limit, pages: Math.ceil(total / limit),
  });
});

adminRouter.post('/users', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  const parsed = createUserBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const { loginId, password, role, email, displayName } = parsed.data;
  const existing = await User.findOne({ loginId });
  if (existing) return res.status(409).json({ error: 'login_id_taken' });
  const u = new User({ loginId, role, createdBy: req.user.id, email: email || '', displayName: displayName || '' });
  try { await u.setPassword(password, [loginId, email || '']); }
  catch (e) { return res.status(400).json({ error: e.reason || 'weak_password', suggestions: e.details?.suggestions || [] }); }
  await u.save();
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'user_create', target: 'User:' + String(u._id),
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { created: { loginId, role } },
  });
  res.json({ ok: true, user: { id: String(u._id), loginId: u.loginId, role: u.role } });
});

const userIdParam = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/i, 'invalid_id') });

async function isLastActiveAdmin(userId) {
  const count = await User.countDocuments({ role: 'admin', disabledAt: null, _id: { $ne: userId } });
  return count === 0;
}

// Atomically disable a user ONLY if they're not the last active admin.
// Uses a single updateOne with a compound predicate so two concurrent
// disable calls cannot both succeed and leave zero admins.
async function atomicDisableUser(targetId, actorId) {
  // Phase 1: read target role so we only gate admins
  const target = await User.findById(targetId);
  if (!target) return { err: 'not_found' };
  if (target.disabledAt) return { err: 'already_disabled', target };

  if (target.role === 'admin') {
    // Count OTHER active admins. If zero, reject.
    // Then the update predicate checks again to close the race.
    const others = await User.countDocuments({ role: 'admin', disabledAt: null, _id: { $ne: targetId } });
    if (others === 0) return { err: 'last_admin' };

    // Atomic update: only succeed if target is STILL not disabled.
    // Another racing call would see disabledAt and fall through.
    const r = await User.updateOne(
      { _id: targetId, disabledAt: null, role: 'admin' },
      { $set: { disabledAt: new Date(), disabledBy: actorId }, $inc: { tokenVersion: 1 } },
    );
    if (r.modifiedCount === 0) return { err: 'concurrent_modification' };
    // After success, verify we still have >=1 active admin — if not,
    // roll back (extremely rare race: two admins disabled simultaneously).
    const remaining = await User.countDocuments({ role: 'admin', disabledAt: null });
    if (remaining === 0) {
      await User.updateOne({ _id: targetId }, { $set: { disabledAt: null, disabledBy: null } });
      return { err: 'last_admin' };
    }
    return { ok: true, target };
  }

  // Non-admin: straightforward atomic disable
  const r = await User.updateOne(
    { _id: targetId, disabledAt: null },
    { $set: { disabledAt: new Date(), disabledBy: actorId }, $inc: { tokenVersion: 1 } },
  );
  if (r.modifiedCount === 0) return { err: 'concurrent_modification' };
  return { ok: true, target };
}

adminRouter.post('/users/:id/disable', requireRole('admin'), async (req, res) => {
  const p = userIdParam.safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: 'invalid_id' });
  if (p.data.id === req.user.id) return res.status(400).json({ error: 'self_disable_forbidden' });
  const result = await atomicDisableUser(p.data.id, req.user.id);
  if (result.err) return res.status(result.err === 'not_found' ? 404 : 400).json({ error: result.err });
  const target = result.target;
  await revokeAllForUser(target._id, 'user_disabled');
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'user_disable', target: 'User:' + String(target._id),
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/enable', requireRole('admin'), async (req, res) => {
  const p = userIdParam.safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: 'invalid_id' });
  const target = await User.findById(p.data.id);
  if (!target) return res.status(404).json({ error: 'not_found' });
  target.disabledAt = null;
  target.disabledBy = null;
  await target.save();
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'user_enable', target: 'User:' + String(target._id),
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

const roleBody = z.object({ role: z.enum(['admin', 'editor']) });
adminRouter.patch('/users/:id/role', requireRole('admin'), async (req, res) => {
  const p = userIdParam.safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: 'invalid_id' });
  const b = roleBody.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'invalid_input' });
  const target = await User.findById(p.data.id);
  if (!target) return res.status(404).json({ error: 'not_found' });
  if (String(target._id) === req.user.id && b.data.role !== 'admin') return res.status(400).json({ error: 'self_demote_forbidden' });
  const before = target.role;

  // Demoting last admin: atomic — update only if another active admin still exists.
  if (before === 'admin' && b.data.role !== 'admin') {
    const others = await User.countDocuments({ role: 'admin', disabledAt: null, _id: { $ne: target._id } });
    if (others === 0) return res.status(400).json({ error: 'last_admin' });
    const r = await User.updateOne(
      { _id: target._id, role: 'admin' },
      { $set: { role: b.data.role }, $inc: { tokenVersion: 1 } },
    );
    if (r.modifiedCount === 0) return res.status(409).json({ error: 'concurrent_modification' });
    const remaining = await User.countDocuments({ role: 'admin', disabledAt: null });
    if (remaining === 0) {
      await User.updateOne({ _id: target._id }, { $set: { role: 'admin' } });
      return res.status(400).json({ error: 'last_admin' });
    }
  } else {
    target.role = b.data.role;
    await target.save();
    await User.findOneAndUpdate({ _id: target._id }, { $inc: { tokenVersion: 1 } });
  }
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'user_role_change', target: 'User:' + String(target._id),
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { from: before, to: b.data.role },
  });
  res.json({ ok: true, role: target.role });
});

adminRouter.post('/users/:id/reset-password', requireRole('admin'), async (req, res) => {
  const p = userIdParam.safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: 'invalid_id' });
  const target = await User.findById(p.data.id);
  if (!target) return res.status(404).json({ error: 'not_found' });
  if (target.disabledAt) return res.status(400).json({ error: 'user_disabled' });
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let temp = '';
  for (let i = 0; i < 14; i++) temp += alphabet[crypto.randomInt(0, alphabet.length)];
  await target.setPasswordUnsafe(temp);
  target.mustChangePassword = true;
  target.failedLoginCount = 0;
  target.lockUntil = null;
  target.tokenVersion = (target.tokenVersion || 0) + 1;
  await target.save();
  await revokeAllForUser(target._id, 'admin_reset_password');
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'password_reset', target: 'User:' + String(target._id),
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true, tempPassword: temp });
});

adminRouter.post('/users/:id/revoke-sessions', requireRole('admin'), async (req, res) => {
  const p = userIdParam.safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: 'invalid_id' });
  const target = await User.findById(p.data.id);
  if (!target) return res.status(404).json({ error: 'not_found' });
  await revokeAllForUser(target._id, 'admin_revoked');
  await User.findOneAndUpdate({ _id: target._id }, { $inc: { tokenVersion: 1 } });
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'sessions_revoke', target: 'User:' + String(target._id),
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

// ── Own password change ─────────────────────────────────────
// `currentPassword` is required UNLESS the account still has the
// mustChangePassword flag (first login after auto-seed or admin reset).
// The user has already proven they know the default password by logging
// in with it — asking for it again is pure friction AND often gets them
// stuck when the default was auto-generated and they never memorised it.
const pwChangeBody = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(12).max(200),
});

adminRouter.post('/me/password', adminWriteLimiter, validate(pwChangeBody), async (req, res) => {
  const me = await User.findById(req.user.id).select('+passwordHash');
  if (!me) return res.status(401).json({ error: 'unauthorized' });

  const isFirstTime = !!me.mustChangePassword;
  if (!isFirstTime) {
    if (!req.body.currentPassword) {
      return res.status(400).json({ error: 'current_password_required' });
    }
    const ok = await me.verifyPassword(req.body.currentPassword);
    if (!ok) {
      await AuditLog.create({
        actorId: me._id, actorEmail: me.loginId,
        action: 'password_change_fail', outcome: 'failure',
        ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
      });
      return res.status(401).json({ error: 'invalid_credentials' });
    }
  }

  try { await me.setPassword(req.body.newPassword, [me.loginId, me.email]); }
  catch (e) { return res.status(400).json({ error: e.reason || 'weak_password', suggestions: (e.details && e.details.suggestions) || [] }); }
  me.mustChangePassword = false;
  await me.save();
  await revokeAllForUser(me._id, 'password_changed');
  await User.findOneAndUpdate({ _id: me._id }, { $inc: { tokenVersion: 1 } });
  await AuditLog.create({
    actorId: me._id, actorEmail: me.loginId,
    action: isFirstTime ? 'password_first_setup' : 'password_change', outcome: 'success',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

// ── Own sessions (list + revoke) ────────────────────────────
adminRouter.get('/me/sessions', async (req, res) => {
  const rows = await RefreshToken.find({ userId: req.user.id, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 }).limit(50).lean();
  res.json({
    rows: rows.map(r => ({
      jti: r._id, createdAt: r.createdAt, ip: r.ip,
      userAgent: r.userAgent, expiresAt: r.expiresAt,
    })),
  });
});

adminRouter.delete('/me/sessions/:jti', async (req, res) => {
  const jti = String(req.params.jti || '').slice(0, 64);
  await revokeOne(jti, req.user.id);
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'self_session_revoke', target: 'Session:' + jti,
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

adminRouter.post('/me/sessions/revoke-all', async (req, res) => {
  await revokeAllForUser(req.user.id, 'self_revoke_all');
  await User.findOneAndUpdate({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'self_sessions_revoke_all',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

// ── 2FA / TOTP ──────────────────────────────────────────────
// The setup window is limited: /setup stores a pending secret; /enable must
// be called within TOTP_SETUP_TTL_MS while presenting a valid 6-digit code.
// Without this TTL, an attacker who transiently controls a session could leave
// a dormant secret in the DB and later brute-force the 6-digit code.
const TOTP_SETUP_TTL_MS = 15 * 60 * 1000;

adminRouter.post('/me/totp/setup', adminWriteLimiter, async (req, res) => {
  const me = await User.findById(req.user.id).select('+totpSecret');
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  if (me.totpEnabled) return res.status(400).json({ error: 'already_enabled' });
  const { base32, otpauth_url } = generateSecret(me.loginId);
  me.totpSecret = base32;
  me.totpEnabled = false;
  me.totpPendingAt = new Date();
  await me.save();
  const qr = await qrDataUrl(otpauth_url);
  res.json({ secret: base32, qr, expiresInMs: TOTP_SETUP_TTL_MS });
});

const totpEnableBody = z.object({ code: z.string().length(6).regex(/^\d+$/, 'digits_only') });

adminRouter.post('/me/totp/enable', adminWriteLimiter, async (req, res) => {
  const p = totpEnableBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid_input' });
  const me = await User.findById(req.user.id).select('+totpSecret +totpPendingAt');
  if (!me || !me.totpSecret) return res.status(400).json({ error: 'no_pending_setup' });
  if (me.totpEnabled) return res.status(400).json({ error: 'already_enabled' });
  if (!me.totpPendingAt || Date.now() - new Date(me.totpPendingAt).getTime() > TOTP_SETUP_TTL_MS) {
    // Stale setup — clear and force restart
    await User.updateOne({ _id: me._id }, { $set: { totpSecret: '', totpPendingAt: null } });
    return res.status(400).json({ error: 'setup_expired' });
  }
  const enableDelta = verifyTotpDelta(me.totpSecret, p.data.code);
  if (enableDelta === null) return res.status(400).json({ error: 'invalid_totp' });
  // Seed lastTotpStep so the very code the admin just used to enable
  // 2FA cannot be replayed as a login code within its validity window.
  const enableStep = currentTotpStep() + enableDelta;
  const codes = generateBackupCodes(10);
  me.totpEnabled = true;
  me.totpPendingAt = null;
  me.totpBackupCodes = codes.map(hashBackupCode);
  me.lastTotpStep = enableStep;
  await me.save();
  await AuditLog.create({
    actorId: me._id, actorEmail: me.loginId, action: 'totp_enable',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true, backupCodes: codes });   // shown ONCE
});

const totpDisableBody = z.object({ password: z.string().min(1).max(200) });

adminRouter.post('/me/totp/disable', adminWriteLimiter, async (req, res) => {
  const p = totpDisableBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid_input' });
  const me = await User.findById(req.user.id).select('+passwordHash');
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  const ok = await me.verifyPassword(p.data.password);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  // Reset lastTotpStep on disable so a future re-enable starts fresh
  // (the user may re-bind a different authenticator app with a
  // brand-new secret; the old step counter would be meaningless).
  await User.updateOne({ _id: me._id }, { $set: { totpEnabled: false, totpSecret: '', totpBackupCodes: [], lastTotpStep: 0 } });
  await AuditLog.create({
    actorId: me._id, actorEmail: me.loginId, action: 'totp_disable',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

// ── Web Push broadcast (admin only) ─────────────────────────
// The `url` field is validated through safeUrl so pushes can't deliver
// javascript: / data: / cross-origin phishing URLs to subscribers who click
// the notification. Sending runs with bounded concurrency and a per-call
// timeout so a hung push endpoint can't tie up the server.
const pushBody = z.object({
  title: z.string().min(1).max(80),
  body: z.string().max(200).optional(),
  url: z.string().max(2048).optional(),
});
const PUSH_CONCURRENCY = 10;
const PUSH_TIMEOUT_MS = 5000;
const PUSH_MAX_SUBS = 5000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('push_timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
                 e => { clearTimeout(t); reject(e); });
  });
}

adminRouter.post('/push/broadcast', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  if (!env.PUSH_VAPID_PUBLIC || !env.PUSH_VAPID_PRIVATE) return res.status(400).json({ error: 'push_disabled' });
  const p = pushBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid_input' });

  // Validate destination URL — reject anything safeUrl won't accept.
  // Empty => default to root. Non-empty but rejected => 400 so the admin knows.
  let safeClickUrl = '/';
  if (p.data.url) {
    const cleaned = safeUrl(p.data.url);
    if (!cleaned && p.data.url.trim() !== '/') {
      return res.status(400).json({ error: 'invalid_url' });
    }
    safeClickUrl = cleaned || '/';
  }

  const subs = await PushSubscription.find({}, {}).limit(PUSH_MAX_SUBS).lean();
  const payload = JSON.stringify({
    title: safeText(p.data.title, 80),
    body: safeText(p.data.body || '', 200),
    url: safeClickUrl,
  });

  // Defense-in-depth vs. SSRF: re-validate each subscription endpoint
  // against the known push-service allowlist at broadcast time too.
  // /push/subscribe enforces this on new rows, but legacy rows stored
  // before the allowlist was added could have arbitrary URLs — we must
  // never hand them to web-push.sendNotification.
  const PUSH_HOST_ALLOWLIST = [
    'fcm.googleapis.com',
    'updates.push.services.mozilla.com',
    'notify.windows.com',
    'push.apple.com',
  ];
  function isSafePushEndpoint(raw) {
    if (typeof raw !== 'string' || raw.length > 1024) return false;
    let u; try { u = new URL(raw); } catch { return false; }
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    for (const base of PUSH_HOST_ALLOWLIST) {
      if (h === base || h.endsWith('.' + base)) return true;
    }
    return false;
  }
  const rejectedEndpoints = [];
  const safeSubs = subs.filter(s => {
    if (isSafePushEndpoint(s.endpoint)) return true;
    rejectedEndpoints.push(s.endpoint);
    return false;
  });
  if (rejectedEndpoints.length) {
    try { await PushSubscription.deleteMany({ endpoint: { $in: rejectedEndpoints } }); } catch {}
    log.warn({ count: rejectedEndpoints.length }, 'push_broadcast_rejected_unsafe_endpoints');
  }

  let sent = 0, failed = 0;
  const staleEndpoints = [];

  async function sendOne(s) {
    try {
      await withTimeout(
        webPush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 60 }),
        PUSH_TIMEOUT_MS,
      );
      sent++;
    } catch (e) {
      failed++;
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        staleEndpoints.push(s.endpoint);
      }
    }
  }

  // Bounded concurrency: process PUSH_CONCURRENCY subscriptions at a time.
  for (let i = 0; i < safeSubs.length; i += PUSH_CONCURRENCY) {
    const batch = safeSubs.slice(i, i + PUSH_CONCURRENCY);
    await Promise.all(batch.map(sendOne));
  }

  if (staleEndpoints.length) {
    try { await PushSubscription.deleteMany({ endpoint: { $in: staleEndpoints } }); } catch {}
  }

  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'push_broadcast', target: String(sent), outcome: 'success',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { title: p.data.title, url: safeClickUrl, sent, failed, pruned: staleEndpoints.length, rejected: rejectedEndpoints.length },
  });
  res.json({ sent, failed, pruned: staleEndpoints.length, rejected: rejectedEndpoints.length });
});

function slim(doc) {
  if (!doc) return null;
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  return rest;
}
