# Security posture

This package ships a **defense-in-depth** link-in-bio app — frontend + backend — where *every* layer assumes the other can be compromised.

## Frontend (static HTML / React UMD + Babel standalone)

| Layer | Mechanism |
|---|---|
| Transport | CSP meta, `upgrade-insecure-requests`, `strict-origin-when-cross-origin` Referrer-Policy |
| Script integrity | SRI hashes pinned on react/react-dom/babel CDN scripts |
| Input validation | `security.jsx` — `SafeState.sanitize` on every state write; length caps + control-char strip |
| URL safety | `safeUrl()` scheme whitelist: only `https://`, `tel:`, `mailto:`, `line://`, `fb-messenger://`, `whatsapp://`. Blocks `javascript:`, `data:`, `file:`, `blob:`, `vbscript:` |
| External nav | `openExternal()` uses `window.open(safe, '_blank', 'noopener,noreferrer')` + detaches opener |
| Session tokens | Access token lives in JS memory only — never localStorage. Refresh token is httpOnly cookie, invisible to JS |
| postMessage | Tweaks panel only trusts messages from `window.parent` |
| XSS | React escapes by default; no `dangerouslySetInnerHTML`; CSP forbids inline `eval` |

## Backend (Node 20 + Express + Mongo)

| Layer | Mechanism |
|---|---|
| Transport | TLS terminates at reverse proxy; app binds loopback only; HSTS 2y + preload |
| Identity | bcrypt cost 12, per-account lockout after 10 fails (30-min), `tokenVersion` bump invalidates all sessions |
| Session | JWT 15 min (HS256) + refresh 7d in httpOnly SameSite=Strict cookie, rotated every use, SHA256-hashed at rest, reuse → revoke family |
| CSRF | Double-submit cookie (`XSRF-TOKEN` cookie + `X-CSRF-Token` header), constant-time compare |
| Auth enumeration | 150ms dummy delay on unknown users to equalize timing |
| Input | zod schemas (`.strict()` rejects unknown keys) → server sanitizer (URL whitelist + text normaliser) → Mongoose schema (maxlength) |
| NoSQL injection | `express-mongo-sanitize` + `mongoose.sanitizeFilter` + `strictQuery` |
| HTTP | `helmet` (CSP/HSTS/COOP/CORP/noSniff), `hpp`, `express.json({ limit: '100kb', strict: true })`, `x-powered-by` off |
| CORS | Strict origin allow-list (`CORS_ORIGINS`), credentials only on listed origins, no wildcards |
| Rate limit | Tiered: global 300 rpm · login 5/15min + 20/h burst · track 60/m · admin write 60/m per user |
| Concurrency | Mongoose optimistic concurrency — concurrent edits → HTTP 409 |
| Logs | pino redacts `authorization`, `cookie`, `token`, `password`, `secret` before structured output |
| PII | IPs stored as HMAC-SHA256 with `IP_SALT` — never raw |
| Retention | ClickEvent TTL 90d · RefreshToken TTL 7d · AuditLog TTL 1y |
| Container | non-root user uid 10001, read-only rootfs, tmpfs `/tmp`, `no-new-privileges`, all caps dropped |
| Env | zod validation at boot, placeholder secret detection rejects `CHANGE_ME` in prod, `JWT_SECRET ≠ REFRESH_SECRET` asserted |

## What can still go wrong

- **Babel in-browser** requires `'unsafe-inline'` in script-src. Production should pre-compile JSX with Vite/esbuild and drop that directive.
- **Cache poisoning**: `/api/config` is cached in-process 30s. If caching shifts to a CDN, key on host + path only — never on request-specific headers.
- **Single-region DB**: Atlas outage = app outage. Add read replicas if you need regional failover.
- **No 2FA** for admins yet. For high-value deployments, add TOTP (speakeasy) to `User.js`.
- **No CAPTCHA** on login. Rate-limiter catches obvious abuse; add Turnstile/hCaptcha for credential stuffing resistance.
- **Dependency supply chain**: Pin exact versions (done) + enable Renovate/Dependabot + `npm audit` in CI.

## Running locally

```bash
# Frontend (demo mode — no backend)
python -m http.server 8080    # then open http://localhost:8080

# With backend
cd backend
npm install
cp .env.example .env    # fill in secrets
npm run seed
npm run dev
# Then in index.html, add before the script tags:
#   <script>window.API_BASE = 'http://localhost:4000';</script>
```
