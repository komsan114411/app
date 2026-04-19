// utils/passwordPolicy.js — server-side password strength + breach check.

import crypto from 'node:crypto';
import zxcvbn from 'zxcvbn';
import { env } from '../config/env.js';
import { log } from './logger.js';

const MIN_LENGTH = 12;   // stricter than schema (10) for new passwords
const MAX_LENGTH = 200;
const MIN_ZXCVBN_SCORE = 3;   // 0-4 scale — 3 = "Very unguessable"

// k-Anonymity check against Have I Been Pwned.
// We send only first 5 SHA1 chars; response lists hash SUFFIX:count lines.
// No password or full hash ever leaves the server.
async function hibpCount(password) {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },    // defense against response-size fingerprinting
      signal: ctrl.signal,
    });
    if (!res.ok) return -1;                   // network failure → skip (fail-open for UX)
    const text = await res.text();
    for (const line of text.split('\n')) {
      const [suf, count] = line.trim().split(':');
      if (suf === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    return -1;
  } finally { clearTimeout(timer); }
}

// userInputs: array of strings (email, name) we treat as "dictionary" words
export async function validatePasswordStrength(password, userInputs = []) {
  if (typeof password !== 'string') return { ok: false, reason: 'invalid' };
  if (password.length < MIN_LENGTH) return { ok: false, reason: 'too_short' };
  if (password.length > MAX_LENGTH) return { ok: false, reason: 'too_long' };
  if (/[\x00-\x08\x0E-\x1F\x7F]/.test(password)) return { ok: false, reason: 'bad_chars' };

  const strength = zxcvbn(password, userInputs);
  if (strength.score < MIN_ZXCVBN_SCORE) {
    return {
      ok: false,
      reason: 'weak',
      suggestions: (strength.feedback?.suggestions || []).slice(0, 3),
    };
  }

  const leaked = await hibpCount(password);
  if (leaked > 0) return { ok: false, reason: 'breached', leaked };
  // Fail-closed in production: if HIBP was unreachable (-1) we cannot confirm
  // the password is not in a known breach dump. Rejecting is safer than
  // silently accepting a potentially compromised password. Dev/test still
  // allow through to keep local iteration friction-free.
  if (leaked === -1 && env.NODE_ENV === 'production') {
    log.warn('HIBP check unavailable — rejecting password set in production');
    return { ok: false, reason: 'hibp_unavailable' };
  }

  return { ok: true };
}
