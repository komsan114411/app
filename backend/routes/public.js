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

// Resolve the public origin as the browser would see it, honouring
// Railway/Fly proxies via X-Forwarded-Host. Used to emit ABSOLUTE media
// URLs in the /config response so the installed APK (WebView origin
// https://localhost) and the web (same origin) both work without any
// client-side URL rewriting.
function publicOriginOf(req) {
  const fwdHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
  const fwdProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const host = fwdHost || req.get('host') || 'localhost';
  const proto = fwdProto || (req.secure ? 'https' : 'http');
  return proto + '://' + host;
}

// Rewrite a /media/* or /uploads/* URL to absolute form. Absolute URLs
// and empty strings pass through unchanged. This runs on output only —
// the DB still stores relative paths so admin uploads + downloads keep
// working regardless of where the app is deployed.
function absolutize(origin, u) {
  if (!u || typeof u !== 'string') return u || '';
  if (/^(https?:|data:|blob:)/i.test(u)) return u;
  if (u.startsWith('/media/') || u.startsWith('/uploads/')) return origin + u;
  return u;
}

function materializeConfig(origin, cfg) {
  const banners = (cfg.banners || []).map(b => ({
    ...(b.toObject ? b.toObject() : b),
    imageUrl: absolutize(origin, b.imageUrl),
  }));
  const downloadLinks = { ...(cfg.downloadLinks?.toObject?.() || cfg.downloadLinks || {}) };
  downloadLinks.android = absolutize(origin, downloadLinks.android);
  downloadLinks.ios     = absolutize(origin, downloadLinks.ios);
  return {
    appName: cfg.appName,
    tagline: cfg.tagline,
    appIcon: absolutize(origin, cfg.appIcon || ''),
    theme: cfg.theme,
    language: cfg.language || 'th',
    darkMode: cfg.darkMode || 'auto',
    banners,
    buttons: publishedButtons(cfg.buttons),
    contact: cfg.contact,
    featureFlags: cfg.featureFlags || {},
    downloadLinks,
  };
}

let cache = { at: 0, payload: null, version: 0, origin: '' };
publicRouter.get('/config', publicReadLimiter, async (req, res) => {
  const now = Date.now();
  const origin = publicOriginOf(req);
  // Cache is keyed on origin too: a request from https://localhost
  // and one from the web domain must not share a materialized payload.
  if (cache.payload && cache.origin === origin && now - cache.at < 3_000) {
    res.set('Cache-Control', 'public, max-age=3, stale-while-revalidate=10');
    res.set('X-Config-Version', String(cache.version));
    return res.json(cache.payload);
  }
  const cfg = await getAppConfig();
  const payload = {
    ...materializeConfig(origin, cfg),
    capabilities: {
      emailReset: !!env.SMTP_HOST,
      pushNotifications: !!(env.PUSH_VAPID_PUBLIC && env.PUSH_VAPID_PRIVATE),
      captcha: !!env.TURNSTILE_SECRET,
    },
    updatedAt: cfg.updatedAt,
  };
  cache = { at: now, payload, version: cfg.updatedAt ? new Date(cfg.updatedAt).getTime() : now, origin };
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

// ─── Install-link token gate ────────────────────────────────────
// Dedicated download dashboard at /install/:token. The token rotates
// whenever admin calls /api/admin/install-token/rotate, so a URL that
// was shared yesterday stops working immediately the moment admin
// regenerates. Returns only the subset of config the install page needs.
publicRouter.get('/install/:token/config', publicReadLimiter, async (req, res) => {
  const token = String(req.params.token || '').slice(0, 80);
  if (!token) return res.status(400).json({ error: 'invalid_token' });
  const cfg = await getAppConfig();
  const current = cfg.installToken?.current;
  if (!current) return res.status(410).json({ error: 'not_issued' });
  // Constant-time comparison — the token grants read-only access so timing
  // leakage isn't catastrophic, but better safe than sorry.
  const a = Buffer.from(token); const b = Buffer.from(current);
  if (a.length !== b.length) return res.status(410).json({ error: 'expired' });
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return res.status(410).json({ error: 'expired' });
  const origin = publicOriginOf(req);
  const downloadLinks = { ...(cfg.downloadLinks?.toObject?.() || cfg.downloadLinks || {}) };
  downloadLinks.android = absolutize(origin, downloadLinks.android);
  downloadLinks.ios     = absolutize(origin, downloadLinks.ios);
  res.set('Cache-Control', 'no-store');
  res.json({
    appName: cfg.appName,
    tagline: cfg.tagline,
    appIcon: absolutize(origin, cfg.appIcon || ''),
    theme: cfg.theme,
    downloadLinks,
    rotatedAt: cfg.installToken?.rotatedAt,
  });
});

// ─── Admin access gate ──────────────────────────────────────────
// Verifies a caller-supplied token against AppConfig.adminAccessToken.current
// Only the CURRENT token is accepted — rotating in the admin panel
// immediately blocks every previously shared admin URL. Returning 410
// (instead of 404) lets the frontend show a distinct "expired" message.
publicRouter.get('/admin-gate/:token', publicReadLimiter, async (req, res) => {
  const token = String(req.params.token || '').slice(0, 80);
  if (!token) return res.status(400).json({ error: 'invalid_token' });
  const cfg = await getAppConfig();
  const current = cfg.adminAccessToken?.current;
  if (!current) return res.status(410).json({ error: 'not_issued' });
  // Constant-time compare
  const a = Buffer.from(token); const b = Buffer.from(current);
  if (a.length !== b.length) return res.status(410).json({ error: 'expired' });
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return res.status(410).json({ error: 'expired' });
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
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
