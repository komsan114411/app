// config/env.js — Boot-time env validation with zod.
// Fails fast at startup if anything is missing or malformed.

import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV:        z.enum(['development', 'production', 'test']).default('production'),
  PORT:            z.coerce.number().int().positive().default(4000),

  MONGO_URI:       z.string().min(10),

  JWT_SECRET:      z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  REFRESH_SECRET:  z.string().min(32, 'REFRESH_SECRET must be at least 32 chars'),

  // argon2id params (OWASP 2024 minimum: m=19MiB t=2 p=1; we go higher)
  ARGON2_MEMORY:   z.coerce.number().int().min(19456).max(524288).default(65536),  // KiB (64 MiB)
  ARGON2_TIME:     z.coerce.number().int().min(2).max(10).default(3),
  ARGON2_PARALLEL: z.coerce.number().int().min(1).max(8).default(1),

  CORS_ORIGINS:    z.string().transform(v => v.split(',').map(s => s.trim()).filter(Boolean)),

  COOKIE_DOMAIN:   z.string().optional().default(''),
  COOKIE_SECURE:   z.string().default('true').transform(v => v !== 'false'),

  IP_SALT:         z.string().min(16, 'IP_SALT must be at least 16 chars'),
  TRUST_PROXY:     z.coerce.number().int().min(0).max(10).default(1),

  ADMIN_EMAIL:     z.string().email().optional(),
  ADMIN_PASSWORD:  z.string().min(10).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment:');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

// Extra safety: reject default/demo secrets in production
if (parsed.data.NODE_ENV === 'production') {
  const bad = ['CHANGE_ME', 'example', 'secret', 'password'];
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
