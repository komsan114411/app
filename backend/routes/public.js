// routes/public.js — Unauthenticated endpoints.

import { Router } from 'express';
import { getAppConfig } from '../models/AppConfig.js';
import { ClickEvent } from '../models/ClickEvent.js';
import { publicReadLimiter, trackLimiter } from '../middleware/rateLimit.js';
import { validate, trackBody } from '../middleware/validate.js';
import { hashIp, safeText } from '../utils/sanitize.js';

export const publicRouter = Router();

// GET /api/config — public-safe subset of AppConfig.
// In-memory cache (30s) to absorb traffic spikes.
// Cache is intentionally short (3s) to keep user page in near-real-time
// with admin edits. Admin PATCH invalidates the cache immediately.
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
    banners: cfg.banners,
    buttons: cfg.buttons,
    contact: cfg.contact,
    updatedAt: cfg.updatedAt,
  };
  cache = { at: now, payload, version: cfg.updatedAt ? new Date(cfg.updatedAt).getTime() : now };
  res.set('Cache-Control', 'public, max-age=3, stale-while-revalidate=10');
  res.set('X-Config-Version', String(cache.version));
  res.json(payload);
});

// Let admin routes invalidate the cache
export function invalidateConfigCache() { cache = { at: 0, payload: null }; }

publicRouter.post('/track', trackLimiter, validate(trackBody), async (req, res) => {
  // Respect Do Not Track + client consent flag
  if (req.get('dnt') === '1') return res.status(204).end();
  if (req.get('x-consent') === '0') return res.status(204).end();

  const { buttonId, label } = req.body;
  try {
    await ClickEvent.create({
      buttonId,
      label: label ? safeText(label, 120) : '',
      ipHash: hashIp(req.ip),
      userAgent: safeText(req.get('user-agent') || '', 160),
      referer: safeText(req.get('referer') || '', 256),
    });
  } catch {
    // swallow — analytics is best-effort
  }
  res.status(204).end();
});

// ─── PDPA / GDPR: forget me ─────────────────────────────────
// Deletes every ClickEvent whose ipHash matches the caller's current IP.
// (We only keep hashed IPs server-side, so this is the only PII we ever have.)
// Rate-limited by publicReadLimiter so it can't be used for enumeration.
publicRouter.post('/privacy/forget', publicReadLimiter, async (req, res) => {
  const ipHash = hashIp(req.ip);
  if (!ipHash) return res.status(204).end();
  try {
    const result = await ClickEvent.deleteMany({ ipHash });
    res.json({ deleted: result.deletedCount });
  } catch {
    res.status(204).end();
  }
});
