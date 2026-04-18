// routes/admin.js — authenticated admin endpoints.

import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { getAppConfig } from '../models/AppConfig.js';
import { ClickEvent } from '../models/ClickEvent.js';
import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { adminWriteLimiter } from '../middleware/rateLimit.js';
import { validate, configBody } from '../middleware/validate.js';
import { sanitizeConfig, hashIp, safeText } from '../utils/sanitize.js';
import { revokeAllForUser } from '../utils/tokens.js';
import { invalidateConfigCache } from './public.js';

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.use(verifyCsrf);

// ── Current user ("me") ─────────────────────────────────────
adminRouter.get('/me', async (req, res) => {
  const me = await User.findById(req.user.id, {
    loginId: 1, role: 1, mustChangePassword: 1,
    lastLoginAt: 1, lastLoginIp: 1, createdAt: 1,
  }).lean();
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  res.json({
    id: String(me._id),
    loginId: me.loginId,
    role: me.role,
    mustChangePassword: !!me.mustChangePassword,
    lastLoginAt: me.lastLoginAt,
    lastLoginIp: me.lastLoginIp,
    createdAt: me.createdAt,
  });
});

// ── Dashboard summary ──────────────────────────────────────
adminRouter.get('/stats', requireRole('admin', 'editor'), async (req, res) => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [userCount, activeUsers, clickToday, clickWeek, failedToday, cfg] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ disabledAt: null }),
    ClickEvent.countDocuments({ createdAt: { $gte: dayAgo } }),
    ClickEvent.countDocuments({ createdAt: { $gte: weekAgo } }),
    AuditLog.countDocuments({ action: { $in: ['login_fail', 'login_unknown', 'login_locked'] }, createdAt: { $gte: dayAgo } }),
    getAppConfig(),
  ]);

  res.json({
    users:    { total: userCount, active: activeUsers },
    clicks:   { today: clickToday, week: clickWeek },
    security: { failedLogins24h: failedToday },
    config:   {
      appName: cfg.appName,
      buttons: cfg.buttons.length,
      banners: cfg.banners.length,
      updatedAt: cfg.updatedAt,
    },
  });
});

// ── Config read / write ─────────────────────────────────────
adminRouter.get('/config', requireRole('admin', 'editor'), async (req, res) => {
  const cfg = await getAppConfig();
  res.json({
    appName: cfg.appName,
    tagline: cfg.tagline,
    theme: cfg.theme,
    banners: cfg.banners,
    buttons: cfg.buttons,
    contact: cfg.contact,
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
    appName: clean.appName,
    tagline: clean.tagline,
    theme: clean.theme,
    banners: clean.banners,
    buttons: clean.buttons,
    contact: clean.contact,
    updatedBy: req.user.id,
  });
  try { await cfg.save(); }
  catch (e) {
    if (e && e.name === 'VersionError') return res.status(409).json({ error: 'stale_version' });
    throw e;
  }

  invalidateConfigCache();
  await AuditLog.create({
    actorId: req.user.id,
    actorEmail: req.user.loginId,
    action: 'config_update',
    target: 'AppConfig:singleton',
    ipHash: hashIp(req.ip),
    userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { before: slim(before), after: slim(cfg.toObject()) },
  });

  res.json({ ok: true, updatedAt: cfg.updatedAt });
});

// ── Analytics — bounded aggregation ─────────────────────────
// $addToSet is memory-bound; we pre-dedup by (buttonId, ipHash) via $first
// in a $group. Then count. Safe for large volumes.
adminRouter.get('/analytics', requireRole('admin'), async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const byButton = await ClickEvent.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { buttonId: '$buttonId', ipHash: '$ipHash' } } },
    { $group: {
        _id: '$_id.buttonId',
        uniques: { $sum: 1 },
      } },
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

// ── Audit log read ──────────────────────────────────────────
const auditQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),   // ISO date of oldest seen row
  action: z.string().max(64).optional(),
});

adminRouter.get('/audit', requireRole('admin'), async (req, res) => {
  const parsed = auditQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { limit, cursor, action } = parsed.data;

  const q = {};
  if (cursor) {
    const d = new Date(cursor);
    if (!isNaN(d)) q.createdAt = { $lt: d };
  }
  if (action) q.action = action;

  const rows = await AuditLog.find(q, { diff: 0 })
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  res.json({
    rows: page,
    nextCursor: hasMore ? page[page.length - 1].createdAt : null,
  });
});

// ── User management ────────────────────────────────────────
adminRouter.get('/users', requireRole('admin'), async (req, res) => {
  const users = await User.find({}, {
    loginId: 1, role: 1, lastLoginAt: 1, lastLoginIp: 1,
    disabledAt: 1, createdAt: 1, tokenVersion: 1, mustChangePassword: 1,
  }).sort({ createdAt: 1 }).limit(200).lean();
  res.json({ rows: users.map(u => ({ ...u, _id: String(u._id) })) });
});

// Create a new admin/editor — admin role only.
adminRouter.post('/users', adminWriteLimiter, requireRole('admin'), async (req, res) => {
  const { createUserBody } = await import('../middleware/validate.js');
  const parsed = createUserBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const { loginId, password, role } = parsed.data;

  const existing = await User.findOne({ loginId });
  if (existing) return res.status(409).json({ error: 'login_id_taken' });

  const u = new User({ loginId, role, createdBy: req.user.id });
  try { await u.setPassword(password, [loginId]); }
  catch (e) {
    return res.status(400).json({
      error: e.reason || 'weak_password',
      suggestions: (e.details && e.details.suggestions) || [],
    });
  }
  await u.save();
  await AuditLog.create({
    actorId: req.user.id,
    actorEmail: req.user.loginId,
    action: 'user_create',
    target: 'User:' + String(u._id),
    ipHash: hashIp(req.ip),
    userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { created: { loginId, role } },
  });
  res.json({ ok: true, user: { id: String(u._id), loginId: u.loginId, role: u.role } });
});

const userIdParam = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/i, 'invalid_id') });

// Returns true if `userId` is the LAST active admin.
async function isLastActiveAdmin(userId) {
  const count = await User.countDocuments({
    role: 'admin',
    disabledAt: null,
    _id: { $ne: userId },
  });
  return count === 0;
}

adminRouter.post('/users/:id/disable', requireRole('admin'), async (req, res) => {
  const p = userIdParam.safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: 'invalid_id' });
  if (p.data.id === req.user.id) return res.status(400).json({ error: 'self_disable_forbidden' });

  const target = await User.findById(p.data.id);
  if (!target) return res.status(404).json({ error: 'not_found' });

  // Never allow the last active admin to be disabled.
  if (target.role === 'admin' && await isLastActiveAdmin(target._id)) {
    return res.status(400).json({ error: 'last_admin' });
  }

  target.disabledAt = new Date();
  target.disabledBy = req.user.id;
  await target.save();
  await revokeAllForUser(target._id, 'user_disabled');
  await User.findOneAndUpdate({ _id: target._id }, { $inc: { tokenVersion: 1 } });

  await AuditLog.create({
    actorId: req.user.id,
    actorEmail: req.user.loginId,
    action: 'user_disable',
    target: 'User:' + String(target._id),
    ipHash: hashIp(req.ip),
    userAgent: safeText(req.get('user-agent') || '', 200),
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
    actorId: req.user.id,
    actorEmail: req.user.loginId,
    action: 'user_enable',
    target: 'User:' + String(target._id),
    ipHash: hashIp(req.ip),
    userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

// ── Change role (admin ↔ editor) ───────────────────────────
const roleBody = z.object({ role: z.enum(['admin', 'editor']) });

adminRouter.patch('/users/:id/role', requireRole('admin'), async (req, res) => {
  const p = userIdParam.safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: 'invalid_id' });
  const b = roleBody.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'invalid_input' });

  const target = await User.findById(p.data.id);
  if (!target) return res.status(404).json({ error: 'not_found' });

  // Self-demotion guard — prevents the only admin from locking themselves out.
  if (String(target._id) === req.user.id && b.data.role !== 'admin') {
    return res.status(400).json({ error: 'self_demote_forbidden' });
  }
  // Never let the last admin be demoted.
  if (target.role === 'admin' && b.data.role !== 'admin' && await isLastActiveAdmin(target._id)) {
    return res.status(400).json({ error: 'last_admin' });
  }

  const before = target.role;
  target.role = b.data.role;
  await target.save();

  // Bump tokenVersion so existing sessions re-fetch /me and pick up new role.
  await User.findOneAndUpdate({ _id: target._id }, { $inc: { tokenVersion: 1 } });

  await AuditLog.create({
    actorId: req.user.id,
    actorEmail: req.user.loginId,
    action: 'user_role_change',
    target: 'User:' + String(target._id),
    ipHash: hashIp(req.ip),
    userAgent: safeText(req.get('user-agent') || '', 200),
    diff: { from: before, to: b.data.role },
  });
  res.json({ ok: true, role: target.role });
});

// ── Reset another user's password (admin only) ─────────────
// Generates a random temp password, sets mustChangePassword=true, returns
// the temp password ONCE in the response. Admin should share it out-of-band.
adminRouter.post('/users/:id/reset-password', requireRole('admin'), async (req, res) => {
  const p = userIdParam.safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: 'invalid_id' });
  const target = await User.findById(p.data.id);
  if (!target) return res.status(404).json({ error: 'not_found' });
  if (target.disabledAt) return res.status(400).json({ error: 'user_disabled' });

  // 14-char base62 temp password — short enough for humans to type.
  const crypto = await import('node:crypto');
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let temp = '';
  for (let i = 0; i < 14; i++) temp += alphabet[crypto.default.randomInt(0, alphabet.length)];

  await target.setPasswordUnsafe(temp);   // temp bypasses policy; user must change on login
  target.mustChangePassword = true;
  target.failedLoginCount = 0;
  target.lockUntil = null;
  target.tokenVersion = (target.tokenVersion || 0) + 1;
  await target.save();

  // Revoke all active sessions of the target.
  await revokeAllForUser(target._id, 'admin_reset_password');

  await AuditLog.create({
    actorId: req.user.id,
    actorEmail: req.user.loginId,
    action: 'password_reset',
    target: 'User:' + String(target._id),
    ipHash: hashIp(req.ip),
    userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true, tempPassword: temp });
});

// ── Revoke sessions ────────────────────────────────────────
// Logs out every active session for the target user (by bumping tokenVersion
// and revoking all refresh tokens). Use when a session is suspected compromised.
adminRouter.post('/users/:id/revoke-sessions', requireRole('admin'), async (req, res) => {
  const p = userIdParam.safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: 'invalid_id' });
  const target = await User.findById(p.data.id);
  if (!target) return res.status(404).json({ error: 'not_found' });

  await revokeAllForUser(target._id, 'admin_revoked');
  await User.findOneAndUpdate({ _id: target._id }, { $inc: { tokenVersion: 1 } });

  await AuditLog.create({
    actorId: req.user.id,
    actorEmail: req.user.loginId,
    action: 'sessions_revoke',
    target: 'User:' + String(target._id),
    ipHash: hashIp(req.ip),
    userAgent: safeText(req.get('user-agent') || '', 200),
  });
  res.json({ ok: true });
});

// ── Password change (self) ──────────────────────────────────
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

  try {
    await me.setPassword(req.body.newPassword, [me.loginId]);
  } catch (e) {
    return res.status(400).json({
      error: e.reason || 'weak_password',
      suggestions: (e.details && e.details.suggestions) || [],
    });
  }
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

function slim(doc) {
  if (!doc) return null;
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  return rest;
}
