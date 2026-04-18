// middleware/csrf.js — Double-submit cookie CSRF protection.
// Cookie uses __Secure- prefix: browser only accepts with Secure flag over HTTPS.
// Client reads cookie value, echoes in X-CSRF-Token header on mutations.

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

export function ensureCsrfCookie(req, res, next) {
  const existing = req.cookies && req.cookies[CSRF_COOKIE];
  if (!existing) res.cookie(CSRF_COOKIE, newCsrfToken(), cookieOpts());
  next();
}

export function rotateCsrfCookie(res) {
  res.cookie(CSRF_COOKIE, newCsrfToken(), cookieOpts());
}

export function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie = req.cookies && req.cookies[CSRF_COOKIE];
  const header = req.get('X-CSRF-Token');
  if (!cookie || !header) return res.status(403).json({ error: 'csrf_missing' });
  if (typeof cookie !== 'string' || typeof header !== 'string') return res.status(403).json({ error: 'csrf_mismatch' });
  if (cookie.length !== header.length) return res.status(403).json({ error: 'csrf_mismatch' });
  let diff = 0;
  for (let i = 0; i < cookie.length; i++) diff |= cookie.charCodeAt(i) ^ header.charCodeAt(i);
  if (diff !== 0) return res.status(403).json({ error: 'csrf_mismatch' });
  next();
}
