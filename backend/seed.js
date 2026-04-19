// seed.js — idempotent bootstrap. Creates first admin + forces password
// change + provisions an admin-access URL token if none exists.

import crypto from 'node:crypto';
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
    if (existing) u.tokenVersion = (u.tokenVersion || 0) + 1;
    await u.save();
    log.info({ loginId: u.loginId, created: !existing }, existing ? 'admin password reset' : 'first admin created');
    log.warn('⚠ Default password is in use. Admin must change on first login.');
  }

  // Provision admin-access token if missing. Printed prominently so the
  // operator reading Railway / Render logs after `npm run seed` can grab
  // the URL they need to reach the admin login form. After first login,
  // the admin can rotate this from the UI.
  if (!cfg.adminAccessToken?.current || process.argv.includes('--rotate-admin-token')) {
    const token = crypto.randomBytes(18).toString('base64url');
    cfg.adminAccessToken = {
      current: token,
      rotatedAt: new Date(),
      rotatedBy: null,
      rotationCount: (cfg.adminAccessToken?.rotationCount || 0) + 1,
    };
    await cfg.save();
    const line = '═'.repeat(60);
    console.log('\n' + line);
    console.log('  🔐 ADMIN ACCESS URL (save this — it\'s your only way in)');
    console.log('');
    console.log('     /admin/' + token);
    console.log('');
    console.log('  Full URL:  <your-deploy-domain>/admin/' + token);
    console.log('  Rotate anytime from admin → ความปลอดภัย');
    console.log(line + '\n');
    log.warn({ tokenPreview: token.slice(0, 4) + '***' }, '🔐 admin access URL provisioned — see stdout above');
  } else {
    log.info('admin access token already set — not overwriting (run with --rotate-admin-token to change)');
  }

  // Install-token is generated lazily by admin UI; not provisioned here.

  await disconnectDB();
  process.exit(0);
}

main().catch(err => { log.fatal({ err }, 'seed_failed'); process.exit(1); });
