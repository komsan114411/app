#!/usr/bin/env bash
# ops/backup.sh — MongoDB logical dump + encrypted upload.
#
# Usage (cron-friendly):
#   MONGO_URI=... BACKUP_BUCKET=s3://... BACKUP_PASSPHRASE=... ops/backup.sh
#
# Requirements on the host: mongodump, openssl, aws CLI (or rclone).
# Produces a gzip+openssl-encrypted dump: myapp-YYYY-MM-DD.dump.gz.enc
#
# RESTORE:
#   openssl enc -aes-256-cbc -pbkdf2 -d -in backup.dump.gz.enc -k "$PASS" | gunzip | mongorestore --archive --uri "$MONGO_URI"

set -euo pipefail

: "${MONGO_URI:?MONGO_URI is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required (store in secret manager)}"

STAMP=$(date -u +%Y-%m-%d)
OUT="myapp-${STAMP}.dump.gz.enc"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "→ dumping ($STAMP)…"
mongodump --archive --gzip --uri "$MONGO_URI" \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -k "$BACKUP_PASSPHRASE" \
  > "$TMP/$OUT"

SIZE=$(stat -c %s "$TMP/$OUT" 2>/dev/null || stat -f %z "$TMP/$OUT")
echo "→ dump ${OUT} = ${SIZE} bytes"

if [[ -n "${BACKUP_BUCKET:-}" ]]; then
  echo "→ uploading to ${BACKUP_BUCKET}/${OUT}…"
  if command -v aws >/dev/null; then
    aws s3 cp "$TMP/$OUT" "${BACKUP_BUCKET}/${OUT}" --sse AES256
  elif command -v rclone >/dev/null; then
    rclone copy "$TMP/$OUT" "$BACKUP_BUCKET"
  else
    echo "✖ no aws / rclone on PATH; backup left in $TMP"
    exit 1
  fi
  echo "✓ uploaded"
else
  mkdir -p ./backups
  mv "$TMP/$OUT" "./backups/$OUT"
  echo "✓ saved to ./backups/$OUT"
fi
