#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/gutok-drive}"   # samain dengan setup.sh
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"

cd "$APP_DIR"

pm2 stop gutok-drive || true

# Backup dulu: data/ berisi kredensial provider terenkripsi, .env berisi STORAGE_CONFIG_KEY.
BACKUP="gutok-drive-backup-$(date +%F-%H%M).tar.gz"
BACKUP_ITEMS=(data/)
if [ -f .env ]; then BACKUP_ITEMS+=(".env"); fi
if [ -f ecosystem.config.cjs ]; then BACKUP_ITEMS+=("ecosystem.config.cjs"); fi
tar -czf "$BACKUP" "${BACKUP_ITEMS[@]}"
echo ">> Backup dibuat: $APP_DIR/$BACKUP"

# Tarik kode terbaru. Secret STORAGE_CONFIG_KEY di ecosystem.config.cjs otomatis diamankan.
APP_DIR="$APP_DIR" BRANCH="$BRANCH" bash update-code.sh

npm ci --omit=dev

pm2 restart ecosystem.config.cjs --update-env
pm2 save

# Pastikan aplikasi benar-benar hidup sebelum lapor selesai.
HEALTHY=0
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/setup"; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if [ "$HEALTHY" -eq 1 ]; then
  echo ">> Deploy selesai, aplikasi merespons di http://127.0.0.1:${PORT}/"
else
  echo "!! Aplikasi belum merespons di port ${PORT}. Cek log di bawah."
fi

curl -I "http://127.0.0.1:${PORT}/" || true
pm2 logs gutok-drive --lines 50 --nostream

[ "$HEALTHY" -eq 1 ]
