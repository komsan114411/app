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
import { uploadSingle } from '../middleware/upload.js';
import { sanitizeConfig, hashIp, safeText } from '../utils/sanitize.js';
import { revokeAllForUser, revokeOne } from '../utils/tokens.js';
import { generateSecret, qrDataUrl, verifyToken as verifyTotp, generateBackupCodes, hashBackupCode } from '../utils/totp.js';
import { toCsvStream } from '../utils/csv.js';
import { invalidateConfigCache } from './public.js';
import { env } from '../config/env.js';
import { log } from '../utils/logger.js';

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.use(verifyCsrf);

// Configure web-push VAPID once if keys are set
if (env.PUSH_VAPID_PUBLIC && env.PUSH_VAPID_PRIVATE) {
  try {
    webPush.setVapidDetails(env.PUSH_VAPID_SUBJECT, env.PUSH_VAPID_PUBLIC, env.PUSH_VAPID_PRIVATE);
  } catch (e) { log.warn({ err: e.message }, 'vapid_config_invalid'); }
}

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
    appName: cfg.appName, tagline: cfg.tagline, theme: cfg.theme,
    language: cfg.language || 'th', darkMode: cfg.darkMode || 'auto',
    banners: cfg.banners, buttons: cfg.buttons, contact: cfg.contact,
    featureFlags: cfg.featureFlags || {},
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
    appName: clean.appName, tagline: clean.tagline, theme: clean.theme,
    language: clean.language, darkMode: clean.darkMode,
    featureFlags: clean.featureFlags,
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

// ── Upload banner image (multipart) ─────────────────────────
adminRouter.post('/upload/banner', uploadLimiter, requireRole('admin', 'editor'), (req, res) => {
  uploadSingle(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
      if (err.message === 'unsupported_media_type') return res.status(415).json({ error: 'unsupported_media_type' });
      return res.status(400).json({ error: 'upload_failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    const url = '/uploads/' + req.file.filename;
    await AuditLog.create({
      actorId: req.user.id, actorEmail: req.user.loginId,
      action: 'banner_upload', target: url,
      ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    });
    res.json({ ok: true, url, size: req.file.size });
  });
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

adminRouter.post('/users/:id/disable', requireRole('admin'), async (req, res) => {
  const p = userIdParam.safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: 'invalid_id' });
  if (p.data.id === req.user.id) return res.status(400).json({ error: 'self_disable_forbidden' });
  const target = await User.findById(p.data.id);
  if (!target) return res.status(404).json({ error: 'not_found' });
  if (target.role === 'admin' && await isLastActiveAdmin(target._id)) return res.status(400).json({ error: 'last_admin' });
  target.disabledAt = new Date();
  target.disabledBy = req.user.id;
  await target.save();
  await revokeAllForUser(target._id, 'user_disabled');
  await User.findOneAndUpdate({ _id: target._id }, { $inc: { tokenVersion: 1 } });
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
  if (target.role === 'admin' && b.data.role !== 'admin' && await isLastActiveAdmin(target._id)) return res.status(400).json({ error: 'last_admin' });
  const before = target.role;
  target.role = b.data.role;
  await target.save();
  await User.findOneAndUpdate({ _id: target._id }, { $inc: { tokenVersion: 1 } });
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
const pwChangeBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

adminRouter.post('/me/password', adminWriteLimiter, validate(pwChangeBody), async (req, res) => {
  const me = await User.findById(req.user.id).select('+passwordHash');
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  const ok = await me.verifyPassword(req.body.currentPassword);
  if (!ok) {
    await AuditLog.create({
      actorId: me._id, actorEmail: me.loginId,
      action: 'password_change_fail', outcome: 'failure',
      ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  try { await me.setPassword(req.body.newPassword, [me.loginId, me.email]); }
  catch (e) { return res.status(400).json({ error: e.reason || 'weak_password', suggestions: (e.details && e.details.suggestions) || [] }); }
  me.mustChangePassword = false;
  await me.save();
  await revokeAllForUser(me._id, 'password_changed');
  await User.findOneAndUpdate({ _id: me._id }, { $inc: { tokenVersion: 1 } });
  await AuditLog.create({
    actorId: me._id, actorEmail: me.loginId,
    action: 'password_change', outcome: 'success',
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
adminRouter.post('/me/totp/setup', adminWriteLimiter, async (req, res) => {
  const me = await User.findById(req.user.id).select('+totpSecret');
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  const { base32, otpauth_url } = generateSecret(me.loginId);
  me.totpSecret = base32;
  me.totpEnabled = false;       // not enabled until verify step
  await me.save();
  const qr = await qrDataUrl(otpauth_url);
  res.json({ secret: base32, qr });
});

const totpEnableBody = z.object({ code: z.string().length(6).regex(/^\d+$/, 'digits_only') });

adminRouter.post('/me/totp/enable', adminWriteLimiter, async (req, res) => {
  const p = totpEnableBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid_input' });
  const me = await User.findById(req.user.id).select('+totpSecret');
  if (!me || !me.totpSecret) return res.status(400).json({ error: 'no_pending_setup' });
  if (!verifyTotp(me.totpSecret, p.data.code)) return res.status(400).json({ error: 'invalid_totp' });
  const codes = generateBackupCodes(10);
  me.totpEnabled = true;
  me.totpBackupCodes = codes.map(hashBackupCode);
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
  await User.updateOne({ _id: me._id }, { $set: { totpEnabled: false, totpSecret: '', totpBackupCodes: [] } });
  await AuditLog.create({
    actorId: me._id, actorEmail: me.loginId, action: 'totp_disable',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

// ── Web Push broadcast (admin only) ─────────────────────────
const pushBody = z.object({
  title: z.string().min(1).max(80),
  body: z.string().max(200).optional(),
  url: z.string().max(2048).optional(),
});

adminRouter.post('/push/broadcast', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  if (!env.PUSH_VAPID_PUBLIC || !env.PUSH_VAPID_PRIVATE) return res.status(400).json({ error: 'push_disabled' });
  const p = pushBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid_input' });
  const subs = await PushSubscription.find({}, {}).limit(5000).lean();
  const payload = JSON.stringify({ title: p.data.title, body: p.data.body || '', url: p.data.url || '/' });
  let sent = 0, failed = 0;
  for (const s of subs) {
    try {
      await webPush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) {
        await PushSubscription.deleteOne({ endpoint: s.endpoint });
      }
    }
  }
  await AuditLog.create({
    actorId: req.user.id, actorEmail: req.user.loginId,
    action: 'push_broadcast', target: String(sent), outcome: 'success',
    ipHash: hashIp(req.ip), userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { title: p.data.title, sent, failed },
  });
  res.json({ sent, failed });
});

function slim(doc) {
  if (!doc) return null;
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  return rest;
}
