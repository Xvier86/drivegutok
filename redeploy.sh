#!/usr/bin/env bash
set -euo pipefail

# Versi ringkas tanpa backup, untuk VPS yang projectnya ada di ~/drivegutok.
cd ~/drivegutok

pm2 stop gutok-drive || true

APP_DIR="$PWD" BRANCH="${BRANCH:-main}" bash update-code.sh

npm ci --omit=dev

pm2 restart ecosystem.config.cjs --update-env
pm2 save
