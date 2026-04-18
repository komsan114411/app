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
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { connectDB, disconnectDB } from './db.js';
import { log } from './utils/logger.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { ensureCsrfCookie } from './middleware/csrf.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = path.resolve(__dirname, '..');   // project root (serves index.html + jsx + icons)

const app = express();

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

// Per-path CSP: strict for API, delegated to <meta> tag for HTML.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/healthz' || req.path === '/readyz') {
    res.setHeader('Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  }
  next();
});

// CORS — strict origin allow-list + auto-allow same-origin.
// Same-origin requests happen when the frontend is served from the same
// host as the API (unified deploy on Railway/Render), which is our default.
const corsOpts = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (env.CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('cors_blocked'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 600,
};
app.use((req, res, next) => {
  // Auto-allow same-origin without requiring it in CORS_ORIGINS.
  const origin = req.get('origin');
  if (origin) {
    try {
      const o = new URL(origin);
      const host = req.get('host');
      if (o.host === host) return next();   // skip CORS entirely for same-origin
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

// Cookies (needs secret for signed cookies — reuse JWT secret domain-separated)
app.use(cookieParser(env.JWT_SECRET));

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
app.get('/healthz', (req, res) => res.json({ ok: true, t: Date.now() }));
app.get('/readyz',  (req, res) => res.json({ ok: true }));

// ── API routes (must come BEFORE static so /api/* is never treated as a file) ─
app.use('/api',           publicRouter);
app.use('/api/auth',      authRouter);
app.use('/api/admin',     adminRouter);

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
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
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
  // Invalid JSON
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }
  log.error({ err, path: req.path }, 'unhandled_error');
  res.status(500).json({ error: 'internal_error' });
});

// Export the app for tests (supertest imports without listen)
export { app };

// ── Boot ────────────────────────────────────────────────────
export async function boot() {
  await connectDB();
  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, env: env.NODE_ENV }, 'server_listening');
  });

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
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled_rejection'));
  process.on('uncaughtException',  (err) => { log.error({ err }, 'uncaught_exception'); process.exit(1); });
}

// Only boot when run directly, not when imported by tests
const isDirectRun = import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith('server.js');
if (isDirectRun) {
  boot().catch(err => { log.fatal({ err }, 'boot_failed'); process.exit(1); });
}
