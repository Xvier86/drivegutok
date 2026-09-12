#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/gutok-drive"   # samain dengan setup.sh
BRANCH="main"

cd "$APP_DIR"

pm2 stop gutok-drive
tar -czf "gutok-drive-backup-$(date +%F-%H%M).tar.gz" data/ ecosystem.config.cjs

git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

npm ci --omit=dev

pm2 restart ecosystem.config.cjs --update-env
pm2 save

echo ">> Deploy selesai. Cek log kalau ada error:"
pm2 logs gutok-drive --lines 50 --nostream
curl -I http://127.0.0.1:3000/ || true
