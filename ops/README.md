# ops/ — runbooks & helpers

## `backup.sh`
Nightly encrypted `mongodump` uploaded to S3 (or local `./backups` fallback).
- Run via GitHub Actions `.github/workflows/backup.yml` daily at 01:00 ICT.
- Required GitHub secrets: `MONGO_URI`, `BACKUP_PASSPHRASE`, `BACKUP_BUCKET`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`.
- Restore steps documented at the top of `backup.sh`.

## Secret rotation
- Generate a new JWT secret, keep the old one as `JWT_SECRET_PREV` for the
  grace window (≥ 15 min — length of access-token TTL).
- After 15 min, remove `JWT_SECRET_PREV`.
- Token rotation continues to work because the refresh token lookup is DB-based,
  not signature-based.

## Monitoring hooks
- Set `LOG_TRANSPORT=loki` + `LOKI_URL=https://...` in Railway variables.
- Pino will ship JSON logs to Loki/Grafana.
- Alert on:
  - `login_fail` spike (> 20 / hour → probable credential stuffing)
  - `refresh_reuse_detected` (session-theft indicator)
  - `mongo_sanitize_triggered`
  - HTTP 5xx rate > 0.5%
  - Mongo pool wait > 50ms p95

## WAF (Cloudflare free plan)
1. Add the domain to Cloudflare (change nameservers).
2. Enable "Under Attack Mode" temporarily if abuse detected.
3. Create rate-limit rules for `/api/auth/*` (< 30 req / 10 min / IP).
4. Enable Bot Fight Mode.
5. Add a Turnstile site (see env vars `TURNSTILE_SECRET`).

## Restore procedure (drill quarterly)
1. `aws s3 cp s3://$BACKUP_BUCKET/myapp-YYYY-MM-DD.dump.gz.enc .`
2. `openssl enc -aes-256-cbc -pbkdf2 -d -in myapp-*.dump.gz.enc -k "$PASS" | gunzip | mongorestore --archive --uri "$STAGING_MONGO_URI"`
3. Boot a staging instance pointing at the restored DB.
4. Smoke-test login + admin page + one config save.
5. Document time-to-restore in `incidents.md`.

## Staging environment
Use a second Railway project with the same repo but different variables:
- `MONGO_URI` → separate Atlas cluster / database
- `CORS_ORIGINS` → staging domain
- `NODE_ENV=production` still (to exercise the production code paths)
- Optional `LOG_TRANSPORT=stdout` for easier debugging.

Deploy the `main` branch to staging on every push, but production only on
manual approval (Railway → Service → Deployments → Deploy from tag).
