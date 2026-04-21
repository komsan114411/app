// utils/vapid.js — Single source of truth for Web Push VAPID keys.
//
// Resolution order on every call:
//   1. env.PUSH_VAPID_PUBLIC + env.PUSH_VAPID_PRIVATE — operator-set.
//      Takes priority so self-hosters who rotate keys out-of-band aren't
//      silently overridden by the persisted pair.
//   2. AppConfig.vapidKeys.{publicKey,privateKey} — auto-generated pair
//      persisted in Mongo on first boot if env is unset.
//
// ensureVapid() is called from server.js:boot() once. It:
//   • checks env first, configures web-push, returns.
//   • else checks the config doc; if present, configures web-push.
//   • else generates a fresh pair via web-push.generateVAPIDKeys(),
//     stores it on the config doc, configures web-push.
//
// After ensureVapid() returns, web-push is wired with whichever pair
// actually exists. Callers that need to expose the public key to the
// browser (GET /api/push/vapid-key) use getPublicKey() rather than
// reading env directly.

import webPush from 'web-push';
import { env } from '../config/env.js';
import { getAppConfig } from '../models/AppConfig.js';
import { log } from './logger.js';

let _publicKey = '';
let _configured = false;

export async function ensureVapid() {
  if (_configured) return _publicKey;

  // 1. Operator-configured via env — honour it.
  if (env.PUSH_VAPID_PUBLIC && env.PUSH_VAPID_PRIVATE) {
    try {
      webPush.setVapidDetails(env.PUSH_VAPID_SUBJECT, env.PUSH_VAPID_PUBLIC, env.PUSH_VAPID_PRIVATE);
      _publicKey = env.PUSH_VAPID_PUBLIC;
      _configured = true;
      log.info('vapid_configured_from_env');
      return _publicKey;
    } catch (e) {
      log.warn({ err: e.message }, 'vapid_env_invalid');
      // fall through to persisted pair / generation
    }
  }

  // 2. Persisted pair in AppConfig — use it if present.
  try {
    const cfg = await getAppConfig();
    if (cfg.vapidKeys?.publicKey && cfg.vapidKeys?.privateKey) {
      webPush.setVapidDetails(env.PUSH_VAPID_SUBJECT, cfg.vapidKeys.publicKey, cfg.vapidKeys.privateKey);
      _publicKey = cfg.vapidKeys.publicKey;
      _configured = true;
      log.info({ createdAt: cfg.vapidKeys.createdAt }, 'vapid_configured_from_config');
      return _publicKey;
    }

    // 3. Generate, persist, configure.
    const pair = webPush.generateVAPIDKeys();
    cfg.vapidKeys = {
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      createdAt: new Date(),
    };
    await cfg.save();
    webPush.setVapidDetails(env.PUSH_VAPID_SUBJECT, pair.publicKey, pair.privateKey);
    _publicKey = pair.publicKey;
    _configured = true;
    log.warn('vapid_generated_and_persisted — set PUSH_VAPID_PUBLIC/PRIVATE envs to rotate');
    return _publicKey;
  } catch (e) {
    log.error({ err: e.message }, 'vapid_setup_failed');
    return '';
  }
}

export function getPublicKey() {
  return _publicKey;
}

export function isConfigured() {
  return !!_publicKey;
}

// For routes that want to know if push is usable without triggering
// the async ensure call. Call ensureVapid() once at boot and then this
// becomes a simple boolean.
export function vapidState() {
  return { configured: _configured, hasPublicKey: !!_publicKey };
}
