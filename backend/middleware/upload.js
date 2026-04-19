// middleware/upload.js — multer-based image upload to disk.
// Files are written to env.UPLOAD_DIR (default ./uploads, created if missing).
//
// Defences:
//   • MIME whitelist at upload time (rejects SVG, HTML, scripts).
//   • Extension whitelist on filename — path traversal segments dropped.
//   • Filename is random hex + mapped extension; original name is never
//     written to disk (prevents unicode / control-char tricks).
//   • Per-request rate-limited by uploadLimiter at the route level.

import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const uploadDir = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

// Image formats only. SVG is DELIBERATELY excluded — it can embed <script>
// and would be served same-origin, leading to XSS against anyone viewing
// the banner image directly.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXT  = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // Prefer MIME-derived extension so a `.png` file uploaded as image/gif
    // lands as `.gif` — the served Content-Type should match the bytes.
    const rawExt = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const mimeExt = MIME_TO_EXT[file.mimetype];
    const ext = mimeExt || (ALLOWED_EXT.has(rawExt) ? rawExt : '.img');
    const name = crypto.randomBytes(12).toString('hex') + ext;
    cb(null, name);
  },
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('unsupported_media_type'));
  }
  // Reject filenames with path separators or NUL bytes (multer normally
  // strips them, but be defensive).
  const orig = file.originalname || '';
  if (/[\x00/\\]/.test(orig)) return cb(new Error('unsupported_media_type'));
  cb(null, true);
}

export const uploadSingle = multer({
  storage,
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 2 },
  fileFilter,
}).single('file');

export { uploadDir };
