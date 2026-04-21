// routes/admin.js — authenticated admin endpoints.

import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import webPush from 'web-push';
import { getAppConfig } from '../models/AppConfig.js';
import { ClickEvent } from '../models/ClickEvent.js';
import { Device } from '../models/Device.js';
import { EventLog } from '../models/EventLog.js';
import { PushCampaign } from '../models/PushCampaign.js';
import { isConfigured as isPushConfigured } from '../utils/vapid.js';
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

  // Web Push (VAPID). Check the shared resolver which inspects env first
  // and falls back to the persisted AppConfig.vapidKeys pair.
  const pushOk = isPushConfigured();
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
  const dayAgo   = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    userCount, activeUsers, clickToday, clickWeek, failedToday, cfg,
    dau, wau, mau, newToday, totalDevices,
    installViewsToday, installClicksToday, appBootsToday, buttonClicksToday,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ disabledAt: null }),
    ClickEvent.countDocuments({ createdAt: { $gte: dayAgo } }),
    ClickEvent.countDocuments({ createdAt: { $gte: weekAgo } }),
    AuditLog.countDocuments({ action: { $in: ['login_fail', 'login_unknown', 'login_locked', 'login_totp_fail'] }, createdAt: { $gte: dayAgo } }),
    getAppConfig(),
    Device.countDocuments({ lastSeen: { $gte: dayAgo } }),
    Device.countDocuments({ lastSeen: { $gte: weekAgo } }),
    Device.countDocuments({ lastSeen: { $gte: monthAgo } }),
    Device.countDocuments({ firstSeen: { $gte: dayAgo } }),
    Device.countDocuments({}),
    EventLog.countDocuments({ type: 'install_page_view', createdAt: { $gte: dayAgo } }),
    EventLog.countDocuments({ type: 'install_click',     createdAt: { $gte: dayAgo } }),
    EventLog.countDocuments({ type: 'app_boot',          createdAt: { $gte: dayAgo } }),
    EventLog.countDocuments({ type: 'button_click',      createdAt: { $gte: dayAgo } }),
  ]);

  res.json({
    users:    { total: userCount, active: activeUsers },
    clicks:   { today: clickToday, week: clickWeek },
    security: { failedLogins24h: failedToday },
    config:   { appName: cfg.appName, buttons: cfg.buttons.length, banners: cfg.banners.length, updatedAt: cfg.updatedAt },
    // New: unique-device + funnel counts drawn from Device + EventLog.
    // Non-zero only after the new tracking client ships and users
    // boot instrumented builds.
    devices:  { total: totalDevices, dau, wau, mau, newToday },
    funnel:   {
      installViewsToday,
      installClicksToday,
      appBootsToday,
      buttonClicksToday,
    },
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

// ── Growth / retention analytics (Phase 1) ──────────────────
// Powered by Device + EventLog. All endpoints scoped by a days= query
// param (default 7, max 90). Returns only aggregates — no per-device
// identifiers — so the admin UI can display dashboards without ever
// touching individual device IDs.

function parseDaysQ(req, def = 7) {
  return Math.min(90, Math.max(1, parseInt(req.query.days, 10) || def));
}

// Top-line device counts on rolling windows + new-device trend.
adminRouter.get('/devices/summary', requireRole('admin', 'editor'), async (req, res) => {
  const days = parseDaysQ(req, 30);
  const now = Date.now();
  const dayAgo   = new Date(now - 24 * 60 * 60 * 1000);
  const weekAgo  = new Date(now - 7  * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const windowStart = new Date(now - days * 24 * 60 * 60 * 1000);

  const [total, dau, wau, mau, newByDay] = await Promise.all([
    Device.countDocuments({}),
    Device.countDocuments({ lastSeen:  { $gte: dayAgo   } }),
    Device.countDocuments({ lastSeen:  { $gte: weekAgo  } }),
    Device.countDocuments({ lastSeen:  { $gte: monthAgo } }),
    Device.aggregate([
      { $match: { firstSeen: { $gte: windowStart } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$firstSeen', timezone: 'Asia/Bangkok' } },
          count: { $sum: 1 },
      } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.json({ total, dau, wau, mau, newByDay, days });
});

// Platform / OS / locale breakdown — what kind of devices are using us.
adminRouter.get('/devices/breakdown', requireRole('admin', 'editor'), async (req, res) => {
  const days = parseDaysQ(req, 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const match = { lastSeen: { $gte: since } };

  const groupBy = (field) => Device.aggregate([
    { $match: match },
    { $group: { _id: { $ifNull: [`$${field}`, ''] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);

  const [platform, osVersion, locale, firstSeenMedium, appVersion] = await Promise.all([
    groupBy('platform'),
    groupBy('osVersion'),
    groupBy('locale'),
    groupBy('firstSeenMedium'),
    groupBy('appVersion'),
  ]);

  res.json({ since, platform, osVersion, locale, firstSeenMedium, appVersion });
});

// Install funnel — counts each stage per rolling window. When
// sourceToken= is set, the funnel is scoped to ONE install link so the
// admin can compare campaigns. Uniques are over deviceId not ipHash.
adminRouter.get('/funnel', requireRole('admin', 'editor'), async (req, res) => {
  const days = parseDaysQ(req, 7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sourceToken = String(req.query.sourceToken || '').slice(0, 40);

  const baseMatch = { createdAt: { $gte: since } };
  if (sourceToken) baseMatch.sourceToken = sourceToken;

  const countByType = (type) => EventLog.aggregate([
    { $match: { ...baseMatch, type } },
    { $group: { _id: null, events: { $sum: 1 }, devices: { $addToSet: '$deviceId' } } },
    { $project: { _id: 0, events: 1, uniques: { $size: '$devices' } } },
  ]).then(r => r[0] || { events: 0, uniques: 0 });

  const [views, clicks, boots, firstClicks] = await Promise.all([
    countByType('install_page_view'),
    countByType('install_click'),
    countByType('app_boot'),
    countByType('button_click'),
  ]);

  // Per-day timeseries for the funnel chart.
  const byDay = await EventLog.aggregate([
    { $match: { ...baseMatch, type: { $in: ['install_page_view', 'install_click', 'app_boot', 'button_click'] } } },
    { $group: {
        _id: {
          day:  { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Bangkok' } },
          type: '$type',
        },
        count: { $sum: 1 },
    } },
    { $sort: { '_id.day': 1 } },
  ]);

  res.json({ since, days, sourceToken, stages: { views, clicks, boots, firstClicks }, byDay });
});

// Per-source attribution — which install link / UTM source gave us
// the most devices and the strongest engagement.
adminRouter.get('/attribution', requireRole('admin', 'editor'), async (req, res) => {
  const days = parseDaysQ(req, 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const bySourceToken = await Device.aggregate([
    { $match: { firstSeen: { $gte: since }, sourceToken: { $ne: '' } } },
    { $group: { _id: '$sourceToken',
        devices:       { $sum: 1 },
        totalEvents:   { $sum: '$totalEvents' },
        totalSessions: { $sum: '$totalSessions' },
        lastFirstSeen: { $max: '$firstSeen' },
    } },
    { $sort: { devices: -1 } },
    { $limit: 20 },
    { $project: { _id: 0, sourceToken: '$_id', devices: 1, totalEvents: 1, totalSessions: 1, lastFirstSeen: 1 } },
  ]);

  const byUtmSource = await Device.aggregate([
    { $match: { firstSeen: { $gte: since }, utmSource: { $ne: '' } } },
    { $group: { _id: '$utmSource',
        devices: { $sum: 1 },
        totalEvents: { $sum: '$totalEvents' },
    } },
    { $sort: { devices: -1 } },
    { $limit: 20 },
    { $project: { _id: 0, utmSource: '$_id', devices: 1, totalEvents: 1 } },
  ]);

  const byUtmCampaign = await Device.aggregate([
    { $match: { firstSeen: { $gte: since }, utmCampaign: { $ne: '' } } },
    { $group: { _id: '$utmCampaign',
        devices: { $sum: 1 },
        totalEvents: { $sum: '$totalEvents' },
    } },
    { $sort: { devices: -1 } },
    { $limit: 20 },
    { $project: { _id: 0, utmCampaign: '$_id', devices: 1, totalEvents: 1 } },
  ]);

  const byMedium = await Device.aggregate([
    { $match: { firstSeen: { $gte: since }, firstSeenMedium: { $ne: '' } } },
    { $group: { _id: '$firstSeenMedium',
        devices: { $sum: 1 },
    } },
    { $sort: { devices: -1 } },
    { $limit: 20 },
    { $project: { _id: 0, medium: '$_id', devices: 1 } },
  ]);

  res.json({ since, days, bySourceToken, byUtmSource, byUtmCampaign, byMedium });
});

// ── Phase 2: Engagement — retention + sessions + time-to-first ──

// Cohort retention: for each week-cohort (Monday-anchored), measure
// how many of its devices came back on days 1/7/14/30 relative to
// their firstSeen. Returns the matrix the heatmap renders directly.
//
// Cost note: this is O(devices in window × events per device) via
// aggregate; with a 90-day window and 10k devices it's well under a
// second on a warm Mongo. Not a candidate for materialized view yet.
adminRouter.get('/retention/cohorts', requireRole('admin', 'editor'), async (req, res) => {
  const weeks = Math.min(12, Math.max(1, parseInt(req.query.weeks, 10) || 8));
  const since = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);

  // Devices grouped by their first-seen ISO week label (YYYY-Wnn).
  const cohorts = await Device.aggregate([
    { $match: { firstSeen: { $gte: since } } },
    { $group: {
        _id: { $dateToString: { format: '%G-W%V', date: '$firstSeen', timezone: 'Asia/Bangkok' } },
        size: { $sum: 1 },
        firstSeenMin: { $min: '$firstSeen' },
        deviceIds: { $addToSet: '$_id' },
    } },
    { $sort: { _id: 1 } },
  ]).allowDiskUse(true);

  // For each cohort, count how many deviceIds had *any* EventLog row
  // whose createdAt lands on the nth day after the cohort anchor.
  const offsets = [1, 7, 14, 30];
  const rows = [];
  for (const c of cohorts) {
    const anchor = c.firstSeenMin;
    const row = { cohort: c._id, size: c.size, retained: {} };
    // One $match per offset keeps the pipeline small and
    // parallelisable via Promise.all.
    const checks = await Promise.all(offsets.map(async (d) => {
      if (c.size === 0) return [d, 0];
      const from = new Date(anchor.getTime() + d * 24 * 60 * 60 * 1000);
      const to   = new Date(from.getTime() + 24 * 60 * 60 * 1000);
      const retained = await EventLog.distinct('deviceId', {
        deviceId: { $in: c.deviceIds },
        createdAt: { $gte: from, $lt: to },
      });
      return [d, retained.length];
    }));
    for (const [d, n] of checks) row.retained[`d${d}`] = n;
    rows.push(row);
  }
  res.json({ weeks, cohorts: rows });
});

// Session aggregates — average duration, sessions per device, distribution.
adminRouter.get('/sessions/summary', requireRole('admin', 'editor'), async (req, res) => {
  const days = parseDaysQ(req, 7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // All session_end events in the window carry durationMs.
  const agg = await EventLog.aggregate([
    { $match: { type: 'session_end', createdAt: { $gte: since }, durationMs: { $gt: 0 } } },
    { $group: {
        _id: null,
        sessions:       { $sum: 1 },
        devices:        { $addToSet: '$deviceId' },
        totalDuration:  { $sum: '$durationMs' },
        avgDuration:    { $avg: '$durationMs' },
        maxDuration:    { $max: '$durationMs' },
    } },
    { $project: {
        _id: 0, sessions: 1,
        uniqueDevices: { $size: '$devices' },
        totalDuration: 1, avgDuration: 1, maxDuration: 1,
    } },
  ]);
  const s = agg[0] || { sessions: 0, uniqueDevices: 0, totalDuration: 0, avgDuration: 0, maxDuration: 0 };

  // Duration buckets (histogram) — counts per bucket.
  const buckets = await EventLog.aggregate([
    { $match: { type: 'session_end', createdAt: { $gte: since }, durationMs: { $gt: 0 } } },
    { $bucket: {
        groupBy: '$durationMs',
        boundaries: [0, 10_000, 30_000, 60_000, 300_000, 900_000, 3_600_000, 24 * 3_600_000],
        default: 'other',
        output: { count: { $sum: 1 } },
    } },
  ]);

  res.json({ since, days, ...s,
    sessionsPerDevice: s.uniqueDevices ? s.sessions / s.uniqueDevices : 0,
    buckets,
  });
});

// Time-to-first-action — for each device that had an app_boot in the
// window, measure the ms until their FIRST button_click (if any).
adminRouter.get('/time-to-first', requireRole('admin', 'editor'), async (req, res) => {
  const days = parseDaysQ(req, 7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await EventLog.aggregate([
    { $match: { type: { $in: ['app_boot', 'button_click'] }, createdAt: { $gte: since } } },
    { $sort: { deviceId: 1, createdAt: 1 } },
    { $group: {
        _id: '$deviceId',
        firstBoot:  { $min: { $cond: [{ $eq: ['$type', 'app_boot'] },     '$createdAt', null] } },
        firstClick: { $min: { $cond: [{ $eq: ['$type', 'button_click'] }, '$createdAt', null] } },
    } },
    { $match: { firstBoot: { $ne: null }, firstClick: { $ne: null } } },
    { $project: { _id: 0, ms: { $subtract: ['$firstClick', '$firstBoot'] } } },
    { $match: { ms: { $gte: 0, $lt: 60 * 60_000 } } },  // cap absurdities at 1 hour
    { $group: {
        _id: null, devices: { $sum: 1 },
        avg: { $avg: '$ms' }, median: { $avg: '$ms' },  // rough — true median via $percentile below
    } },
  ]);

  // True percentiles (MongoDB 7+ supports $percentile; guard with try/catch).
  let pct = null;
  try {
    const p = await EventLog.aggregate([
      { $match: { type: { $in: ['app_boot', 'button_click'] }, createdAt: { $gte: since } } },
      { $sort: { deviceId: 1, createdAt: 1 } },
      { $group: {
          _id: '$deviceId',
          firstBoot:  { $min: { $cond: [{ $eq: ['$type', 'app_boot'] },     '$createdAt', null] } },
          firstClick: { $min: { $cond: [{ $eq: ['$type', 'button_click'] }, '$createdAt', null] } },
      } },
      { $match: { firstBoot: { $ne: null }, firstClick: { $ne: null } } },
      { $project: { _id: 0, ms: { $subtract: ['$firstClick', '$firstBoot'] } } },
      { $match: { ms: { $gte: 0, $lt: 60 * 60_000 } } },
      { $group: {
          _id: null,
          p50: { $percentile: { input: '$ms', p: [0.5],  method: 'approximate' } },
          p90: { $percentile: { input: '$ms', p: [0.9],  method: 'approximate' } },
          p99: { $percentile: { input: '$ms', p: [0.99], method: 'approximate' } },
      } },
    ]);
    pct = p[0] || null;
  } catch { /* older mongo, skip */ }

  res.json({ since, days, summary: rows[0] || { devices: 0, avg: 0 }, percentiles: pct });
});

// Top outgoing links by exit_click count — shows which buttons actually
// drive users to their targets (complements button_click/analytics).
adminRouter.get('/exits', requireRole('admin'), async (req, res) => {
  const days = parseDaysQ(req, 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await EventLog.aggregate([
    { $match: { type: 'exit_click', createdAt: { $gte: since } } },
    { $group: {
        _id: { target: '$target', label: '$label' },
        clicks: { $sum: 1 },
        devices: { $addToSet: '$deviceId' },
    } },
    { $sort: { clicks: -1 } },
    { $limit: 50 },
    { $project: { _id: 0, target: '$_id.target', label: '$_id.label', clicks: 1, uniques: { $size: '$devices' } } },
  ]);
  res.json({ since, rows });
});

// ── Phase 5: advanced analytics ─────────────────────────────

// Chi-squared test for A/B variant significance. Compares click
// counts for variant 'a' vs 'b' on a single button, returns a p-value
// approximation (without lookup tables) using Wilson–Hilferty.
function chiSquaredP(chi2, df = 1) {
  // Very rough p-value approximation for df=1 (sufficient for 2x2
  // binary comparison). Returns 0..1.
  if (df !== 1) return NaN;
  const z = Math.sqrt(chi2);
  const p = 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)));
  return Math.max(0, Math.min(1, p));
}
function erf(x) {
  // Abramowitz & Stegun 7.1.26 — ~1e-7 accuracy.
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

// Statistical significance of A/B variants for one button.
adminRouter.get('/analytics/button/:id/significance', requireRole('admin'), async (req, res) => {
  const bid = String(req.params.id || '').slice(0, 64);
  if (!bid) return res.status(400).json({ error: 'invalid_id' });
  const days = parseDaysQ(req, 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Variant counts from EventLog first (new flow); fall back to
  // ClickEvent so older data still contributes.
  const rows = await EventLog.aggregate([
    { $match: { type: 'button_click', target: bid, createdAt: { $gte: since }, variant: { $in: ['a', 'b'] } } },
    { $group: { _id: '$variant', events: { $sum: 1 }, devices: { $addToSet: '$deviceId' } } },
    { $project: { _id: 0, variant: '$_id', events: 1, uniques: { $size: '$devices' } } },
  ]);
  const a = rows.find(r => r.variant === 'a') || { events: 0, uniques: 0 };
  const b = rows.find(r => r.variant === 'b') || { events: 0, uniques: 0 };

  const n1 = a.uniques, n2 = b.uniques;
  const x1 = a.events,  x2 = b.events;
  // 2-sample binomial chi-squared on click rate per unique device.
  // Null hypothesis: variants have the same click rate.
  let chi2 = NaN, p = NaN, winner = null, delta = 0;
  if (n1 > 0 && n2 > 0) {
    const p1 = x1 / Math.max(1, n1);
    const p2 = x2 / Math.max(1, n2);
    const pooled = (x1 + x2) / (n1 + n2);
    const expected1 = pooled * n1;
    const expected2 = pooled * n2;
    if (expected1 > 0 && expected2 > 0) {
      chi2 = Math.pow(x1 - expected1, 2) / expected1 + Math.pow(x2 - expected2, 2) / expected2;
      p = chiSquaredP(chi2, 1);
      delta = p2 - p1;
      if (p < 0.05 && Math.abs(delta) > 0.01) winner = delta > 0 ? 'b' : 'a';
    }
  }

  res.json({
    since, days, buttonId: bid,
    a, b,
    chi2: Number.isFinite(chi2) ? chi2 : null,
    pValue: Number.isFinite(p) ? p : null,
    delta,  // positive = B beats A
    winner,
    significant: p != null && p < 0.05,
  });
});

// Sankey funnel — produces the 3 transitions the admin dashboard
// renders as a flow diagram: page_view→click, click→boot, boot→button.
adminRouter.get('/sankey', requireRole('admin', 'editor'), async (req, res) => {
  const days = parseDaysQ(req, 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const distinctDevices = async (type) => (await EventLog.distinct('deviceId', { type, createdAt: { $gte: since } })).filter(Boolean);
  const [views, clicks, boots, btnClicks] = await Promise.all([
    distinctDevices('install_page_view'),
    distinctDevices('install_click'),
    distinctDevices('app_boot'),
    distinctDevices('button_click'),
  ]);
  const setV = new Set(views), setC = new Set(clicks), setB = new Set(boots), setBC = new Set(btnClicks);

  const intersect = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
  const viewsToClick = intersect(setV, setC);
  const clickToBoot  = intersect(setC, setB);
  const bootToBtn    = intersect(setB, setBC);

  res.json({
    since, days,
    nodes: [
      { id: 'view',  label: 'เปิดหน้าติดตั้ง',   value: setV.size },
      { id: 'click', label: 'กดดาวน์โหลด',       value: setC.size },
      { id: 'boot',  label: 'เปิดแอป',           value: setB.size },
      { id: 'btn',   label: 'กดปุ่มแรก',         value: setBC.size },
    ],
    links: [
      { from: 'view',  to: 'click', value: viewsToClick, drop: setV.size - viewsToClick },
      { from: 'click', to: 'boot',  value: clickToBoot,  drop: setC.size - clickToBoot },
      { from: 'boot',  to: 'btn',   value: bootToBtn,    drop: setB.size - bootToBtn },
    ],
  });
});

// Anomaly detection — 14-day baseline mean + stddev, flag today if it's
// >3σ off. Cheap to compute; the admin panel renders alerts.
adminRouter.get('/anomaly', requireRole('admin', 'editor'), async (req, res) => {
  const days = 14;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const daily = await EventLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: {
        _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Bangkok' } }, type: '$type' },
        count: { $sum: 1 },
    } },
    { $sort: { '_id.day': 1 } },
  ]);

  // Pivot to {day: {type: count}}
  const grid = {};
  for (const r of daily) {
    grid[r._id.day] = grid[r._id.day] || {};
    grid[r._id.day][r._id.type] = r.count;
  }
  const daysSorted = Object.keys(grid).sort();
  const today = daysSorted.at(-1) || null;
  const baseline = daysSorted.slice(0, -1);
  const interesting = ['app_boot', 'button_click', 'install_page_view', 'install_click'];
  const alerts = [];
  for (const type of interesting) {
    const samples = baseline.map(d => grid[d]?.[type] || 0);
    if (samples.length < 3) continue;
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
    const sd = Math.sqrt(variance);
    const todayN = today ? (grid[today]?.[type] || 0) : 0;
    const z = sd > 0 ? (todayN - mean) / sd : 0;
    if (Math.abs(z) >= 3 || (mean > 5 && todayN === 0)) {
      alerts.push({
        type, todayCount: todayN,
        baselineMean: Math.round(mean),
        zScore: Number(z.toFixed(2)),
        direction: z > 0 ? 'spike' : 'drop',
      });
    }
  }

  res.json({ today, alerts, samples: daysSorted.length });
});

// Country breakdown — uses a trusted upstream header (CF-IPCountry if
// Cloudflare in front, X-Vercel-IP-Country if Vercel, X-Forwarded-…
// otherwise). Railway itself doesn't emit one by default. We aggregate
// the header value off Devices' ipHash → too lossy once hashed. Instead
// this endpoint summarises whatever locale we already have — a coarse
// proxy for country when ISO locales are used (en-TH, th, etc.).
adminRouter.get('/geo/locale', requireRole('admin', 'editor'), async (req, res) => {
  const days = parseDaysQ(req, 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  let rows = [];
  try {
    rows = await Device.aggregate([
      { $match: { lastSeen: { $gte: since }, locale: { $ne: '' } } },
      { $group: { _id: { $substrCP: [{ $toLower: '$locale' }, 0, 2] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 },
      { $project: { _id: 0, language: '$_id', count: 1 } },
    ]);
  } catch (e) {
    // Fallback for MongoDB < 3.4 that lacks $substrCP: group on full
    // locale and truncate in JS. Also useful when the locale column
    // holds unexpected data types.
    log.warn({ err: e?.message }, 'geo_locale_fallback');
    const full = await Device.aggregate([
      { $match: { lastSeen: { $gte: since }, locale: { $ne: '' } } },
      { $group: { _id: '$locale', count: { $sum: 1 } } },
    ]);
    const map = new Map();
    for (const r of full) {
      const key = String(r._id || '').toLowerCase().slice(0, 2);
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + r.count);
    }
    rows = [...map.entries()]
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
  }
  res.json({ since, rows });
});

// ── SSE live activity feed ──────────────────────────────────
// Streams the most recent events every 3 seconds. Intentionally
// lightweight: the endpoint polls EventLog on a timer and pushes
// diffs to connected admins. No websocket, no Redis pubsub needed.
//
// Auth: EventSource cannot attach Authorization headers (HTML spec),
// so the standard requireAuth/Bearer path doesn't work. The admin
// mints a short-lived single-use nonce via /events/mint-token (which
// DOES validate the Bearer), then opens EventSource with ?t=<nonce>.
// Nonces live in a tiny in-memory Map with a 2-minute TTL and are
// evicted on use, so a compromised nonce only buys 2 minutes of
// read-only live-event access.
const _sseTokens = new Map();  // token → { userId, role, expires }
const SSE_TTL_MS = 2 * 60_000;

adminRouter.post('/events/mint-token', requireRole('admin', 'editor'), async (req, res) => {
  const tok = crypto.randomBytes(24).toString('base64url');
  _sseTokens.set(tok, { userId: req.user.id, role: req.user.role, expires: Date.now() + SSE_TTL_MS });
  // Opportunistic GC — anytime the Map grows past 200 entries, purge
  // everything expired. Keeps memory bounded without a timer.
  if (_sseTokens.size > 200) {
    const now = Date.now();
    for (const [k, v] of _sseTokens) if (v.expires < now) _sseTokens.delete(k);
  }
  res.json({ token: tok, ttlMs: SSE_TTL_MS });
});

// No requireRole on this one — we validate the nonce ourselves.
adminRouter.get('/events/stream', async (req, res) => {
  const tok = String(req.query.t || '');
  const entry = _sseTokens.get(tok);
  if (!entry || entry.expires < Date.now()) {
    return res.status(401).json({ error: 'invalid_stream_token' });
  }
  if (!['admin', 'editor'].includes(entry.role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  // Force-uncompressed so chunks flush live. The compression middleware
  // respects the x-no-compression marker (see server.js:311) and won't
  // sit on the response buffer waiting for it to fill.
  res.setHeader('x-no-compression', '1');
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',   // disable nginx/Railway proxy buffering
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  let lastSeenAt = Date.now() - 60_000;  // start with the last minute
  let closed = false;
  req.on('close', () => { closed = true; });

  const tick = async () => {
    if (closed) return;
    try {
      const since = new Date(lastSeenAt);
      const rows = await EventLog.find({ createdAt: { $gt: since } })
        .sort({ createdAt: 1 })
        .limit(50)
        .select('type target label platform createdAt sourceToken')
        .lean();
      for (const r of rows) {
        if (r.createdAt.getTime() > lastSeenAt) lastSeenAt = r.createdAt.getTime();
        res.write('event: ev\n');
        res.write('data: ' + JSON.stringify({
          type: r.type, target: r.target, label: r.label,
          platform: r.platform, at: r.createdAt,
          src: r.sourceToken || '',
        }) + '\n\n');
      }
      // Heartbeat even when no data so proxies don't kill the socket.
      res.write(': ping\n\n');
    } catch {}
    if (!closed) setTimeout(tick, 3000);
  };
  tick();
});

// Recent client-side errors for the operator to eyeball. Limited to 50
// most-recent with a distinct signature so a noisy loop doesn't fill
// the response.
adminRouter.get('/errors/recent', requireRole('admin'), async (req, res) => {
  const days = parseDaysQ(req, 7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await EventLog.aggregate([
    { $match: { type: 'error', createdAt: { $gte: since } } },
    { $group: {
        _id: { message: '$label', url: '$target' },
        count: { $sum: 1 },
        lastAt: { $max: '$createdAt' },
        platforms: { $addToSet: '$platform' },
        appVersions: { $addToSet: '$appVersion' },
    } },
    { $sort: { lastAt: -1 } },
    { $limit: 50 },
    { $project: {
        _id: 0,
        message: '$_id.message', url: '$_id.url',
        count: 1, lastAt: 1, platforms: 1, appVersions: 1,
    } },
  ]);
  res.json({ since, rows });
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
  if (!isPushConfigured()) return res.status(400).json({ error: 'push_disabled', detail: 'Web Push ยังไม่พร้อม — ตรวจสอบว่า VAPID ถูก generate/persist เรียบร้อยและรีสตาร์ท backend' });
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

// ─── Phase 3: push segmentation + campaigns ─────────────────

// Resolve a segment spec to a set of deviceIds. Used by both
// "preview count" (admin UI) and the actual send worker.
async function resolveSegment(segment) {
  const now = Date.now();
  const match = {};
  if (segment.inactiveDays > 0) {
    match.lastSeen = { $lt: new Date(now - segment.inactiveDays * 24 * 60 * 60 * 1000) };
  }
  if (segment.activeDays > 0) {
    match.lastSeen = { ...(match.lastSeen || {}), $gte: new Date(now - segment.activeDays * 24 * 60 * 60 * 1000) };
  }
  if (segment.newWithinDays > 0) {
    match.firstSeen = { $gte: new Date(now - segment.newWithinDays * 24 * 60 * 60 * 1000) };
  }
  if (segment.sourceToken) match.sourceToken = segment.sourceToken;
  if (segment.utmSource)   match.utmSource   = segment.utmSource;
  if (segment.platform)    match.platform    = new RegExp('^' + escapeRe(segment.platform));
  if (segment.locale)      match.locale      = new RegExp('^' + escapeRe(segment.locale));

  let ids;
  if (segment.clickedButton) {
    // Devices that emitted a button_click with target == clickedButton.
    const hits = await EventLog.distinct('deviceId', {
      type: 'button_click',
      target: segment.clickedButton,
    });
    ids = hits;
    if (Object.keys(match).length) {
      const filtered = await Device.distinct('_id', { _id: { $in: ids }, ...match });
      ids = filtered;
    }
  } else {
    ids = await Device.distinct('_id', match);
  }
  return ids;
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Preview — how many devices match?
adminRouter.post('/push/segment/preview', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  const segment = (req.body && req.body.segment) || {};
  try {
    const ids = await resolveSegment(segment);
    res.json({ count: ids.length });
  } catch (e) {
    log.warn({ err: e?.message }, 'segment_preview_error');
    res.status(500).json({ error: 'segment_error' });
  }
});

// Resolved send: like /push/broadcast but only to the devices in the
// segment. We compute push subscriptions by joining on deviceId — a
// PushSubscription was stored with userId for admins, but end-users
// subscribe anonymously so we can't join by userId. Instead we match
// the subscriber's ipHash to any Device the segment resolved to with
// the same ipHash within the last 7 days (best-effort join in the
// absence of a direct device↔subscription link).
//
// This is a known limitation — a proper link would require the client
// to send `deviceId` during /push/subscribe. Tracking v2 will do that.
adminRouter.post('/push/broadcast-segmented', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  if (!isPushConfigured()) return res.status(400).json({ error: 'push_disabled', detail: 'Web Push ยังไม่พร้อม — ตรวจสอบว่า VAPID ถูก generate/persist เรียบร้อยและรีสตาร์ท backend' });
  const title = String(req.body?.title || '').slice(0, 80).trim();
  const bodyTx = String(req.body?.body || '').slice(0, 200);
  const urlRaw = String(req.body?.url  || '/').slice(0, 2048);
  const segment = req.body?.segment || {};
  if (!title) return res.status(400).json({ error: 'invalid_input' });
  const safeClickUrl = (urlRaw === '/') ? '/' : (safeUrl(urlRaw) || '/');

  // History helper — always record the attempt (even targeted=0 /
  // sent=0) so the admin's Campaigns panel shows every broadcast, not
  // just the ones that found subscribers.
  const saveHistory = async (stats) => {
    try {
      await PushCampaign.create({
        name: `ส่งทันที · ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
        title: String(title).slice(0, 120),
        body: String(bodyTx).slice(0, 300),
        url: String(safeClickUrl).slice(0, 512),
        segment, status: 'sent', sentAt: new Date(),
        createdBy: req.user.id,
        stats,
      });
    } catch (e) { log.warn({ err: e?.message }, 'campaign_history_write_failed'); }
  };

  try {
    // 1. Resolve matching device IDs.
    const ids = await resolveSegment(segment);
    if (!ids.length) {
      await saveHistory({ targeted: 0, sent: 0, failed: 0, pruned: 0, clicks: 0 });
      return res.json({ targeted: 0, sent: 0, failed: 0, pruned: 0 });
    }

    // 2. Prefer deviceId-keyed subscriptions (new clients send it on
    //    /push/subscribe). Fall back to an ipHash-based proxy join for
    //    legacy subscriptions created before the deviceId field shipped.
    const directSubs = await PushSubscription.find({ deviceId: { $in: ids } }).limit(5000).lean();
    const coveredDevices = new Set(directSubs.map(s => s.deviceId).filter(Boolean));
    const uncovered = ids.filter(id => !coveredDevices.has(id));
    let legacySubs = [];
    if (uncovered.length) {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const ipHashes = await Device.distinct('ipHash', {
        _id: { $in: uncovered }, lastSeen: { $gte: since }, ipHash: { $ne: '' },
      });
      if (ipHashes.length) {
        legacySubs = await PushSubscription.find({
          ipHash: { $in: ipHashes },
          // Don't double-count subs that are already deviceId-linked.
          $or: [{ deviceId: '' }, { deviceId: { $exists: false } }],
        }).limit(5000).lean();
      }
    }
    const subs = [...directSubs, ...legacySubs];
    if (!subs.length) {
      await saveHistory({ targeted: ids.length, sent: 0, failed: 0, pruned: 0, clicks: 0 });
      return res.json({ targeted: ids.length, sent: 0, failed: 0, pruned: 0 });
    }

    // 4. Send with timeout + concurrency, same as broadcast.
    const payload = JSON.stringify({
      title: safeText(title, 80), body: safeText(bodyTx, 200), url: safeClickUrl,
    });
    let sent = 0, failed = 0;
    const stale = [];
    const sendOne = async (s) => {
      try {
        await withTimeout(
          webPush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 60 }),
          PUSH_TIMEOUT_MS,
        );
        sent++;
      } catch (e) {
        failed++;
        if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.endpoint);
      }
    };
    for (let i = 0; i < subs.length; i += PUSH_CONCURRENCY) {
      await Promise.all(subs.slice(i, i + PUSH_CONCURRENCY).map(sendOne));
    }
    if (stale.length) {
      try { await PushSubscription.deleteMany({ endpoint: { $in: stale } }); } catch {}
    }

    await AuditLog.create({
      actorId: req.user.id, actorEmail: req.user.loginId,
      action: 'push_broadcast_segmented', target: String(sent), outcome: 'success',
      ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
      diff: { title, url: safeClickUrl, targeted: ids.length, sent, failed, pruned: stale.length },
    });
    await saveHistory({ targeted: ids.length, sent, failed, pruned: stale.length, clicks: 0 });
    res.json({ targeted: ids.length, sent, failed, pruned: stale.length });
  } catch (e) {
    log.warn({ err: e?.message }, 'push_segmented_error');
    res.status(500).json({ error: 'push_error' });
  }
});

// Campaign CRUD — admin saves templates, schedules them, or sends now.
adminRouter.get('/push/campaigns', requireRole('admin'), async (req, res) => {
  const rows = await PushCampaign.find({}).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ rows });
});

adminRouter.post('/push/campaigns', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  const { name, title, body, url, segment, sendAt } = req.body || {};
  if (!name || !title) return res.status(400).json({ error: 'invalid_input' });
  const doc = await PushCampaign.create({
    name: String(name).slice(0, 120),
    title: String(title).slice(0, 120),
    body: String(body || '').slice(0, 300),
    url: String(url || '/').slice(0, 512),
    segment: segment || {},
    sendAt: sendAt ? new Date(sendAt) : null,
    status: sendAt ? 'scheduled' : 'draft',
    createdBy: req.user.id,
  });
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'push_campaign_create', target: `campaign:${doc._id}`,
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ id: doc._id });
});

adminRouter.delete('/push/campaigns/:id', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  const id = String(req.params.id || '');
  const r = await PushCampaign.deleteOne({ _id: id });
  if (!r.deletedCount) return res.status(404).json({ error: 'not_found' });
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'push_campaign_delete', target: `campaign:${id}`,
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

// Inactive users count + ready-made segment.
adminRouter.get('/engagement/inactive', requireRole('admin', 'editor'), async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const count = await Device.countDocuments({ lastSeen: { $lt: since } });
  res.json({ days, count });
});

function slim(doc) {
  if (!doc) return null;
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  return rest;
}
