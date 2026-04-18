// middleware/upload.js — multer-based image upload to disk.
// Files are written to env.UPLOAD_DIR (default ./uploads, created if missing).

import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const uploadDir = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXT  = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safe = ALLOWED_EXT.has(ext) ? ext : '.img';
    const name = crypto.randomBytes(12).toString('hex') + safe;
    cb(null, name);
  },
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('unsupported_media_type'));
  }
  cb(null, true);
}

export const uploadSingle = multer({
  storage,
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 },
  fileFilter,
}).single('file');

export { uploadDir };
