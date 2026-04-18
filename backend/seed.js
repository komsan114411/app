// seed.js — idempotent bootstrap. Creates first admin with default login
// and forces password change on first login.
//
// Default credentials (FIRST DEPLOY ONLY):
//   loginId:  admin123
//   password: admin123
// These bypass the password policy intentionally. The admin MUST change
// the password on first login; the system enforces this via the
// mustChangePassword flag and will not let any other action happen first.

import { env } from './config/env.js';
import { connectDB, disconnectDB } from './db.js';
import { User } from './models/User.js';
import { getAppConfig } from './models/AppConfig.js';
import { log } from './utils/logger.js';

const DEFAULT_LOGIN_ID = (env.ADMIN_LOGIN_ID || 'admin123').toLowerCase();
const DEFAULT_PASSWORD = env.ADMIN_PASSWORD || 'admin123';

async function main() {
  await connectDB();

  const cfg = await getAppConfig();
  log.info({ id: cfg._id }, 'AppConfig present');

  const force = process.argv.includes('--force-password');
  const existing = await User.findOne({ loginId: DEFAULT_LOGIN_ID });

  if (existing && !force) {
    log.info({ loginId: existing.loginId }, 'admin user exists — skipping (use --force-password to reset)');
  } else {
    const u = existing || new User({ loginId: DEFAULT_LOGIN_ID, role: 'admin' });
    await u.setPasswordUnsafe(DEFAULT_PASSWORD);
    u.mustChangePassword = true;
    u.failedLoginCount = 0;
    u.lockUntil = null;
    if (existing) u.tokenVersion = (u.tokenVersion || 0) + 1;   // log out old sessions
    await u.save();
    log.info({
      loginId: u.loginId,
      created: !existing,
      defaultPassword: DEFAULT_PASSWORD === 'admin123',
    }, existing ? 'admin password reset' : 'first admin created');
    log.warn('⚠ Default password is in use. Admin must change on first login.');
  }

  await disconnectDB();
  process.exit(0);
}

main().catch(err => { log.fatal({ err }, 'seed_failed'); process.exit(1); });
