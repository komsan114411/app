// middleware/captcha.js — verify Cloudflare Turnstile token.
// If TURNSTILE_SECRET is not set, this middleware no-ops (dev friendly).

import { env } from '../config/env.js';
import { log } from '../utils/logger.js';

const ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyCaptcha(req, res, next) {
  if (!env.TURNSTILE_SECRET) return next();   // opt-in: skip when unconfigured
  const token = req.body?.captchaToken || req.get('x-captcha-token') || '';
  if (!token) return res.status(400).json({ error: 'captcha_required' });

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: String(token).slice(0, 2048),
        remoteip: req.ip || '',
      }).toString(),
    });
    const data = await resp.json();
    if (!data.success) {
      log.warn({ codes: data['error-codes'] }, 'captcha_failed');
      return res.status(400).json({ error: 'captcha_invalid' });
    }
    next();
  } catch (err) {
    log.warn({ err: err.message }, 'captcha_error');
    return res.status(502).json({ error: 'captcha_upstream' });
  }
}
