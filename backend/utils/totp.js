// utils/totp.js — thin wrapper around speakeasy for TOTP setup + verify.

import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import crypto from 'node:crypto';

export function generateSecret(loginId, issuer = 'Baansuan') {
  const secret = speakeasy.generateSecret({
    name: `${issuer}:${loginId}`,
    issuer,
    length: 20,
  });
  return {
    base32: secret.base32,
    otpauth_url: secret.otpauth_url,
  };
}

export async function qrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
}

// TOTP step size is the RFC-6238 default of 30 seconds. We expose the
// current-step helper so routes that care about replay protection can
// record which step was consumed and reject any code ≤ that step on
// the next attempt.
export const TOTP_STEP_SECONDS = 30;
export function currentTotpStep(now = Date.now()) {
  return Math.floor(now / (TOTP_STEP_SECONDS * 1000));
}

// verifyTokenDelta returns the step offset (-1, 0, or +1) if the code
// is valid for the current ±1-step window, otherwise null. The caller
// can then derive the absolute step that was consumed and persist it
// to block single-code replays within the same 60-second window.
//
// Old callers that just want a boolean should use verifyToken.
export function verifyTokenDelta(secret, token) {
  if (!secret || !token) return null;
  const result = speakeasy.totp.verifyDelta({
    secret,
    encoding: 'base32',
    token: String(token).trim(),
    window: 1,
  });
  if (!result || typeof result.delta !== 'number') return null;
  return result.delta;
}

export function verifyToken(secret, token) {
  return verifyTokenDelta(secret, token) !== null;
}

// Generate 10 single-use backup codes for account recovery.
// 64 bits of entropy each — a code acts as a full password replacement
// when TOTP is unavailable, so its strength must reflect that. Prior
// 40-bit codes were still rate-limit-bounded (5 logins / 15 min) but
// an attacker with long enough patience could measurably chip at the
// search space; 64 bits pushes the expected-case brute-force cost
// past any realistic horizon even without rate-limiting.
export function generateBackupCodes(n = 10) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(8).toString('hex');   // 16 hex chars = 64 bits
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`);
  }
  return codes;
}

// Format-agnostic: strips all dashes / whitespace before hashing so
// legacy 40-bit codes (xxxxx-xxxxx) from before the entropy bump
// still verify against their stored hash after this upgrade.
export function hashBackupCode(code) {
  return crypto.createHash('sha256').update(String(code).replace(/[-\s]/g, '').toLowerCase()).digest('hex');
}
