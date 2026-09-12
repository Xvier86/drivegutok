#!/usr/bin/env bash
set -euo pipefail

# Versi ringkas deploy.sh tanpa backup: untuk VPS yang projectnya di ~/drivegutok.
APP_DIR="${APP_DIR:-$HOME/drivegutok}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"
APP_DIHENTIKAN=0

cd "$APP_DIR"

if [ ! -f update-code.sh ]; then
  echo "!! update-code.sh tidak ada di $APP_DIR. Tarik dulu: git pull origin $BRANCH"
  exit 1
fi

# Sama seperti deploy.sh: kalau langkah setelah aplikasi dihentikan gagal, situs jangan ikut mati.
bersihkan() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$APP_DIHENTIKAN" -eq 1 ]; then
    echo "!! Redeploy gagal (exit $status). Menyalakan ulang aplikasi..."
    pm2 restart ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs || true
    pm2 save || true
    pm2 logs gutok-drive --lines 20 --nostream || true
    echo "!! Perbaiki penyebabnya, lalu jalankan ulang: bash redeploy.sh"
  fi
  return "$status"
}
trap bersihkan EXIT

pm2 stop gutok-drive || true
APP_DIHENTIKAN=1

APP_DIR="$APP_DIR" BRANCH="$BRANCH" bash update-code.sh

npm ci --omit=dev

pm2 restart ecosystem.config.cjs --update-env
pm2 save

HEALTHY=0
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/setup"; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if [ "$HEALTHY" -eq 1 ]; then
  echo ">> Redeploy selesai, aplikasi merespons di http://127.0.0.1:${PORT}/"
else
  echo "!! Aplikasi belum merespons di port ${PORT}. Cek log di bawah."
fi
pm2 logs gutok-drive --lines 30 --nostream || true

[ "$HEALTHY" -eq 1 ]
