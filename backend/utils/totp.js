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

export function verifyToken(secret, token) {
  if (!secret || !token) return false;
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(token).trim(),
    window: 1,
  });
}

// Generate 10 single-use backup codes for account recovery.
export function generateBackupCodes(n = 10) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(5).toString('hex');   // 10-char
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export function hashBackupCode(code) {
  return crypto.createHash('sha256').update(code.replace(/[-\s]/g, '').toLowerCase()).digest('hex');
}
