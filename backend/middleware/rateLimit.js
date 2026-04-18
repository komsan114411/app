// middleware/rateLimit.js — Tiered limiters with optional Redis store.
// Set REDIS_URL to share state across multiple instances/workers. Otherwise
// memory store (default) — fine for a single process.

import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { env } from '../config/env.js';
import { log } from '../utils/logger.js';

let redisClient = null;

async function getStore(prefix) {
  if (!env.REDIS_URL) return undefined;   // fall back to memory store
  if (!redisClient) {
    const { default: Redis } = await import('ioredis');
    redisClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    redisClient.on('error', (e) => log.warn({ err: e.message }, 'redis_error'));
  }
  return new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: `rl:${prefix}:`,
  });
}

function make(prefix, opts) {
  const limiter = rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
    ...opts,
  });
  // Lazily attach the store on first request so boot isn't blocked if Redis is slow.
  let init = false;
  return async (req, res, next) => {
    if (!init) {
      init = true;
      try {
        const store = await getStore(prefix);
        if (store) limiter.options.store = store;
      } catch (e) { log.warn({ err: e.message }, 'rl_store_fallback_memory'); }
    }
    return limiter(req, res, next);
  };
}

export const globalLimiter      = make('global',   { windowMs: 60_000,         max: 300, keyGenerator: r => r.ip });
export const loginLimiter       = make('login',    { windowMs: 15 * 60_000,    max: 5,   keyGenerator: r => r.ip, skipSuccessfulRequests: true });
export const loginBurstLimiter  = make('loginb',   { windowMs: 60 * 60_000,    max: 20,  keyGenerator: r => r.ip });
export const publicReadLimiter  = make('pubread',  { windowMs: 60_000,         max: 120, keyGenerator: r => r.ip });
export const trackLimiter       = make('track',    { windowMs: 60_000,         max: 60,  keyGenerator: r => r.ip });
export const adminWriteLimiter  = make('adminw',   { windowMs: 60_000,         max: 60,  keyGenerator: r => (r.user && r.user.id) || r.ip });
export const forgotLimiter      = make('forgot',   { windowMs: 60 * 60_000,    max: 5,   keyGenerator: r => r.ip });
export const uploadLimiter      = make('upload',   { windowMs: 60_000,         max: 10,  keyGenerator: r => (r.user && r.user.id) || r.ip });
