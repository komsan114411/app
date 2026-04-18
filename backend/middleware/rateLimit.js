// middleware/rateLimit.js — Tiered limiters.
// NOTE: in multi-instance deployments, swap MemoryStore for RedisStore.

import rateLimit from 'express-rate-limit';

// Global safety net — blocks runaway bots before they hit route logic.
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,   // TRUST_PROXY already set on app
  handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
});

// Login: per-IP 5/15min + burst 20/hour
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
});

export const loginBurstLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
});

// Public config — cacheable, high volume.
export const publicReadLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
});

// Track events — anti-spam, 1/sec per IP average.
export const trackLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
});

// Admin write — per-user limit (once auth middleware populated req.user).
export const adminWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => (req.user && req.user.id) || req.ip,
  handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
});
