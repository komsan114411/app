// utils/tokens.js — access JWT + refresh token with ATOMIC rotation.
// Supports secret rotation: verify with JWT_SECRET OR JWT_SECRET_PREV during
// a grace window (sign always with current JWT_SECRET).

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';

const ACCESS_TTL  = '15m';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GRACE_WINDOW_MS = 10 * 1000;

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function signAccess(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, v: user.tokenVersion || 0 },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: ACCESS_TTL, jwtid: crypto.randomUUID() }
  );
}

export function verifyAccess(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (primaryErr) {
    if (env.JWT_SECRET_PREV) {
      try {
        return jwt.verify(token, env.JWT_SECRET_PREV, { algorithms: ['HS256'] });
      } catch { /* fall through */ }
    }
    throw primaryErr;
  }
}

export async function issueRefresh(user, meta = {}) {
  const jti = crypto.randomUUID();
  const raw = crypto.randomBytes(48).toString('base64url');
  const token = `${jti}.${raw}`;
  await RefreshToken.create({
    _id: jti,
    userId: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    ip: (meta.ip || '').slice(0, 64),
    userAgent: (meta.userAgent || '').slice(0, 200),
  });
  return { token, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) };
}

export async function rotateRefresh(rawToken, meta = {}) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const dot = rawToken.indexOf('.');
  if (dot <= 0) return null;
  const jti = rawToken.slice(0, dot);
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: jti, tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now, revokeReason: 'rotated', rotatedIp: (meta.ip || '').slice(0, 64) } },
    { new: false },
  );
  if (claimed) return { ok: true, userId: claimed.userId, jti };

  const existing = await RefreshToken.findById(jti).lean();
  if (!existing) return null;
  if (existing.tokenHash !== tokenHash) return null;
  if (existing.expiresAt < now) return null;

  if (existing.revokedAt && existing.revokeReason === 'rotated') {
    const age = now.getTime() - new Date(existing.revokedAt).getTime();
    if (age < GRACE_WINDOW_MS) return { grace: true, userId: existing.userId, jti };
  }
  return { reuse: true, userId: existing.userId, jti };
}

export async function revokeRefresh(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return;
  const dot = rawToken.indexOf('.');
  if (dot <= 0) return;
  const jti = rawToken.slice(0, dot);
  await RefreshToken.updateOne(
    { _id: jti, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: 'logout' } },
  );
}

export async function revokeAllForUser(userId, reason = 'user_invalidated') {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason } },
  );
}

export async function revokeOne(jti, userId) {
  await RefreshToken.updateOne(
    { _id: jti, userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: 'user_revoked' } },
  );
}

export function newCsrfToken() {
  return crypto.randomBytes(24).toString('base64url');
}
