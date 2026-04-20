// middleware/ipGuard.js — DB-backed IP brute-force protection.
//
// Complements express-rate-limit's MemoryStore (which is per-instance
// and unreliable across Railway replicas). This uses MongoDB as the
// source of truth so every instance sees the same counter.
//
// Usage:
//   import { enforceIpGuard, recordIpFailure } from '../middleware/ipGuard.js';
//   authRouter.post('/login', enforceIpGuard, ...handler that calls recordIpFailure on bad creds);
//
// Guard runs BEFORE the handler and short-circuits with 429 if the IP
// is currently blocked. The handler calls recordIpFailure() when a
// failed-auth outcome is reached; this increments the counter and
// optionally sets blockedUntil.
//
// Thresholds are intentionally strict: after 20 failures within a
// 60-minute window an IP is frozen for 1 hour. A real user mis-typing
// their password 20× is unlikely; an attacker is common.

import { IpBlock } from '../models/IpBlock.js';
import { hashIp } from '../utils/sanitize.js';
import { log } from '../utils/logger.js';

const THRESHOLD = 20;
const WINDOW_MS = 60 * 60 * 1000;      // 60 min rolling window
const BLOCK_MS  = 60 * 60 * 1000;      // 60 min block when tripped

export async function enforceIpGuard(req, res, next) {
  const id = hashIp(req.ip);
  if (!id) return next();
  try {
    const doc = await IpBlock.findById(id).lean();
    if (doc && doc.blockedUntil && doc.blockedUntil > new Date()) {
      const remaining = Math.ceil((doc.blockedUntil.getTime() - Date.now()) / 1000);
      res.set('Retry-After', String(remaining));
      log.warn({ ipHash: id, remaining, reason: doc.reason }, 'ip_block_active');
      return res.status(429).json({ error: 'ip_locked', retryAfter: remaining });
    }
  } catch (e) {
    // DB unavailable — fail open so the limiter doesn't become a DoS vector.
    log.warn({ err: e?.message }, 'ip_guard_read_failed');
  }
  next();
}

export async function recordIpFailure(req, reason = 'auth_fail') {
  const id = hashIp(req.ip);
  if (!id) return;
  const now = new Date();
  try {
    // Atomic update: reset the counter if the previous failure was
    // more than WINDOW_MS ago (new window), otherwise increment and
    // flip to blocked once we cross the threshold.
    await IpBlock.findOneAndUpdate(
      { _id: id },
      [{
        $set: {
          failures: {
            $cond: [
              { $or: [
                { $eq: ['$failures', null] },
                { $lt: [{ $ifNull: ['$lastFailAt', new Date(0)] }, new Date(now.getTime() - WINDOW_MS)] },
              ] },
              1,
              { $add: [{ $ifNull: ['$failures', 0] }, 1] },
            ],
          },
          firstFailAt: {
            $cond: [
              { $or: [
                { $eq: ['$failures', null] },
                { $lt: [{ $ifNull: ['$lastFailAt', new Date(0)] }, new Date(now.getTime() - WINDOW_MS)] },
              ] },
              now,
              { $ifNull: ['$firstFailAt', now] },
            ],
          },
          lastFailAt: now,
          reason: String(reason || 'auth_fail').slice(0, 32),
          blockedUntil: {
            $cond: [
              { $gte: [{ $add: [{ $ifNull: ['$failures', 0] }, 1] }, THRESHOLD] },
              new Date(now.getTime() + BLOCK_MS),
              '$blockedUntil',
            ],
          },
        },
      }],
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (e) {
    // Best-effort — don't surface DB problems to the caller.
    log.warn({ err: e?.message }, 'ip_guard_record_failed');
  }
}

// Called on successful auth so a legit user unlocks their IP quickly.
export async function clearIpFailures(req) {
  const id = hashIp(req.ip);
  if (!id) return;
  try {
    await IpBlock.updateOne(
      { _id: id },
      { $set: { failures: 0, firstFailAt: null, blockedUntil: null } },
    );
  } catch {}
}
