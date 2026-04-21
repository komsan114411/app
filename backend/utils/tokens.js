// utils/tokens.js — access JWT + refresh token with ATOMIC rotation.
// Supports secret rotation: verify with JWT_SECRET OR JWT_SECRET_PREV during
// a grace window (sign always with current JWT_SECRET).

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';

const ACCESS_TTL  = '15m';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Short grace window — enough to absorb a legit in-flight retry after a
// network blip, not enough to let a stolen refresh token ride in parallel
// with the legit session for many seconds. Previously 10s — a stolen cookie
// could issue a fresh access token without ever tripping reuse detection.
const GRACE_WINDOW_MS = 2 * 1000;
// Issuer/audience pinning: even if JWT_SECRET is ever reused across
// services (staging ↔ prod, secondary microservices, etc.), tokens will
// not cross-validate because the aud/iss mismatch rejects the signature.
const JWT_ISSUER = env.APP_PUBLIC_URL || 'admin-api';
const JWT_AUDIENCE = 'admin-api';

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function signAccess(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, v: user.tokenVersion || 0 },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: ACCESS_TTL,
      jwtid: crypto.randomUUID(),
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );
}

// PREV is only consulted during the explicit rotation grace window.
// Without a TTL, a forgotten PREV env var leaves the prior secret
// valid forever — which is worse than simply never rotating, because
// two live secrets double the blast radius of any leak. Operators set
// JWT_SECRET_PREV_UNTIL to an ISO-8601 timestamp; after that instant
// PREV is ignored even if still configured.
function prevSecretIsLive() {
  if (!env.JWT_SECRET_PREV) return false;
  if (!env.JWT_SECRET_PREV_UNTIL) return true;   // no TTL set → still live (legacy behaviour)
  return Date.now() < Date.parse(env.JWT_SECRET_PREV_UNTIL);
}

export function verifyAccess(token) {
  const opts = {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  };
  try {
    return jwt.verify(token, env.JWT_SECRET, opts);
  } catch (primaryErr) {
    if (prevSecretIsLive()) {
      try {
        return jwt.verify(token, env.JWT_SECRET_PREV, opts);
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
    if (age < GRACE_WINDOW_MS) {
      // Still within the legit-retry window — permit, but bind to the
      // original rotator's IP. If the grace hit comes from a different
      // network address it's almost certainly a stolen cookie racing the
      // real client, so treat it as reuse.
      const graceIp = (meta.ip || '').slice(0, 64);
      // Strict comparison: if either side is missing an IP OR they
      // don't match, treat as reuse. The previous check
      // `existing.rotatedIp && graceIp && existing.rotatedIp !== graceIp`
      // allowed the empty-IP case (both '') to pass — a request from
      // an attacker proxy that stripped X-Forwarded-For would match
      // the original rotation that also had no IP.
      if (!existing.rotatedIp || !graceIp || existing.rotatedIp !== graceIp) {
        return { reuse: true, userId: existing.userId, jti };
      }
      return { grace: true, userId: existing.userId, jti };
    }
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
