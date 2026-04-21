// routes/public.js — Unauthenticated endpoints.

import { Router } from 'express';
import crypto from 'node:crypto';
import { getAppConfig, publishedButtons } from '../models/AppConfig.js';
import { ClickEvent } from '../models/ClickEvent.js';
import { PushSubscription } from '../models/PushSubscription.js';
import { Device } from '../models/Device.js';
import { EventLog, EVENT_TYPES } from '../models/EventLog.js';
import { publicReadLimiter, trackLimiter } from '../middleware/rateLimit.js';
import { validate, trackBody } from '../middleware/validate.js';
import { hashIp, safeText } from '../utils/sanitize.js';
import { env } from '../config/env.js';

export const publicRouter = Router();

// Opaque tag used in X-Config-Version. Earlier versions emitted the
// raw millisecond timestamp so the client could coalesce updates —
// but that doubled as a deploy clock an attacker could poll to
// fingerprint restarts / config pushes. HMAC with a per-process salt
// keeps the tag useful (same input → same output within the process,
// changes when config actually updates) while leaking no temporal
// info across processes.
const CONFIG_VERSION_SALT = crypto.randomBytes(16);
function opaqueVersion(raw) {
  return crypto.createHmac('sha256', CONFIG_VERSION_SALT).update(String(raw)).digest('hex').slice(0, 16);
}

// Resolve the public origin as the browser would see it, honouring
// Railway/Fly proxies via X-Forwarded-Host. Used to emit ABSOLUTE media
// URLs in the /config response so the installed APK (WebView origin
// https://localhost) and the web (same origin) both work without any
// client-side URL rewriting.
//
// TRUST_PROXY gate: only honour X-Forwarded-* when we trust the upstream
// proxy. With TRUST_PROXY=0 (direct exposure) an attacker crafting
// X-Forwarded-Host: evil.com could poison cached /config payloads with
// imageUrl/appIcon/downloadLinks pointing to their own domain. The Vary
// header already segregates cache entries by origin, but gating here
// keeps the absolutized URLs honest to our actual host.
function publicOriginOf(req) {
  const trusted = env.TRUST_PROXY > 0;
  const fwdHost = trusted ? (req.get('x-forwarded-host') || '').split(',')[0].trim() : '';
  const fwdProto = trusted ? (req.get('x-forwarded-proto') || '').split(',')[0].trim() : '';
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
  // Emit Vary so any shared cache (CDN / reverse proxy / Service Worker)
  // segregates cached payloads by the same signals we key the in-process
  // cache on. Without this, a request from https://attacker.example with
  // a spoofed X-Forwarded-Host could poison the cached config served to
  // the legitimate origin.
  res.set('Vary', 'Origin, Host, X-Forwarded-Host, X-Forwarded-Proto');
  // Cache is keyed on origin too: a request from https://localhost
  // and one from the web domain must not share a materialized payload.
  if (cache.payload && cache.origin === origin && now - cache.at < 3_000) {
    res.set('Cache-Control', 'public, max-age=3, stale-while-revalidate=10');
    res.set('X-Config-Version', opaqueVersion(cache.version));
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
  res.set('X-Config-Version', opaqueVersion(cache.version));
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

// ─── Growth / retention event ingestion ──────────────────────────
// Accepts a batched event list from the browser / APK. Keeps the
// old /track endpoint alive for existing button taps but everything
// new — install funnel, sessions, screen views, errors — flows here.
//
// Request shape (JSON):
//   {
//     deviceId:    "uuid-v4"           // required, client-generated
//     sessionId:   "uuid-v4"           // optional but strongly encouraged
//     appVersion:  "9a4f1e1" or ""     // commit SHA baked into bundle
//     platform:    "android-apk" | "web-desktop" | …
//     osVersion:   "13" | "17.2" | ""
//     deviceModel: "SM-A536E" | ""     // parsed UA hint (optional)
//     locale:      navigator.language
//     sourceToken: ""                  // install link token, if any
//     utmSource / utmCampaign / utmMedium / utmContent : strings
//     firstSeenMedium: "line-inapp" | …
//     events: [
//       { type, target, label, variant, durationMs }, …
//     ]
//   }
//
// Consent gates:
//   • DNT: 1       → 204, nothing written
//   • X-Consent: 0 → 204, nothing written
//   • Else         → upsert Device (non-destructive — attribution fields
//                    only fill if currently empty), bulk-insert events.
//
// Rate limit: reuse trackLimiter (~1.5 req/sec/IP) — events are batched
// so one request per 1.5 s is plenty for any real user.
function validateDeviceId(raw) {
  const s = String(raw || '').slice(0, 40);
  // Accept UUIDv4-ish or any 8-40 char slug we issue ourselves.
  return /^[A-Za-z0-9_-]{8,40}$/.test(s) ? s : '';
}

publicRouter.post('/track/event', trackLimiter, async (req, res) => {
  if (req.get('dnt') === '1') return res.status(204).end();
  if (req.get('x-consent') === '0') return res.status(204).end();

  const body = req.body || {};
  const deviceId = validateDeviceId(body.deviceId || req.get('x-device'));
  if (!deviceId) return res.status(400).json({ error: 'invalid_device_id' });

  const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  if (!events.length) return res.status(204).end();

  // Normalise top-level context fields once — every event inherits them.
  const ctx = {
    sessionId:   safeText(body.sessionId || req.get('x-session') || '', 40),
    sourceToken: safeText(body.sourceToken || '', 40),
    utmSource:   safeText(body.utmSource || '', 40),
    utmCampaign: safeText(body.utmCampaign || '', 60),
    appVersion:  safeText(body.appVersion || '', 40),
    platform:    safeText(body.platform || '', 16),
    ipHash:      hashIp(req.ip),
  };

  const now = new Date();
  try {
    // Non-destructive device upsert. $setOnInsert captures attribution at
    // first contact; $set updates things that naturally change boot-to-boot
    // (lastSeen, platform, appVersion, ipHash). Counters bump atomically.
    const setOnInsert = {
      _id: deviceId,
      firstSeen: now,
      sourceToken:     ctx.sourceToken,
      utmSource:       ctx.utmSource,
      utmCampaign:     ctx.utmCampaign,
      utmMedium:       safeText(body.utmMedium || '', 40),
      utmContent:      safeText(body.utmContent || '', 60),
      firstSeenMedium: safeText(body.firstSeenMedium || '', 24),
    };
    await Device.updateOne(
      { _id: deviceId },
      {
        $setOnInsert: setOnInsert,
        $set: {
          lastSeen:    now,
          platform:    ctx.platform,
          osVersion:   safeText(body.osVersion || '', 24),
          deviceModel: safeText(body.deviceModel || '', 60),
          locale:      safeText(body.locale || '', 16),
          appVersion:  ctx.appVersion,
          ipHash:      ctx.ipHash,
          lastUa:      safeText(req.get('user-agent') || '', 160),
        },
        $inc: {
          totalEvents:   events.length,
          totalSessions: events.filter(e => e && e.type === 'session_start').length,
        },
      },
      { upsert: true }
    );

    // Bulk-insert the event batch. Drop unknown types silently rather than
    // reject the whole batch — a new client shipping an event type the old
    // server doesn't understand shouldn't kill analytics for everyone.
    const docs = [];
    for (const e of events) {
      if (!e || typeof e !== 'object') continue;
      const type = String(e.type || '').slice(0, 32);
      if (!EVENT_TYPES.has(type)) continue;
      docs.push({
        deviceId,
        sessionId:   ctx.sessionId,
        type,
        target:      safeText(e.target || '', 256),
        label:       safeText(e.label  || '', 200),
        variant:     safeText(e.variant || '', 8),
        durationMs:  Math.max(0, Math.min(6 * 60 * 60_000, Number(e.durationMs) || 0)),
        sourceToken: ctx.sourceToken,
        utmSource:   ctx.utmSource,
        utmCampaign: ctx.utmCampaign,
        appVersion:  ctx.appVersion,
        platform:    ctx.platform,
        ipHash:      ctx.ipHash,
        createdAt:   now,
      });
    }
    if (docs.length) await EventLog.insertMany(docs, { ordered: false });
  } catch {
    // Intentionally swallow — analytics must never fail a client flow.
  }
  res.status(204).end();
});

// ─── Client error beacon ─────────────────────────────────────────
// A minimal error sink so JS errors on the APK/Web surface back to the
// operator. Runs on top of the EventLog stream (type=error).
publicRouter.post('/track/error', trackLimiter, async (req, res) => {
  if (req.get('dnt') === '1') return res.status(204).end();
  if (req.get('x-consent') === '0') return res.status(204).end();
  const body = req.body || {};
  const deviceId = validateDeviceId(body.deviceId || req.get('x-device'));
  if (!deviceId) return res.status(204).end();
  try {
    await EventLog.create({
      deviceId,
      sessionId: safeText(body.sessionId || '', 40),
      type: 'error',
      // target = URL where the error occurred, label = message (truncated)
      target:  safeText(body.url || '', 256),
      label:   safeText(body.message || '', 200),
      appVersion: safeText(body.appVersion || '', 40),
      platform:   safeText(body.platform   || '', 16),
      sourceToken: safeText(body.sourceToken || '', 40),
      ipHash: hashIp(req.ip),
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

// Erase all data this requester might have generated. Two axes:
//   1. Anything stored by IP hash (ClickEvent, EventLog, error rows)
//   2. If they POST a deviceId we recognise, delete the Device doc and
//      everything ever keyed to it (EventLog, future Session doc).
// Silent 204 either way — we never tell the caller what was found.
publicRouter.post('/privacy/forget', publicReadLimiter, async (req, res) => {
  const ipHash = hashIp(req.ip);
  const bodyDev = validateDeviceId((req.body && req.body.deviceId) || req.get('x-device'));
  if (!ipHash && !bodyDev) return res.status(204).end();
  let clicks = 0, events = 0, devices = 0;
  try {
    if (ipHash) {
      const r1 = await ClickEvent.deleteMany({ ipHash });
      clicks = r1.deletedCount || 0;
      const r2 = await EventLog.deleteMany({ ipHash });
      events += r2.deletedCount || 0;
    }
    if (bodyDev) {
      const r3 = await EventLog.deleteMany({ deviceId: bodyDev });
      events += r3.deletedCount || 0;
      const r4 = await Device.deleteOne({ _id: bodyDev });
      devices = r4.deletedCount || 0;
    }
    res.json({ clicks, events, devices });
  } catch { res.status(204).end(); }
});

// ── Web Push subscribe (public — anyone can opt in) ───────
publicRouter.get('/push/vapid-key', (req, res) => {
  if (!env.PUSH_VAPID_PUBLIC) return res.status(404).json({ error: 'push_disabled' });
  res.json({ publicKey: env.PUSH_VAPID_PUBLIC });
});

// Allow-list of known Web Push service hosts. An attacker who POSTs a
// subscription with endpoint=http://169.254.169.254/... or an internal
// URL would otherwise turn `admin → /push/broadcast` into a blind SSRF
// (the web-push lib POSTs to whatever endpoint we stored). Restricting
// at subscribe time is the right place — broadcast is server-trusted.
// Subdomains of the base domains below are allowed; everything else
// is rejected. Public Web Push spec: only these services exist.
const PUSH_HOST_ALLOWLIST = [
  'fcm.googleapis.com',                 // Chrome / Chromium (Android + desktop)
  'updates.push.services.mozilla.com',  // Firefox
  'notify.windows.com',                 // Edge (matches *.notify.windows.com)
  'push.apple.com',                     // Safari 16+ (matches *.push.apple.com)
];

function isAllowedPushEndpoint(raw) {
  if (typeof raw !== 'string' || raw.length > 1024) return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  for (const base of PUSH_HOST_ALLOWLIST) {
    if (host === base || host.endsWith('.' + base)) return true;
  }
  return false;
}

publicRouter.post('/push/subscribe', publicReadLimiter, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!isAllowedPushEndpoint(endpoint)) return res.status(400).json({ error: 'invalid_endpoint' });
  if (!keys || typeof keys !== 'object' || !keys.p256dh || !keys.auth) return res.status(400).json({ error: 'invalid' });
  // Phase 3: accept an optional deviceId so the admin can resolve a
  // push segment directly to subscription endpoints without going
  // through the ipHash proxy join.
  const deviceId = validateDeviceId((req.body && req.body.deviceId) || req.get('x-device'));
  try {
    await PushSubscription.updateOne(
      { endpoint },
      {
        $set: {
          endpoint, keys: { p256dh: String(keys.p256dh).slice(0, 256), auth: String(keys.auth).slice(0, 256) },
          ipHash: hashIp(req.ip),
          userAgent: safeText(req.get('user-agent') || '', 200),
          ...(deviceId ? { deviceId } : {}),
        },
      },
      { upsert: true },
    );
  } catch {}
  res.status(204).end();
});
