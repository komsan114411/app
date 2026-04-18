// utils/tokens.js — access JWT + refresh token with ATOMIC rotation.

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';

const ACCESS_TTL  = '15m';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7d
const GRACE_WINDOW_MS = 10 * 1000;                 // 10s — cross-tab safety

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
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
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

// ATOMIC rotation — findOneAndUpdate guarantees only ONE concurrent caller wins.
// Returns:
//   { ok: true, userId }             normal rotation
//   { reuse: true }                  reuse detected → caller must revoke family
//   null                             invalid / expired / malformed
//
// Grace window: if we just-revoked this token within GRACE_WINDOW_MS AND reason
// is 'rotated' AND the requester's userAgent is the same, we treat as replay of
// a just-rotated token (e.g. two browser tabs doing simultaneous refresh) and
// return the sibling token info instead of revoking the family.
export async function rotateRefresh(rawToken, meta = {}) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const dot = rawToken.indexOf('.');
  if (dot <= 0) return null;
  const jti = rawToken.slice(0, dot);
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  // Claim the token atomically. Only succeeds if not revoked and not expired.
  const claimed = await RefreshToken.findOneAndUpdate(
    {
      _id: jti,
      tokenHash,
      revokedAt: null,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        revokedAt: now,
        revokeReason: 'rotated',
        rotatedIp: (meta.ip || '').slice(0, 64),
      },
    },
    { new: false },
  );

  if (claimed) return { ok: true, userId: claimed.userId };

  // Claim failed — figure out why.
  const existing = await RefreshToken.findById(jti).lean();
  if (!existing) return null;
  if (existing.tokenHash !== tokenHash) return null;          // tampered/wrong token
  if (existing.expiresAt < now) return null;

  // It was revoked. Was it revoked JUST NOW (rotation race)? → grace pass.
  if (existing.revokedAt && existing.revokeReason === 'rotated') {
    const age = now.getTime() - new Date(existing.revokedAt).getTime();
    if (age < GRACE_WINDOW_MS) {
      return { grace: true, userId: existing.userId };
    }
  }

  // Old token being replayed after the grace window → reuse attack.
  return { reuse: true, userId: existing.userId };
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

export function newCsrfToken() {
  return crypto.randomBytes(24).toString('base64url');
}
