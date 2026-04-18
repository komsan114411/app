# Baansuan API

Production-grade backend for the Baansuan link-in-bio app.

## Quick start

```bash
npm install
cp .env.example .env
# Generate real secrets:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # IP_SALT
# Fill .env with them + MONGO_URI + ADMIN_EMAIL + ADMIN_PASSWORD

npm run seed     # create first admin + empty AppConfig
npm run dev      # watch-mode dev server
npm start        # production
```

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET    | `/api/config`         | public | Current app state (30s cache) |
| POST   | `/api/track`          | public | Log a button click (rate-limited) |
| POST   | `/api/auth/login`     | public | Email + password → access JWT + refresh cookie |
| POST   | `/api/auth/refresh`   | cookie | Rotate refresh + mint new access |
| POST   | `/api/auth/logout`    | cookie | Revoke current refresh |
| GET    | `/api/admin/config`   | admin  | Full admin view of AppConfig |
| PATCH  | `/api/admin/config`   | admin  | Update AppConfig (validated + sanitized) |
| GET    | `/api/admin/analytics`| admin  | 30-day click summary (bounded aggregation) |
| GET    | `/api/admin/audit`    | admin  | Paginated audit log (`?cursor=<iso>&limit=<n>&action=<name>`) |
| POST   | `/api/admin/users/:id/disable` | admin | Disable user + revoke all sessions |
| POST   | `/api/admin/users/:id/enable`  | admin | Re-enable user |
| POST   | `/api/admin/users/:id/revoke-sessions` | admin | Force-logout target user everywhere |
| POST   | `/api/admin/me/password`       | admin | Change own password (policy-checked + HIBP) |
| GET    | `/healthz`            | public | Liveness probe |

## Layout

```
backend/
  server.js               Express app + middleware chain
  db.js                   Mongoose connection (pooled)
  seed.js                 First-boot admin + AppConfig
  config/env.js           zod env validation
  models/
    User.js               argon2id + atomic lockout + tokenVersion + dummy-hash timing
    AppConfig.js          singleton, optimistic concurrency
    ClickEvent.js         TTL 90d, hashed IPs
    RefreshToken.js       rotation + reuse detection
    AuditLog.js           admin actions, TTL 1y
  routes/
    public.js             GET /config (cached), POST /track
    auth.js               login / refresh / logout
    admin.js              /config, /analytics (auth + CSRF)
  middleware/
    auth.js               Bearer verify + role guard
    rateLimit.js          tiered limiters (global / login / track / admin)
    csrf.js               double-submit cookie
    validate.js           zod-based body schemas
  utils/
    tokens.js             access (15m) + refresh (7d) rotation
    sanitize.js           URL whitelist, text normaliser, IP hasher
    logger.js             pino with redaction
```

## Security posture

See [DEPLOY.md](./DEPLOY.md) for the full threat table. Highlights:

- argon2id (m=64MiB, t=3) — memory-hard, no event-loop blocking
- Account lockout after 10 fails (atomic `$inc` — race-free)
- Dummy-hash verification for unknown users → identical login response timing
- Access JWT 15 min + refresh 7d in httpOnly `__Secure-` SameSite=Strict cookie
- ATOMIC refresh rotation with `findOneAndUpdate` + 10s grace window for cross-tab races
- Reuse detection → bump `tokenVersion` + revoke entire family
- CSRF double-submit (`X-CSRF-Token` header vs `__Secure-XSRF-TOKEN` cookie), constant-time compare
- `express-mongo-sanitize` + `mongoose.sanitizeFilter`
- `helmet` CSP, HSTS, noSniff, COOP, CORP
- CORS strict allow-list from `CORS_ORIGINS`
- `express.json` 100kb limit, HPP, body-parser strict mode
- All IPs stored as HMAC-SHA256 with `IP_SALT` (no raw PII)
- Audit log on every admin mutation (1y retention)

## Capacity

Single 4-core VPS, Mongoose pool 50, cache 30s on public config:
- ~2,000 concurrent readers of `/api/config`
- ~400 writes/sec on `/api/track`
- Horizontal: stateless — add instances behind nginx upstream.
