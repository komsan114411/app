# Deployment Guide

## Security principles

1. **TLS everywhere** — app listens on 127.0.0.1, TLS terminates at nginx/Cloudflare.
2. **Secrets never in git** — use a secret manager (AWS SSM / Vault / Railway env / Render env).
3. **Least-privilege DB user** — MongoDB user for the app has `readWrite` on ONE database, not `root`.
4. **Logs redact** — pino config strips authorization/cookie/token fields. Never console.log a request object raw.
5. **Upgrades** — `npm audit --omit=dev --audit-level=high` in CI; Renovate or Dependabot on.

## Option A — Docker Compose (single host)

```bash
# 1) Generate secrets
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
export REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
export IP_SALT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export MONGO_ROOT_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
export CORS_ORIGINS=https://your-app.example.com
export COOKIE_DOMAIN=.your-domain.example.com
export COOKIE_SECURE=true

# 2) Build + boot
docker compose up -d --build

# 3) One-time seed (inside the api container)
docker compose exec api node seed.js

# 4) Verify
curl -fsS https://api.your-domain.example.com/healthz
```

## Option B — MongoDB Atlas + Render / Railway / Fly

1. **Atlas** — free M0 cluster is fine for < 500 concurrent. Use IP allow-list, not `0.0.0.0/0`.
2. Copy the SRV connection string with a db-specific user → `MONGO_URI`.
3. Deploy `backend/` to Render — it reads `package.json` start script.
4. Serve `index.html` + sibling `.jsx` from Netlify/Vercel. Before the `<script>` tags, set `window.API_BASE`:

```html
<script>window.API_BASE = 'https://api.your-domain.example.com';</script>
```

## Reverse proxy (nginx example)

```nginx
server {
  listen 443 ssl http2;
  server_name api.your-domain.example.com;

  ssl_certificate     /etc/letsencrypt/live/.../fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/.../privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;
  ssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;

  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  client_max_body_size 128k;
  client_body_timeout 10s;
  client_header_timeout 10s;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
  }
}
```

Remember: `TRUST_PROXY=1` in `.env` must match the number of proxy hops (1 = just nginx; 2 = nginx + Cloudflare).

## Horizontal scaling

- App is **stateless** — refresh tokens live in Mongo, caches are per-process (fine).
- Use PM2: `pm2 start server.js -i max` → one worker per core.
- Or deploy N containers behind nginx upstream or ALB.
- For multi-instance rate limits across nodes, swap `express-rate-limit` memory store for `rate-limit-redis`.

## Threat model summary

| Threat | Mitigation |
|---|---|
| Password DB leak | argon2id m=64MiB t=3 (GPU/ASIC-resistant, memory-hard), unique salt per hash |
| Brute force login | 5 attempts/15min + 10 hard lockout (atomic `$inc`) + dummy-hash timing equalization |
| User enumeration | Unknown user runs `argon2.verify` against dummy hash — identical timing; unified 401 response for all login failures |
| Session theft (localStorage XSS) | Access token in memory only; refresh in httpOnly __Secure- cookie |
| CSRF | SameSite=Strict + double-submit token (`__Secure-XSRF-TOKEN` cookie ↔ `X-CSRF-Token` header), constant-time compare |
| Token replay after logout | DB-tracked refresh, ATOMIC `findOneAndUpdate` rotation with 10s grace window for cross-tab races, reuse → bump tokenVersion + revoke family |
| BREACH/CRIME side-channel | `compression()` filter excludes `/api/auth/*` |
| Plain-HTTP deploy | Runtime 403 on non-HTTPS in production |
| NoSQL injection | express-mongo-sanitize + mongoose strictQuery + sanitizeFilter |
| XSS reflected | API never renders HTML; CORS scoped; helmet CSP |
| SSRF | URL whitelist only — app never fetches admin-supplied URLs |
| DoS by payload | express.json limit 100kb, nginx client_max_body_size 128k |
| DoS by request rate | Global 300 rpm + tiered limiters per endpoint |
| Enumeration via login time | Dummy 150ms delay on unknown users |
| Credential stuffing | Captcha recommendation for production (hCaptcha/Turnstile) |
| Dependency CVE | `npm audit` + pinned versions + Renovate |
| Cookie exfil | httpOnly + Secure + SameSite=Strict |
| Internal network SSRF (CSRF DNS-rebind) | strict Origin check in CORS |
| Clickjacking | X-Frame-Options DENY + frame-ancestors 'none' |
| MIME confusion | X-Content-Type-Options: nosniff |
| Insider DB dump | IPs stored as HMAC-SHA256 with IP_SALT |
| Concurrent admin edits | Mongoose optimisticConcurrency → 409 on stale |

## Backup & recovery

- Atlas: automated point-in-time recovery on M10+
- Self-hosted: `mongodump` to encrypted S3 bucket daily; test restore monthly
- Keep audit logs (`AuditLog` collection) offsite for 1y — used for incident forensics

## Monitoring

- `/healthz` — liveness
- `/readyz` — readiness (checks Mongo)
- Structured JSON logs → ship to Loki / CloudWatch / Datadog
- Alert on: `login_fail` spikes, `mongo_sanitize_triggered`, 5xx rate, DB pool saturation
