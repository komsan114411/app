// middleware/upload.js — multer configured for in-memory buffering.
//
// Files are NOT written to disk here — the route handler persists the
// buffer to MongoDB (MediaAsset collection) so the upload survives
// container redeploys on platforms without a persistent volume (Railway,
// Render, Fly free tier).
//
// Defences:
//   • MIME whitelist at upload time (rejects SVG, HTML, scripts).
//   • Per-request rate-limited by uploadLimiter at the route level.
//   • multer `fields: 0, parts: 2` kills attempted smuggled form fields.
//   • Size capped by UPLOAD_MAX_BYTES (default 2 MiB).

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

function fileFilter(req, file, cb) {
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
  fileFilter,
}).single('file');
