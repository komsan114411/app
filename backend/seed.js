// seed.js — idempotent bootstrap. Creates first admin + empty AppConfig.
// Runs once: `npm run seed`.

import { env } from './config/env.js';
import { connectDB, disconnectDB } from './db.js';
import { User } from './models/User.js';
import { getAppConfig } from './models/AppConfig.js';
import { log } from './utils/logger.js';

async function main() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first');
    process.exit(1);
  }

  await connectDB();

  // AppConfig
  const cfg = await getAppConfig();
  log.info({ id: cfg._id }, 'AppConfig present');

  // First admin. Pass --force-password to update existing admin's password.
  const force = process.argv.includes('--force-password');
  const existing = await User.findOne({ email: env.ADMIN_EMAIL.toLowerCase() });
  if (existing && !force) {
    log.info({ email: existing.email }, 'admin user exists — skipping (use --force-password to update)');
  } else {
    const u = existing || new User({ email: env.ADMIN_EMAIL.toLowerCase(), role: 'admin' });
    try { await u.setPassword(env.ADMIN_PASSWORD); }
    catch (e) {
      log.fatal({ reason: e.reason, suggestions: e.details?.suggestions }, 'admin password rejected by policy');
      process.exit(1);
    }
    // Bumping tokenVersion forces logout of any stale sessions (prod rotation)
    if (existing) u.tokenVersion = (u.tokenVersion || 0) + 1;
    await u.save();
    log.info({ email: u.email, created: !existing }, 'admin user saved');
  }

  await disconnectDB();
  process.exit(0);
}

main().catch(err => { log.fatal({ err }, 'seed_failed'); process.exit(1); });
