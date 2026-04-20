// middleware/csrf.js — Double-submit cookie CSRF protection.
// Cookie uses __Secure- prefix: browser only accepts with Secure flag over HTTPS.
// Client reads cookie value, echoes in X-CSRF-Token header on mutations.

import crypto from 'node:crypto';
import { newCsrfToken } from '../utils/tokens.js';
import { env } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_COOKIE = env.COOKIE_SECURE ? '__Secure-XSRF-TOKEN' : 'XSRF-TOKEN';

const cookieOpts = () => ({
  httpOnly: false,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/',
  domain: env.COOKIE_DOMAIN || undefined,
  maxAge: 2 * 60 * 60 * 1000,
});

const clearCookieOpts = () => ({
  path: '/',
  domain: env.COOKIE_DOMAIN || undefined,
});

export function ensureCsrfCookie(req, res, next) {
  const existing = req.cookies && req.cookies[CSRF_COOKIE];
  if (!existing) res.cookie(CSRF_COOKIE, newCsrfToken(), cookieOpts());
  next();
}

export function rotateCsrfCookie(res) {
  res.cookie(CSRF_COOKIE, newCsrfToken(), cookieOpts());
}

export function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE, clearCookieOpts());
}

export function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie = req.cookies && req.cookies[CSRF_COOKIE];
  const header = req.get('X-CSRF-Token');
  if (!cookie || !header) return res.status(403).json({ error: 'csrf_missing' });
  if (typeof cookie !== 'string' || typeof header !== 'string') return res.status(403).json({ error: 'csrf_mismatch' });
  // Pad both buffers to the same length before comparing so a length
  // difference cannot be detected via wall-clock timing (early-exit on
  // length mismatch was a minor timing oracle). timingSafeEqual requires
  // equal-length inputs; extra bytes are zeroed and thus always differ
  // when the strings are not the same length, which is the correct outcome.
  const maxLen = Math.max(cookie.length, header.length);
  const cookieBuf = Buffer.alloc(maxLen);
  const headerBuf = Buffer.alloc(maxLen);
  Buffer.from(cookie).copy(cookieBuf);
  Buffer.from(header).copy(headerBuf);
  if (!crypto.timingSafeEqual(cookieBuf, headerBuf)) return res.status(403).json({ error: 'csrf_mismatch' });
  // Rotate the CSRF cookie on every verified mutation. A token leaked via
  // browser history / dev-tools / a malicious extension stops being
  // reusable once the legitimate user performs ANY admin action.
  // `res.cookie()` just queues the Set-Cookie header, so this fires
  // before headers are actually sent regardless of how the handler ends.
  rotateCsrfCookie(res);
  next();
}
