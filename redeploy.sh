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

# `pm2 restart` tidak menerapkan ulang `node_args` dari ecosystem.config.cjs: flag heap baru masuk
# ke command line saat proses dibuat. Aplikasi sudah dihentikan di langkah sebelumnya, jadi proses
# dibuat ulang (tanpa tambahan downtime) supaya konfigurasi di repo ini pasti terpakai.
pm2 delete gutok-drive >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
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
# Bukti flag heap benar-benar terpakai di proses yang berjalan, bukan hanya tersimpan di config PM2.
# Sebagian versi PM2 menaruh `node_args` di command line, sebagian di NODE_OPTIONS: dua-duanya dicek.
PROSES=$(pgrep -f "$APP_DIR/server.js" 2>/dev/null | head -1) || true
CMDLINE=$(tr '\0' ' ' < "/proc/${PROSES:-0}/cmdline" 2>/dev/null || true)
ENVIRON=$(tr '\0' '\n' < "/proc/${PROSES:-0}/environ" 2>/dev/null | grep '^NODE_OPTIONS=' || true)
case "${CMDLINE}${ENVIRON}" in
  *max-old-space-size*) echo ">> Flag heap terpakai: ${CMDLINE}${ENVIRON}" ;;
  *) echo "!! Proses berjalan tanpa flag heap dari ecosystem.config.cjs: ${CMDLINE:-tidak terbaca}" ;;
esac

pm2 logs gutok-drive --lines 30 --nostream || true

[ "$HEALTHY" -eq 1 ]
