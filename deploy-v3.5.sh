#!/usr/bin/env bash
set -euo pipefail

APP=/opt/fp-release
BACKUP_ROOT=/opt/fp-backups
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$BACKUP_ROOT/fp-release-3.4-$STAMP"
ARCHIVE=${1:-/tmp/fp-v3.5.tar.gz}

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Archive not found: $ARCHIVE" >&2
  exit 1
fi

if [[ ! -d "$APP" ]]; then
  echo "Current application directory not found: $APP" >&2
  exit 1
fi

mkdir -p "$BACKUP_ROOT"
pm2 stop fp-release || true

case "$APP" in
  /opt/fp-release) ;;
  *) echo "Unsafe APP path: $APP" >&2; exit 1 ;;
esac

mv "$APP" "$BACKUP"
mkdir -p "$APP"
tar -xzf "$ARCHIVE" -C "$APP" --strip-components=1

cp "$BACKUP/.env" "$APP/.env"
cp "$BACKUP/prisma/dev.db" "$APP/prisma/dev.db"
cp -a "$BACKUP/storage/." "$APP/storage/"

cd "$APP"
npm ci
npx prisma generate
npx prisma db push

pm2 delete fp-release || true
pm2 start "npx tsx api/server.ts" --name fp-release --time
pm2 save

echo "Deploy finished. Backup: $BACKUP"
curl -fsS http://127.0.0.1:3101/api/health || true