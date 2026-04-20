// server.js — Express app with full security middleware chain.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import pinoHttp from 'pino-http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { connectDB, disconnectDB } from './db.js';
import { log } from './utils/logger.js';
import { User } from './models/User.js';
import { getAppConfig } from './models/AppConfig.js';
import { MediaAsset } from './models/MediaAsset.js';

// ── Startup feature warnings ────────────────────────────────
// Surface missing-but-impactful config at boot time so operators notice in
// logs. The in-app /api/admin/health/features endpoint exposes the same info
// for UI banners at runtime.
(function warnMissingFeatures() {
  const warn = (id, msg) => log.warn({ feature: id }, msg);
  if (!env.SMTP_HOST) warn('email', 'SMTP_HOST not set — password reset emails will not be delivered');
  if (!env.TURNSTILE_SECRET) warn('captcha', 'TURNSTILE_SECRET not set — CAPTCHA is disabled');
  if (!env.PUSH_VAPID_PUBLIC || !env.PUSH_VAPID_PRIVATE) warn('push', 'VAPID keys not set — Web Push disabled');
  if (!env.REDIS_URL && env.NODE_ENV === 'production') warn('redis', 'REDIS_URL not set in production — rate limits are per-instance only');
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) log.error({ feature: 'cookie_secure' }, 'COOKIE_SECURE=false in production — session cookies will leak over HTTP');
  if (env.LOG_TRANSPORT === 'loki' && !env.LOKI_URL) log.error({ feature: 'logs' }, 'LOG_TRANSPORT=loki but LOKI_URL not set');
})();
import { globalLimiter } from './middleware/rateLimit.js';
import { ensureCsrfCookie } from './middleware/csrf.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Find where the frontend lives. In a unified deploy it's at the repo root
// (one dir up from backend/). If the backend was deployed standalone, a build
// step can place files in backend/public/ instead.
function findStaticRoot() {
  const candidates = [
    path.resolve(__dirname, '..'),           // repo root (unified deploy)
    path.resolve(__dirname, 'public'),       // bundled fallback
    path.resolve(__dirname, '..', 'dist'),   // if a future build step emits here
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(path.join(p, 'index.html'))) return p; } catch {}
  }
  return candidates[0];
}
const STATIC_ROOT = findStaticRoot();
const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);
log.info({ STATIC_ROOT, UPLOAD_ROOT }, 'paths_resolved');

const app = express();

// ── Async error forwarding (Express 4 compat) ──────────────
// Express 4 does not await the promise returned by async route handlers,
// so any `throw` inside an async handler becomes an unhandledRejection
// instead of hitting the error-handling middleware. Patch the Router's
// Layer so promises are awaited and rejections get forwarded to next().
// This makes async errors become proper 500 responses with structured
// logs, not silent drops.
import('express/lib/router/layer.js').then(({ default: Layer }) => {
  const orig = Layer.prototype.handle_request;
  Layer.prototype.handle_request = function (req, res, next) {
    const fn = this.handle;
    // Error-handling layers have arity 4; leave them alone.
    if (fn.length > 3) return orig.call(this, req, res, next);
    try {
      const ret = fn(req, res, next);
      if (ret && typeof ret.then === 'function') ret.catch(next);
    } catch (err) { next(err); }
  };
}).catch(err => log.warn({ err: err.message }, 'async_layer_patch_failed'));

// ── Baseline hardening ──────────────────────────────────────
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);
app.set('etag', false);   // disable ETag to avoid cache-key leakage side channels

// HTTPS enforcement in production. If we end up serving plain HTTP we
// refuse the request rather than quietly send cookies over the wire.
if (env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    // /healthz runs over HTTP from orchestrator — allow it.
    if (req.path === '/healthz' || req.path === '/readyz') return next();
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    if (proto !== 'https') return res.status(403).json({ error: 'https_required' });
    next();
  });
}

// Trust-proxy sanity: one-shot warn on first request if X-Forwarded-For is
// present but we're told not to trust it — real IP becomes the proxy's IP,
// rate limits collapse into one bucket.
let trustProxyWarned = false;
app.use((req, res, next) => {
  if (!trustProxyWarned && env.TRUST_PROXY === 0 && req.get('x-forwarded-for')) {
    trustProxyWarned = true;
    log.warn('TRUST_PROXY=0 but X-Forwarded-For is present — rate limits may be ineffective');
  }
  next();
});

// Helmet — HTTP header hardening. CSP is set per-path below since we
// serve BOTH strict JSON API and an HTML frontend from the same origin.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  noSniff: true,
  xssFilter: false,
}));

// Per-path CSP: strict for API, looser (but still hardened) for HTML.
// frame-ancestors can only be enforced via the HTTP header, not the
// <meta> tag — so we set it here regardless of path to plug that gap.
// Permissions-Policy disables browser features we never use so a future
// XSS can't e.g. silently enable the microphone.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/healthz' || req.path === '/readyz') {
    res.setHeader('Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  } else {
    // HTML: allow what index.html needs but lock down the ambient
    // privileges an XSS would otherwise inherit.
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://unpkg.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com data:; " +
      "img-src 'self' data: blob: https:; " +
      "connect-src 'self' https:; " +
      "object-src 'none'; " +
      // base-uri MUST allow 'self' — index.html relies on <base href="/">
      // to resolve relative <script src="security.jsx"> from the origin root
      // when the page URL is a nested path like /install/<token>. Setting
      // 'none' here silently invalidates the <base> tag, scripts 404 under
      // the nested path, and React never mounts.
      "base-uri 'self'; " +
      "frame-ancestors 'none'; " +
      "form-action 'self'; " +
      "upgrade-insecure-requests");
  }
  res.setHeader('Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), ' +
    'magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  next();
});

// Block TRACE/TRACK globally. They were designed for debugging but enable
// Cross-Site Tracing attacks where an attacker can reflect HttpOnly
// cookies back through a TRACE response and read them from another origin.
// Express doesn't handle TRACE natively, but Node's http server does —
// explicitly reject here before any other middleware can echo headers.
app.use((req, res, next) => {
  if (req.method === 'TRACE' || req.method === 'TRACK') {
    return res.status(405).set('Allow', 'GET,HEAD,POST,PATCH,DELETE,OPTIONS').end();
  }
  next();
});

// Strict Origin/Referer guard on state-changing API requests.
// SameSite=Strict cookies already stop classic CSRF, and we have
// double-submit CSRF tokens on admin mutations, but checking Origin
// HERE provides defense-in-depth: a compromised browser extension or
// a novel CSRF vector (e.g. cache poisoning that serves forgery HTML
// from our own origin) still gets blocked. Allowed origins:
//   • our own public host (derived from Host/X-Forwarded-Host)
//   • the Capacitor APK origins (https://localhost, capacitor://localhost)
//   • any CORS_ORIGINS env entry
const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const APK_ORIGINS = new Set(['https://localhost', 'capacitor://localhost', 'ionic://localhost']);
app.use((req, res, next) => {
  if (!STATE_CHANGING.has(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();
  const origin = req.get('origin') || req.get('referer') || '';
  if (!origin) return next();  // some legit clients (curl, mobile libs) omit — SameSite still protects
  let orHost = '';
  try { orHost = new URL(origin).host.toLowerCase(); } catch { return res.status(403).json({ error: 'bad_origin' }); }
  // Only honour X-Forwarded-Host when we actually trust the proxy that set
  // it. With TRUST_PROXY=0 and the app exposed directly, an attacker can
  // attach `X-Forwarded-Host: evil.com` and `Origin: https://evil.com` and
  // pass this same-origin check — defence-in-depth broken. Gating on
  // TRUST_PROXY > 0 keeps the legitimate proxy case working while shutting
  // the spoof path.
  const fwdHost = (env.TRUST_PROXY > 0)
    ? (req.get('x-forwarded-host') || '').split(',')[0].trim().toLowerCase()
    : '';
  const selfHost = (fwdHost || req.get('host') || '').toLowerCase();
  if (selfHost && orHost === selfHost) return next();
  try {
    const ou = new URL(origin);
    const norm = (ou.protocol + '//' + ou.host).toLowerCase();
    if (APK_ORIGINS.has(norm)) return next();
    for (const allowed of (env.CORS_ORIGINS || [])) {
      if (norm === String(allowed).trim().replace(/\/+$/, '').toLowerCase()) return next();
    }
  } catch {}
  log.warn({ origin, selfHost, path: req.path }, 'origin_guard_rejected');
  return res.status(403).json({ error: 'bad_origin' });
});

// CORS — strict origin allow-list + auto-allow same-origin.
// Same-origin requests happen when the frontend is served from the same
// host as the API (unified deploy on Railway/Render), which is our default.
//
// Two normalisations are needed for proxies in front of us (Railway, Render,
// Fly): trailing slashes and case differences in env-supplied origins, and
// X-Forwarded-Host vs Host (the proxy may rewrite Host to an internal name
// while the browser's Origin is still the public hostname).
function normalizeOrigin(s) {
  return String(s || '').trim().replace(/\/+$/, '').toLowerCase();
}
const ALLOWED_ORIGINS_NORM = (env.CORS_ORIGINS || []).map(normalizeOrigin);

// Capacitor WebViews use non-standard schemes that the browser's Origin
// header reports as. These are trustworthy because no browser will ever
// load them — only the APK/IPA we distribute does. Allowing them keeps
// the mobile app from needing per-deploy CORS_ORIGINS tweaks.
const CAPACITOR_ORIGINS = new Set([
  'https://localhost',      // Capacitor Android with androidScheme=https
  'capacitor://localhost',  // Capacitor iOS default
  'ionic://localhost',      // Legacy Ionic/Capacitor
]);

const corsOpts = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    const norm = normalizeOrigin(origin);
    if (CAPACITOR_ORIGINS.has(norm)) return cb(null, true);
    if (ALLOWED_ORIGINS_NORM.includes(norm)) return cb(null, true);
    if (!corsRejectWarned) {
      corsRejectWarned = true;
      log.warn({ origin, allowed: ALLOWED_ORIGINS_NORM }, 'cors_origin_rejected');
    }
    return cb(new Error('cors_blocked'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 600,
};
let corsRejectWarned = false;

app.use((req, res, next) => {
  // Auto-allow same-origin without requiring it in CORS_ORIGINS.
  // Behind a proxy, Host can be the internal hostname while the browser's
  // Origin is the public one — prefer X-Forwarded-Host when trust_proxy is on.
  // When trust_proxy is 0 (direct exposure) we IGNORE X-Forwarded-Host to
  // prevent spoofing: an attacker crafting both Origin and X-Forwarded-Host
  // to the same bogus value would otherwise bypass the CORS allow-list.
  const origin = req.get('origin');
  if (origin) {
    try {
      const o = new URL(origin);
      const fwdHost = (env.TRUST_PROXY > 0)
        ? (req.get('x-forwarded-host') || '').split(',')[0].trim()
        : '';
      const host = fwdHost || req.get('host');
      if (host && o.host.toLowerCase() === host.toLowerCase()) return next();
    } catch {}
  }
  return cors(corsOpts)(req, res, next);
});

// Structured request logs
app.use(pinoHttp({ logger: log, redact: ['req.headers.authorization', 'req.headers.cookie'] }));

// Body parsing — hard size limits
app.use(express.json({ limit: '100kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// HTTP Parameter Pollution
app.use(hpp());

// NoSQL-injection scrubber — strips $ and . from req.body/query/params
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => log.warn({ key, path: req.path }, 'mongo_sanitize_triggered'),
}));

// Cookies — derive a dedicated signing secret via HKDF so cookie MACs and
// JWT HMACs live in disjoint keyspaces. Previously we passed JWT_SECRET
// straight into cookieParser, which violated the "domain separation" we
// claimed in the comment: a collision or downgrade on one construction
// could bleed into the other. HKDF-SHA256 with a distinct label cleanly
// separates them without requiring a second env var.
const COOKIE_SIGNING_SECRET = Buffer.from(
  crypto.hkdfSync('sha256', env.JWT_SECRET, Buffer.alloc(0), 'cookie-signing-v1', 32)
).toString('hex');
app.use(cookieParser(COOKIE_SIGNING_SECRET));

// Compression — EXCLUDE auth endpoints to mitigate BREACH/CRIME side-channel.
// Any response that can contain tokens or reflect user-chosen input must not be compressed.
app.use(compression({
  filter: (req, res) => {
    if (req.path.startsWith('/api/auth/')) return false;
    if (res.getHeader('x-no-compression')) return false;
    return compression.filter(req, res);
  },
}));

// Global rate limiter
app.use(globalLimiter);

// CSRF cookie minter (applies to every response — header echoing checked per-route)
app.use(ensureCsrfCookie);

// ── Healthcheck ─────────────────────────────────────────────
// /healthz is a liveness probe — the process is up. /readyz is a readiness
// probe — dependencies are healthy enough to accept traffic. Returning
// ready before Mongo is reachable causes orchestrators to send traffic
// that immediately errors, so readyz inspects mongoose.connection.
app.get('/healthz', (req, res) => res.json({ ok: true, t: Date.now() }));
app.get('/readyz',  (req, res) => {
  const dbReady = mongoose.connection?.readyState === 1;
  if (!dbReady) {
    return res.status(503).json({ ok: false, db: false, readyState: mongoose.connection?.readyState ?? -1 });
  }
  res.json({ ok: true, db: true });
});

// Browsers auto-request /favicon.ico even with <link rel="icon" href="...">.
// We don't ship a .ico raster; redirect to the SVG so the tab icon works
// without hitting the SPA fallback (which would serve HTML with
// content-type:text/html and break the favicon silently).
app.get('/favicon.ico', (req, res) => res.redirect(301, '/icon.svg'));

// Explicit robots.txt. We intentionally do NOT list admin or install
// paths here — a robots.txt Disallow advertises sensitive routes to
// every attacker who reads it, and is not a security control (well-
// behaved crawlers obey it, nobody else). The admin / install / media
// paths are already guarded server-side by rotating tokens, auth,
// and random asset IDs; that's the real defence. Sensitive responses
// emit X-Robots-Tag: noindex inline where it actually matters.
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    '',
  ].join('\n'));
});

// ── API routes (must come BEFORE static so /api/* is never treated as a file) ─
app.use('/api',           publicRouter);
app.use('/api/auth',      authRouter);
app.use('/api/admin',     adminRouter);

// ── Uploaded media served from MongoDB ─────────────────────────────────
// Filename pattern (hex.ext) guards against path-traversal; the MediaAsset
// collection also validates ext on insert so the browser Content-Type can
// be trusted. Headers harden the response against sniffing / embedding.
const MEDIA_ID_RE = /^[a-f0-9]{12,64}\.(jpg|jpeg|png|webp|gif|apk)$/i;
app.get('/media/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!MEDIA_ID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' });
  const asset = await MediaAsset.findById(id).lean();
  if (!asset || !asset.data) return res.status(404).json({ error: 'not_found' });
  const isApk = /\.apk$/i.test(id);
  res.setHeader('Content-Type', asset.mime);
  res.setHeader('Content-Length', String(asset.size || asset.data.length));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // cross-origin (not same-site) so the Capacitor WebView on
  // https://localhost can render banners + app icon from the Railway
  // origin. Content-Type is sniff-locked and asset IDs are random
  // 24-hex strings with no path traversal surface, so allowing
  // cross-origin embedding is safe here.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (isApk) {
    // Force download prompt on Android + give a nice filename
    const filename = asset.filename || 'app.apk';
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
    res.setHeader('Accept-Ranges', 'bytes');
  } else {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  }
  res.send(Buffer.isBuffer(asset.data) ? asset.data : Buffer.from(asset.data.buffer || asset.data));
});

// Legacy disk-based uploads (pre-MongoDB era). Kept for backward compat
// with any old config pointing at /uploads/<file>. New uploads go to DB.
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  // Same rationale as /media: APK WebView needs to embed these across origins.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(UPLOAD_ROOT, {
  dotfiles: 'deny',
  maxAge: '30d',
  etag: false,
  immutable: true,
  fallthrough: true,
  index: false,
}));

// ── Block server-side paths from the static serve ──────────────
// STATIC_ROOT is the repo root, which contains backend/, node_modules/,
// mobile/, test/, .github/ etc. Without this guard, express.static below
// happily serves the entire backend source (routes, middleware, models,
// utils), the env schema, ALL npm dependencies with exact versions, and
// the CI/test directories — every one of those is attacker
// reconnaissance gold. The dotfiles option already blocks .env and
// .git, but backend/.env is NOT a dotfile at the URL level, and
// backend/server.js isn't dotted at all. So we filter by prefix.
const BLOCKED_DIR_PREFIXES = [
  '/backend/', '/node_modules/', '/mobile/', '/test/', '/.github/',
  '/scripts/', '/android/', '/ops/', '/_design_source/',
];
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const p = req.path.toLowerCase();
  for (const pfx of BLOCKED_DIR_PREFIXES) {
    if (p === pfx.slice(0, -1) || p.startsWith(pfx)) return res.status(404).json({ error: 'not_found' });
  }
  // Also block specific top-level artefacts that have no reason to be
  // served: package.json, tsconfig, ESLint, git, build configs, and
  // top-level docs that describe internal architecture to attackers.
  const BLOCKED_TOP = new Set([
    '/package.json', '/package-lock.json', '/pnpm-lock.yaml', '/yarn.lock',
    '/tsconfig.json', '/railway.json', '/readme.md', '/dockerfile',
    '/security.md', '/makefile', '/renovate.json', '/log.md',
    '/.env', '/.env.example', '/.env.local', '/.env.production',
    '/deploy.md',
  ]);
  if (BLOCKED_TOP.has(p)) return res.status(404).json({ error: 'not_found' });
  next();
});

// ── Static frontend — served from project root (index.html + jsx + icons) ──
app.use(express.static(STATIC_ROOT, {
  index: 'index.html',
  extensions: ['html'],
  dotfiles: 'ignore',
  maxAge: '5m',
  etag: false,
  setHeaders(res, p) {
    // Serve .jsx as JavaScript so <script type="text/babel" src="x.jsx"> works
    if (p.endsWith('.jsx')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
    // sw.js must not be cached aggressively
    if (p.endsWith('/sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
    }
    // manifest
    if (p.endsWith('manifest.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  },
}));

// SPA fallback: any non-API path with no file match → index.html
// BUT never fall back for asset-looking requests (.jsx, .js, .css, images,
// fonts, manifest, sw.js). Those must either be served as real files or
// return 404. A stale Service Worker from an earlier deploy (before
// <base href="/"> landed) caches an index.html whose relative <script
// src="security.jsx"> resolves against /install/<token>/security.jsx —
// without this guard, SPA fallback returned index.html for that path
// with content-type text/html, Babel tried to parse HTML as JSX, and
// the page stayed blank. 404 forces a real error in the browser so the
// problem surfaces (and the fallback watchdog in index.html can react).
const ASSET_EXT_RE = /\.(jsx|js|mjs|cjs|css|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|otf|map|webmanifest)$/i;
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (ASSET_EXT_RE.test(req.path)) return res.status(404).json({ error: 'not_found' });
  if (req.path === '/sw.js')        return res.status(404).json({ error: 'not_found' });
  res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});

// ── 404 ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// ── Error handler (last) ────────────────────────────────────
app.use((err, req, res, _next) => {
  // CORS errors
  if (err && err.message === 'cors_blocked') {
    return res.status(403).json({ error: 'cors_blocked' });
  }
  // body-parser error taxonomy — map ALL known types to 4xx so a
  // weird-but-legitimate Content-Type (e.g. "application/json;
  // charset=latin-1") can't bubble into a 500 "internal_error". Pen-test
  // reproducer: POST /api/auth/login Content-Type: application/json;
  // charset=latin-1 was returning 500 because iconv-lite rejects
  // "latin-1" with a dash (it expects "latin1"), body-parser surfaces
  // the rejection as `encoding.unsupported`, and our handler used to
  // log+500 anything unknown.
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }
  if (err && (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported')) {
    return res.status(415).json({ error: 'unsupported_charset' });
  }
  if (err && (err.type === 'entity.verify.failed' || err.type === 'request.size.invalid')) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (err && err.type === 'request.aborted') {
    return res.status(400).json({ error: 'aborted' });
  }
  log.error({ err, path: req.path }, 'unhandled_error');
  res.status(500).json({ error: 'internal_error' });
});

// Export the app for tests (supertest imports without listen)
export { app };

// ── Boot ────────────────────────────────────────────────────
// On first boot in a clean DB, auto-provision the AppConfig singleton and a
// first admin account so the operator doesn't need a shell to run the seed
// script. Idempotent: runs only when there's no admin yet. The admin is
// created with mustChangePassword=true so the default credentials force a
// reset on first login.
async function ensureBootstrapped() {
  try { await getAppConfig(); } catch (e) { log.error({ err: e.message }, 'bootstrap_config_failed'); }

  try {
    // ── Break-glass: forced admin password reset via env vars ──────────
    // When the operator sets ADMIN_FORCE_RESET=true together with
    // ADMIN_LOGIN_ID + ADMIN_PASSWORD, the matching account's password is
    // replaced using setPasswordUnsafe() — zxcvbn / HIBP / length rules
    // are ALL skipped, so even a single character works. This is the
    // recovery path when SMTP isn't configured and the admin lost their
    // password. Existing sessions are revoked so the old credentials die.
    // The account's `mustChangePassword` flag is cleared so the operator
    // can log in with their chosen password without hitting the strength
    // enforcement on the next screen.
    if (env.ADMIN_FORCE_RESET) {
      if (!env.ADMIN_LOGIN_ID || !env.ADMIN_PASSWORD) {
        log.error('ADMIN_FORCE_RESET=true but ADMIN_LOGIN_ID or ADMIN_PASSWORD missing — skipping');
      } else {
        const loginId = env.ADMIN_LOGIN_ID.toLowerCase();
        let u = await User.findOne({ loginId }).select('+passwordHash');
        if (!u) {
          u = new User({ loginId, role: 'admin' });
          log.warn({ loginId }, '🔐 ADMIN_FORCE_RESET: creating admin account because loginId not found');
        }
        await u.setPasswordUnsafe(env.ADMIN_PASSWORD);
        u.role = 'admin';
        u.disabledAt = null;
        u.disabledBy = null;
        u.mustChangePassword = false;
        u.failedLoginCount = 0;
        u.lockUntil = null;
        u.tokenVersion = (u.tokenVersion || 0) + 1;       // invalidate any issued JWTs
        await u.save();
        // Best effort: drop existing refresh tokens too so stolen sessions die.
        try {
          const { RefreshToken } = await import('./models/RefreshToken.js');
          await RefreshToken.updateMany(
            { userId: u._id, revokedAt: null },
            { $set: { revokedAt: new Date(), revokeReason: 'admin_force_reset' } },
          );
        } catch {}
        log.warn({ loginId },
          '🔐 ADMIN_FORCE_RESET=true — password replaced, all sessions revoked. ' +
          'REMOVE the env var now, otherwise every restart resets the password again.');
        return;
      }
    }

    // ── Normal first-boot auto-seed ────────────────────────────────────
    // Generate a strong random password if the operator didn't supply
    // one via ADMIN_PASSWORD. Previously the fallback was the literal
    // string "admin123" — that's a critical time-of-deploy race:
    // anyone scanning new Railway/Fly/Render URLs for the seconds
    // between deploy-finished and first-admin-login could log in with
    // admin123/admin123 and (since mustChangePassword doesn't gate
    // /me/password when the flag is on) immediately set their own
    // password, locking the real operator out. The random fallback
    // closes that window — the legitimate operator reads the
    // one-time password from the boot log and logs in.
    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount === 0) {
      const loginId = (env.ADMIN_LOGIN_ID || 'admin').toLowerCase();
      let password = env.ADMIN_PASSWORD;
      let generated = false;
      if (!password) {
        // 24 chars of base64url = ~144 bits of entropy. Print ONCE so
        // the operator can copy from logs; never written anywhere else.
        const cryptoMod = await import('node:crypto');
        password = cryptoMod.randomBytes(18).toString('base64url');
        generated = true;
      }
      const u = new User({ loginId, role: 'admin', mustChangePassword: true });
      await u.setPasswordUnsafe(password);
      await u.save();
      if (generated) {
        const line = '═'.repeat(72);
        console.log('\n' + line);
        console.log('  🔐  FIRST-ADMIN ONE-TIME PASSWORD');
        console.log('');
        console.log('      loginId:  ' + loginId);
        console.log('      password: ' + password);
        console.log('');
        console.log('  Log in at /admin and set a real password. This value is');
        console.log('  shown ONCE — copy it now. Setting ADMIN_PASSWORD in env');
        console.log('  on subsequent boots overrides this generator.');
        console.log(line + '\n');
      } else {
        log.warn({ loginId }, '🔐 auto-seeded first admin from ADMIN_PASSWORD env — change on first login');
      }
    }

    // Admin-access token (kept for backward compat with any old shared
    // /admin/<token> URLs) — no longer printed on boot since /admin is
    // the canonical entrance now.
  } catch (e) {
    log.error({ err: e.message }, 'bootstrap_admin_failed');
  }
}

export async function boot() {
  await connectDB();
  await ensureBootstrapped();
  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, env: env.NODE_ENV }, 'server_listening');
  });
  // Slowloris hardening: drop connections that take too long to send
  // their full request or keep a socket idle. Defaults in Node 20 are
  // generous (5 minutes headers, no requestTimeout) which is fine for
  // a LAN but a bad choice for a public API.
  server.headersTimeout    = 20_000;  // full request headers must arrive within 20s
  server.requestTimeout    = 30_000;  // full request body must arrive within 30s
  server.keepAliveTimeout  = 10_000;  // idle keep-alive sockets closed after 10s
  server.timeout           = 0;        // disable the legacy socket timeout (superseded by requestTimeout)

  const shutdown = async (signal) => {
    log.info({ signal }, 'shutdown_start');
    server.close(async () => {
      try { await disconnectDB(); } catch {}
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    // Serialize whatever got rejected — Error, plain object, or scalar —
    // so the log actually contains a stack / message instead of "{}".
    const payload = err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { value: typeof err === 'object' ? JSON.stringify(err) : String(err) };
    log.error(payload, 'unhandled_rejection');
  });
  process.on('uncaughtException',  (err) => {
    log.error({ name: err?.name, message: err?.message, stack: err?.stack }, 'uncaught_exception');
    process.exit(1);
  });
}

// Only boot when run directly, not when imported by tests
const isDirectRun = import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith('server.js');
if (isDirectRun) {
  boot().catch(err => { log.fatal({ err }, 'boot_failed'); process.exit(1); });
}
