// routes/public.js — Unauthenticated endpoints.

import { Router } from 'express';
import { getAppConfig, publishedButtons } from '../models/AppConfig.js';
import { ClickEvent } from '../models/ClickEvent.js';
import { PushSubscription } from '../models/PushSubscription.js';
import { publicReadLimiter, trackLimiter } from '../middleware/rateLimit.js';
import { validate, trackBody } from '../middleware/validate.js';
import { hashIp, safeText } from '../utils/sanitize.js';
import { env } from '../config/env.js';

export const publicRouter = Router();

let cache = { at: 0, payload: null, version: 0 };
publicRouter.get('/config', publicReadLimiter, async (req, res) => {
  const now = Date.now();
  if (cache.payload && now - cache.at < 3_000) {
    res.set('Cache-Control', 'public, max-age=3, stale-while-revalidate=10');
    res.set('X-Config-Version', String(cache.version));
    return res.json(cache.payload);
  }
  const cfg = await getAppConfig();
  const payload = {
    appName: cfg.appName,
    tagline: cfg.tagline,
    theme: cfg.theme,
    language: cfg.language || 'th',
    darkMode: cfg.darkMode || 'auto',
    banners: cfg.banners,
    buttons: publishedButtons(cfg.buttons),   // filter by publishAt / unpublishAt
    contact: cfg.contact,
    featureFlags: cfg.featureFlags || {},
    downloadLinks: cfg.downloadLinks || {},
    capabilities: {
      emailReset: !!env.SMTP_HOST,
      pushNotifications: !!(env.PUSH_VAPID_PUBLIC && env.PUSH_VAPID_PRIVATE),
      captcha: !!env.TURNSTILE_SECRET,
    },
    updatedAt: cfg.updatedAt,
  };
  cache = { at: now, payload, version: cfg.updatedAt ? new Date(cfg.updatedAt).getTime() : now };
  res.set('Cache-Control', 'public, max-age=3, stale-while-revalidate=10');
  res.set('X-Config-Version', String(cache.version));
  res.json(payload);
});

export function invalidateConfigCache() { cache = { at: 0, payload: null, version: 0 }; }

publicRouter.post('/track', trackLimiter, validate(trackBody), async (req, res) => {
  if (req.get('dnt') === '1') return res.status(204).end();
  if (req.get('x-consent') === '0') return res.status(204).end();

  const { buttonId, label, variant } = req.body;
  try {
    await ClickEvent.create({
      buttonId,
      label: label ? safeText(label, 120) : '',
      variant: variant ? safeText(variant, 8) : '',
      ipHash: hashIp(req.ip),
      userAgent: safeText(req.get('user-agent') || '', 160),
      referer: safeText(req.get('referer') || '', 256),
    });
  } catch {}
  res.status(204).end();
});

publicRouter.post('/privacy/forget', publicReadLimiter, async (req, res) => {
  const ipHash = hashIp(req.ip);
  if (!ipHash) return res.status(204).end();
  try {
    const result = await ClickEvent.deleteMany({ ipHash });
    res.json({ deleted: result.deletedCount });
  } catch { res.status(204).end(); }
});

// ── Web Push subscribe (public — anyone can opt in) ───────
publicRouter.get('/push/vapid-key', (req, res) => {
  if (!env.PUSH_VAPID_PUBLIC) return res.status(404).json({ error: 'push_disabled' });
  res.json({ publicKey: env.PUSH_VAPID_PUBLIC });
});

publicRouter.post('/push/subscribe', publicReadLimiter, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || typeof endpoint !== 'string' || endpoint.length > 1024) return res.status(400).json({ error: 'invalid' });
  if (!keys || typeof keys !== 'object' || !keys.p256dh || !keys.auth) return res.status(400).json({ error: 'invalid' });
  try {
    await PushSubscription.updateOne(
      { endpoint },
      {
        $set: {
          endpoint, keys: { p256dh: String(keys.p256dh).slice(0, 256), auth: String(keys.auth).slice(0, 256) },
          ipHash: hashIp(req.ip),
          userAgent: safeText(req.get('user-agent') || '', 200),
        },
      },
      { upsert: true },
    );
  } catch {}
  res.status(204).end();
});
