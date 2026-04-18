# MyApp — Link-in-bio + Admin Console

Full-stack single-repo deploy: a link-in-bio frontend + hardened Node/Express/MongoDB
backend + Capacitor mobile shell, all in one Railway service.

## Feature set

### End-user page
- iOS-style hero with auto-rotating image/gradient banners (upload via admin)
- 1–12 customisable action buttons (icon + label + URL + tags)
- Button search (enabled when ≥ 4 buttons)
- Dark-mode toggle + admin-set default (auto/light/dark)
- QR share button (visitor can print/scan the page URL)
- LINE / WhatsApp / Messenger / email / phone contact launcher
- PDPA consent banner with "forget me" endpoint
- PWA (installable) + offline shell via service worker
- Live sync with admin changes within ~5–8 seconds
- Scheduled publish / unpublish per button

### Admin console
- Forced password change on first login (`admin123` / `admin123` default)
- Login ID + password + optional **TOTP 2FA** with 10 backup codes
- **Forgot-password** flow (email-backed when SMTP is configured, console-stub otherwise)
- **Cloudflare Turnstile** CAPTCHA on login/forgot (when `TURNSTILE_SECRET` is set)
- Idle auto-logout (30 min)
- Dashboard: active users, clicks today/week, failed logins 24h, 7-day chart
- ปุ่มเมนู editor with **drag-to-reorder**, tag input, schedule window
- Banner editor with **image upload** (≤ 2 MB, PNG/JPG/WEBP/GIF)
- ติดต่อแอดมิน editor with live preview
- Theme / language / dark-mode defaults
- ความปลอดภัย tab: password change + 2FA setup + active sessions + revoke all
- ผู้ดูแล tab: search, filter by role, add, disable, enable, change role,
  reset password (temp password shown once), revoke sessions
- บันทึกใช้งาน tab: paginated audit log + **CSV export**
- **Web Push** broadcast to subscribed visitors (admin only)
- Self-protection: last-admin cannot be disabled/demoted; self-disable forbidden

### Security
- argon2id password hashing (memory-hard, GPU-resistant)
- JWT rotation with reuse detection + 10-second cross-tab grace window
- `JWT_SECRET_PREV` grace period for secret rotation without forced re-login
- `__Secure-` prefixed httpOnly cookies (refresh + CSRF)
- Double-submit CSRF, constant-time compare
- `helmet` + per-path CSP (strict JSON for API, meta-tag for HTML)
- `express-mongo-sanitize` + `mongoose.sanitizeFilter`
- HPP, strict body limits, HTTPS enforce in production
- Tiered rate limiting with optional Redis store for multi-instance
- IP addresses stored as HMAC-SHA256 — no raw PII
- Audit log retention 1 year, ClickEvent TTL 90 days, refresh token TTL 7 days
- HaveIBeenPwned + zxcvbn strength check on password set
- Compression excluded from `/api/auth/*` (BREACH/CRIME mitigation)
- `security.txt` at `/.well-known/security.txt`
- Nightly encrypted MongoDB backup via GitHub Actions

### Operational
- Unified Railway deploy (one service, one URL, same-origin — no CORS needed)
- Docker + docker-compose for local / self-host
- Renovate config for automated dep updates
- `npm audit` + vitest in CI
- Trufflehog secret-scan in CI
- CycloneDX SBOM generation (`make sbom`)
- Capacitor APK build via GitHub Actions (download `.apk` from Actions)
- PWA for browser-native install (no app store)

## Quick start (Railway)

```bash
git push   # push to main → Railway auto-deploys via railway.json
```

**Environment variables** (Railway → Service → Variables):

Required:
```
NODE_ENV=production
MONGO_URI=<from MongoDB service or Atlas>
JWT_SECRET=<make secrets>
REFRESH_SECRET=<make secrets>
IP_SALT=<make secrets>
COOKIE_SECURE=true
TRUST_PROXY=1
CORS_ORIGINS=https://<your-railway-domain>
```

Optional (enable per feature):
```
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM / APP_PUBLIC_URL   # password-reset email
TURNSTILE_SECRET                   # CAPTCHA
REDIS_URL                          # shared rate-limit store
PUSH_VAPID_PUBLIC / PUSH_VAPID_PRIVATE / PUSH_VAPID_SUBJECT   # web push
JWT_SECRET_PREV                    # secret rotation grace
```

Generate secrets:
```bash
make secrets
make vapid     # for web push
```

First-run seed (creates `admin123` / `admin123` admin, forces change on first login):
```bash
railway run npm run seed
```

## Local dev

```bash
cd backend
npm install
cp .env.example .env        # fill in at least MONGO_URI
npm run seed
npm run dev                 # http://localhost:4000
```

Open `http://localhost:4000/` — serves the frontend. Admin login shows
a yellow hint banner with the default credentials.

## Mobile APK

`.github/workflows/android.yml` — triggers on push or manual `workflow_dispatch`.
Fill `api_base` with your Railway URL, download the `.apk` artifact after build.

Or locally with Android Studio + JDK 17:
```bash
cd mobile && npm install && npx cap add android
API_BASE=https://your-app.up.railway.app node scripts/prepare-web.js
npx cap sync android && npm run build:debug
```

## Testing

```bash
cd backend
npm test               # vitest + mongodb-memory-server + supertest
```

## Layout

```
.
├── index.html              # SPA shell (React + Babel Standalone)
├── *.jsx                   # feature modules (ui, state, security)
├── sw.js                   # service worker (offline + web push)
├── manifest.webmanifest    # PWA
├── backend/                # Node/Express/MongoDB API (serves the frontend too)
│   ├── server.js
│   ├── routes/             # auth · admin · public
│   ├── models/             # User · AppConfig · ClickEvent · Refresh · Audit · PasswordReset · PushSubscription
│   ├── middleware/         # auth · csrf · rateLimit (+redis) · validate · captcha · upload
│   ├── utils/              # tokens · sanitize · totp · email · csv · passwordPolicy · logger
│   └── test/               # vitest integration
├── mobile/                 # Capacitor Android wrapper
├── ops/                    # backup.sh, runbooks
├── .github/workflows/      # ci · android · backup
├── renovate.json           # dep updates
├── railway.json            # Railway deploy config
└── Makefile                # make secrets / seed / test / vapid / backup / sbom
```
