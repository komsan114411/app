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
import zlib from 'node:zlib';
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

// Minimal ZIP reader — finds a single file by exact name, returns its
// content as a Buffer (DEFLATE-decompressed or raw STORE). Returns null
// if the archive is malformed, the file isn't present, or the compression
// method isn't supported (STORE=0, DEFLATE=8 cover 99% of APKs). Uses only
// built-in Node modules — no unzipper/adm-zip dependency for a check we
// run a few times per day.
export function extractFromZip(buf, filename) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
  const EOCD_SIG = 0x06054b50;
  const CD_SIG   = 0x02014b50;
  const LFH_SIG  = 0x04034b50;

  // 1. Scan backward for End-of-Central-Directory record. Max 65535 bytes
  //    of trailing comment per spec, so this is a bounded search.
  let eocd = -1;
  const searchFrom = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= searchFrom; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const numEntries = buf.readUInt16LE(eocd + 10);
  const cdSize     = buf.readUInt32LE(eocd + 12);
  const cdOffset   = buf.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > buf.length) return null;

  // 2. Walk central directory looking for `filename`.
  const target = Buffer.from(filename, 'utf8');
  let pos = cdOffset;
  const end = cdOffset + cdSize;
  for (let i = 0; i < numEntries && pos + 46 <= end; i++) {
    if (buf.readUInt32LE(pos) !== CD_SIG) return null;
    const compMethod   = buf.readUInt16LE(pos + 10);
    const compSize     = buf.readUInt32LE(pos + 20);
    const nameLen      = buf.readUInt16LE(pos + 28);
    const extraLen     = buf.readUInt16LE(pos + 30);
    const commentLen   = buf.readUInt16LE(pos + 32);
    const lfhOffset    = buf.readUInt32LE(pos + 42);
    const nameStart    = pos + 46;
    if (nameLen === target.length && buf.compare(target, 0, target.length, nameStart, nameStart + nameLen) === 0) {
      // 3. Jump to the local file header — extra field lengths here may
      //    differ from the central directory, so re-read.
      if (lfhOffset + 30 > buf.length) return null;
      if (buf.readUInt32LE(lfhOffset) !== LFH_SIG) return null;
      const lfhNameLen  = buf.readUInt16LE(lfhOffset + 26);
      const lfhExtraLen = buf.readUInt16LE(lfhOffset + 28);
      const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
      if (dataStart + compSize > buf.length) return null;
      const slice = buf.subarray(dataStart, dataStart + compSize);
      if (compMethod === 0) return slice;
      if (compMethod === 8) {
        try { return zlib.inflateRawSync(slice); }
        catch { return null; }
      }
      return null;  // unsupported compression (BZIP2, LZMA…)
    }
    pos = nameStart + nameLen + extraLen + commentLen;
  }
  return null;
}

// Verify that the uploaded APK bundles `window.API_BASE=<expectedOrigin>`
// in its index.html. Without this, the Capacitor WebView boots with
// API_BASE='' and fetches /api/config against its own origin
// (https://localhost) which doesn't exist — user sees DEFAULT_STATE
// demo content ("ตัวอย่างแอป", "ปุ่มที่ 1-6") instead of the real admin
// config. Rejecting at upload time prevents the admin from shipping an
// APK that is silently broken on every installed device.
//
// Returns { ok: true } or { ok: false, code: string, detail: string }.
// `expectedOrigin` should be the same string the admin's browser sees
// when reaching this backend.
export function verifyApkApiBase(buf, expectedOrigin) {
  if (!expectedOrigin) return { ok: true };   // caller couldn't resolve — skip
  const html = extractFromZip(buf, 'assets/public/index.html');
  if (!html) {
    return {
      ok: false,
      code: 'apk_invalid_structure',
      detail: 'APK does not contain assets/public/index.html — not a Capacitor build of this app.',
    };
  }
  const text = html.toString('utf8');
  if (!/window\s*\.\s*API_BASE\s*=/.test(text)) {
    return {
      ok: false,
      code: 'apk_missing_api_base',
      detail: 'APK has no window.API_BASE — it will show DEFAULT_STATE demo on every device. Rebuild with API_BASE="' + expectedOrigin + '" (use the "Build APK" button in this admin console, or set API_BASE_URL in the GitHub Actions workflow).',
    };
  }
  if (!text.includes(expectedOrigin)) {
    return {
      ok: false,
      code: 'apk_wrong_api_base',
      detail: 'APK has window.API_BASE pointing to a different backend than this one. Expected to find "' + expectedOrigin + '" in the bundled index.html.',
    };
  }
  return { ok: true };
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
