// middleware/rateLimit.js — Tiered limiters with optional Redis store.
// Set REDIS_URL to share state across multiple instances/workers. Otherwise
// memory store (default) — fine for a single process.
//
// Implementation note: the previous version wrapped each limiter in an
// async function that tried to swap .options.store after construction on
// the first request. express-rate-limit 7.x captures the store at
// construction time, so the swap was a no-op — AND the async wrapper
// interfered with the limiter's sync counting, so limits never fired
// (verified externally: 15 bad logins all 401, no 429). Now we build
// the Redis-backed store up front synchronously when REDIS_URL is set,
// fall back to memory store if anything fails.

import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { log } from '../utils/logger.js';

// Top-level await: set up the shared Redis client once, synchronously
// from the caller's POV. If REDIS_URL isn't set or the connection fails,
// every limiter transparently uses the in-process MemoryStore.
//
// Production hardening: if REDIS_URL is explicitly configured but we
// can't load/construct the Redis client, refuse to boot. Silently
// degrading to memory-store in prod means a multi-instance deploy
// quietly loses its shared rate-limit bucket — an attacker can then
// spread brute-force attempts across instances to bypass limits.
// Memory fallback is only acceptable in dev (NODE_ENV !== 'production').
let redisClient = null;
let RedisStoreCls = null;
if (env.REDIS_URL) {
  try {
    const { default: Redis } = await import('ioredis');
    redisClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    redisClient.on('error', (e) => log.warn({ err: e.message }, 'redis_error'));
    const mod = await import('rate-limit-redis');
    RedisStoreCls = mod.default || mod.RedisStore;
  } catch (e) {
    if (env.NODE_ENV === 'production') {
      log.fatal({ err: e.message }, 'redis_rate_limit_unavailable_refusing_to_boot');
      throw new Error('REDIS_URL set but Redis unavailable — refusing silent fallback in production');
    }
    log.warn({ err: e.message }, 'redis_rate_limit_unavailable_fallback_memory');
    redisClient = null;
    RedisStoreCls = null;
  }
}

function redisStoreFor(prefix) {
  if (!redisClient || !RedisStoreCls) return undefined;
  return new RedisStoreCls({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: `rl:${prefix}:`,
  });
}

function make(prefix, opts) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
    store: redisStoreFor(prefix),      // undefined → default MemoryStore
    ...opts,
  });
}

export const globalLimiter      = make('global',   { windowMs: 60_000,         max: 300, keyGenerator: r => r.ip });
export const loginLimiter       = make('login',    { windowMs: 15 * 60_000,    max: 5,   keyGenerator: r => r.ip, skipSuccessfulRequests: true });
export const loginBurstLimiter  = make('loginb',   { windowMs: 60 * 60_000,    max: 20,  keyGenerator: r => r.ip });
export const publicReadLimiter  = make('pubread',  { windowMs: 60_000,         max: 120, keyGenerator: r => r.ip });
export const trackLimiter       = make('track',    { windowMs: 60_000,         max: 60,  keyGenerator: r => r.ip });
export const adminWriteLimiter  = make('adminw',   { windowMs: 60_000,         max: 60,  keyGenerator: r => (r.user && r.user.id) || r.ip });
export const forgotLimiter      = make('forgot',   { windowMs: 60 * 60_000,    max: 5,   keyGenerator: r => r.ip });
export const uploadLimiter      = make('upload',   { windowMs: 60_000,         max: 10,  keyGenerator: r => (r.user && r.user.id) || r.ip });
