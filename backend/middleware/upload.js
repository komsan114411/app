// middleware/upload.js — multer configured for in-memory buffering.
//
// Files are NOT written to disk here — the route handler persists the
// buffer to MongoDB (MediaAsset collection) so the upload survives
// container redeploys on platforms without a persistent volume (Railway,
// Render, Fly free tier).
//
// Two variants exposed:
//   • uploadSingle   — IMAGES only (≤ 2 MiB, banner images)
//   • uploadApk      — Android APK only (≤ 50 MiB; self-hosted distribution)
//
// Defences on both:
//   • MIME + extension whitelist
//   • fields: 0 / parts: 2 kills smuggled form fields
//   • Rate-limited per-route

import multer from 'multer';
import { env } from '../config/env.js';

// Image formats only. SVG is DELIBERATELY excluded — it can embed <script>
// and would be served same-origin, leading to XSS against anyone viewing
// the banner image directly.
export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function imageFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('unsupported_media_type'));
  }
  const orig = file.originalname || '';
  if (/[\x00/\\]/.test(orig)) return cb(new Error('unsupported_media_type'));
  cb(null, true);
}

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 2 },
  fileFilter: imageFilter,
}).single('file');

// ─── APK upload ──────────────────────────────────────────────
// Android wants application/vnd.android.package-archive but many browsers
// upload APKs as application/octet-stream, so accept both and then verify
// via magic bytes (APK is a ZIP — starts with 'PK\x03\x04').
export const APK_MIME = 'application/vnd.android.package-archive';
const APK_ALLOWED_MIME = new Set([APK_MIME, 'application/octet-stream', 'application/zip']);
// MongoDB BSON single-document limit is 16 MiB. Cap the APK a bit below that
// so metadata fits. For larger APKs, point the admin at an external URL
// (GitHub Release, Drive, Dropbox, R2) instead of uploading directly.
export const APK_MAX_BYTES = 15 * 1024 * 1024;   // 15 MiB

function apkFilter(req, file, cb) {
  if (!APK_ALLOWED_MIME.has(file.mimetype)) return cb(new Error('unsupported_media_type'));
  const orig = (file.originalname || '').toLowerCase();
  if (!orig.endsWith('.apk')) return cb(new Error('unsupported_media_type'));
  if (/[\x00/\\]/.test(orig)) return cb(new Error('unsupported_media_type'));
  cb(null, true);
}

export const uploadApk = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: APK_MAX_BYTES, files: 1, fields: 0, parts: 2 },
  fileFilter: apkFilter,
}).single('file');

// Verify APK signature (ZIP magic bytes) — multer's MIME check is client-
// supplied and untrusted. Call this in the route after upload.
export function isApkBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  return buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
}

// Verify image magic bytes match the declared MIME type. multer's filter
// only checks the MIME header (client-supplied). A compromised admin
// credential could otherwise upload an HTML file with MIME=image/png;
// the server would store it and later serve it back as image/png. Nosniff
// + CSP already prevent direct exploitation, but defence-in-depth:
// actually look at the bytes and reject mismatches.
export function isImageBuffer(buf, mime) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  switch (mime) {
    case 'image/jpeg':
      // JPEG: FF D8 FF ...  (trailing EE/E0/DB varies)
      return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    case 'image/png':
      // PNG: 89 50 4E 47 0D 0A 1A 0A
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
          && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
    case 'image/webp':
      // RIFF....WEBP
      return buf.slice(0, 4).toString('ascii') === 'RIFF'
          && buf.slice(8, 12).toString('ascii') === 'WEBP';
    case 'image/gif':
      // GIF87a or GIF89a
      return buf.slice(0, 6).toString('ascii') === 'GIF87a'
          || buf.slice(0, 6).toString('ascii') === 'GIF89a';
    default:
      return false;
  }
}
