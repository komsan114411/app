// server.js — Express app with full security middleware chain.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import pinoHttp from 'pino-http';

import { env } from './config/env.js';
import { connectDB, disconnectDB } from './db.js';
import { log } from './utils/logger.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { ensureCsrfCookie } from './middleware/csrf.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';

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

// Helmet — HTTP header hardening
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // API-only service — no HTML is served, so CSP is minimal
      'default-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,   // API, not a page
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  noSniff: true,
  xssFilter: false,  // deprecated, CSP is the replacement
}));

// CORS — strict origin allow-list
const corsOpts = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);          // mobile/native/server-to-server
    if (env.CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('cors_blocked'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 600,
};
app.use(cors(corsOpts));

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

// ── Routes ──────────────────────────────────────────────────
app.use('/api',           publicRouter);
app.use('/api/auth',      authRouter);
app.use('/api/admin',     adminRouter);

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
