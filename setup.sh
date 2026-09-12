#!/usr/bin/env bash
set -euo pipefail

# ====== EDIT DULU 3 BARIS INI ======
REPO_URL="https://github.com/Xvier86/drivegutok.git"   # ganti sesuai repo lo
APP_DIR="/var/www/gutok-drive"
BRANCH="main"
# ====================================

if [ ! -d "$APP_DIR/.git" ]; then
  sudo mkdir -p "$APP_DIR"
  sudo chown -R "$USER":"$USER" "$APP_DIR"
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  echo "Repo sudah ada di $APP_DIR, skip clone."
fi

cd "$APP_DIR"
mkdir -p data storage data/tmp

if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -base64 48)
  sed -i "s#STORAGE_CONFIG_KEY=.*#STORAGE_CONFIG_KEY=${SECRET}#" .env
  echo ">> .env dibuat, STORAGE_CONFIG_KEY di-generate otomatis: $SECRET"
  echo ">> CATAT secret ini di tempat aman. Kalau hilang, semua config provider (token/password) tidak bisa didekrip lagi."
fi

# Suntik STORAGE_CONFIG_KEY dari .env ke ecosystem.config.cjs biar dipakai PM2 juga
STORAGE_CONFIG_KEY=$(grep '^STORAGE_CONFIG_KEY=' .env | cut -d '=' -f2-)
sed -i "s#STORAGE_CONFIG_KEY: '.*'#STORAGE_CONFIG_KEY: '${STORAGE_CONFIG_KEY}'#" ecosystem.config.cjs

npm ci --omit=dev

chmod 750 . server.js ecosystem.config.cjs
chmod 640 package.json package-lock.json
chmod 700 data storage

if ! command -v pm2 &> /dev/null; then
  sudo npm install --global pm2
fi

pm2 start ecosystem.config.cjs
pm2 save
echo ">> Jalankan perintah 'sudo env PATH=\$PATH pm2 startup' lalu 'pm2 save' lagi kalau mau auto-start pas reboot."
pm2 status
curl -I http://127.0.0.1:3000/ || true
