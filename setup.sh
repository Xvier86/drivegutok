#!/usr/bin/env bash
set -euo pipefail

# Deploy pertama di VPS baru: clone, siapkan .env, suntik secret, jalankan PM2.
REPO_URL="${REPO_URL:-https://github.com/Xvier86/drivegutok.git}"
APP_DIR="${APP_DIR:-/var/www/gutok-drive}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"

if [ -d "$APP_DIR/.git" ]; then
  echo ">> Repo sudah ada di $APP_DIR, lewati clone."
else
  sudo mkdir -p "$APP_DIR"
  sudo chown -R "$USER":"$USER" "$APP_DIR"
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
mkdir -p data storage data/tmp

# .env memuat STORAGE_CONFIG_KEY. Nilainya WAJIB sama dengan deployment sebelumnya:
# kalau berubah, konfigurasi provider yang tersimpan terenkripsi di SQLite tidak bisa didekrip.
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -base64 48)
  sed -i "s#^STORAGE_CONFIG_KEY=.*#STORAGE_CONFIG_KEY=${SECRET}#" .env
  echo ">> .env dibuat. STORAGE_CONFIG_KEY: $SECRET"
  echo ">> SIMPAN secret itu di tempat aman."
fi

# PM2 dan update-code.sh membaca secret dari baris ini, jadi nilainya harus ada di dua tempat.
suntik_secret() {
  local secret
  secret=$(grep '^STORAGE_CONFIG_KEY=' .env | head -1 | cut -d '=' -f2-)
  sed -i "s#STORAGE_CONFIG_KEY: '.*'#STORAGE_CONFIG_KEY: '${secret}'#" ecosystem.config.cjs
  echo ">> STORAGE_CONFIG_KEY disuntik ke ecosystem.config.cjs"
}
suntik_secret

npm ci --omit=dev

chmod 750 . server.js ecosystem.config.cjs
chmod 640 package.json package-lock.json
chmod 700 data storage

if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install --global pm2
fi

pm2 start ecosystem.config.cjs
pm2 save
echo ">> Auto-start saat reboot: sudo env PATH=\$PATH pm2 startup, lalu pm2 save lagi."
pm2 status
curl -I "http://127.0.0.1:${PORT}/" || true
