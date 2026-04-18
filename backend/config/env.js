// config/env.js — Boot-time env validation with zod.
// Fails fast at startup if anything is missing or malformed.

import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV:        z.enum(['development', 'production', 'test']).default('production'),
  PORT:            z.coerce.number().int().positive().default(4000),

  MONGO_URI:       z.string().min(10),

  JWT_SECRET:      z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_SECRET_PREV: z.string().min(32).optional(),   // rotation: accept old signatures during grace window
  REFRESH_SECRET:  z.string().min(32, 'REFRESH_SECRET must be at least 32 chars'),

  ARGON2_MEMORY:   z.coerce.number().int().min(19456).max(524288).default(65536),
  ARGON2_TIME:     z.coerce.number().int().min(2).max(10).default(3),
  ARGON2_PARALLEL: z.coerce.number().int().min(1).max(8).default(1),

  CORS_ORIGINS:    z.string().transform(v => v.split(',').map(s => s.trim()).filter(Boolean)),

  COOKIE_DOMAIN:   z.string().optional().default(''),
  COOKIE_SECURE:   z.string().default('true').transform(v => v !== 'false'),

  IP_SALT:         z.string().min(16, 'IP_SALT must be at least 16 chars'),
  TRUST_PROXY:     z.coerce.number().int().min(0).max(10).default(1),

  ADMIN_LOGIN_ID:  z.string().min(3).max(64).optional(),
  ADMIN_PASSWORD:  z.string().min(1).max(200).optional(),

  // ── Email (password reset) ─────────────────────────────
  SMTP_HOST:       z.string().optional(),
  SMTP_PORT:       z.coerce.number().int().optional(),
  SMTP_USER:       z.string().optional(),
  SMTP_PASSWORD:   z.string().optional(),
  SMTP_FROM:       z.string().optional(),
  APP_PUBLIC_URL:  z.string().optional(),   // base URL used in password-reset emails

  // ── Redis (optional — shared rate-limit store for multi-instance) ──
  REDIS_URL:       z.string().optional(),

  // ── Turnstile (Cloudflare) CAPTCHA ─────────────────────
  TURNSTILE_SECRET: z.string().optional(),

  // ── Web Push (VAPID) ───────────────────────────────────
  PUSH_VAPID_PUBLIC:  z.string().optional(),
  PUSH_VAPID_PRIVATE: z.string().optional(),
  PUSH_VAPID_SUBJECT: z.string().optional().default('mailto:admin@example.com'),

  // ── Uploads ────────────────────────────────────────────
  UPLOAD_DIR:      z.string().optional().default('uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024), // 2 MiB

  // ── Logging sink for production ────────────────────────
  LOG_TRANSPORT:   z.enum(['stdout', 'loki', 'file']).default('stdout'),
  LOKI_URL:        z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment:');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production') {
  const bad = ['CHANGE_ME', 'example_change_me', 'placeholder'];
  for (const key of ['JWT_SECRET', 'REFRESH_SECRET', 'IP_SALT']) {
    const v = parsed.data[key].toLowerCase();
    if (bad.some(b => v.includes(b.toLowerCase()))) {
      console.error(`❌ ${key} looks like a placeholder. Generate a real random secret.`);
      process.exit(1);
    }
  }
  if (parsed.data.JWT_SECRET === parsed.data.REFRESH_SECRET) {
    console.error('❌ JWT_SECRET and REFRESH_SECRET must be different.');
    process.exit(1);
  }
}

export const env = Object.freeze(parsed.data);
