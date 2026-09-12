#!/usr/bin/env bash
set -euo pipefail

# Deploy normal di VPS: backup -> hentikan PM2 -> tarik kode -> npm ci -> start -> health check.
APP_DIR="${APP_DIR:-/var/www/gutok-drive}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP=""
APP_DIHENTIKAN=0

# update-code.sh dicari di APP_DIR lebih dulu (versi yang sudah terpasang), lalu di folder script ini
# supaya `bash ~/drivegutok/deploy.sh` tetap bisa menyelesaikan deploy pertama ke /var/www/gutok-drive.
UPDATE_CODE=""
for kandidat in "$APP_DIR/update-code.sh" "$SELF_DIR/update-code.sh"; do
  if [ -f "$kandidat" ]; then
    UPDATE_CODE="$kandidat"
    break
  fi
done

if [ -z "$UPDATE_CODE" ]; then
  echo "!! update-code.sh tidak ditemukan di $APP_DIR maupun $SELF_DIR."
  echo "!! Deploy pertama setelah setup masih perlu langkah manual: lihat README bagian 11."
  exit 1
fi

if [ ! -d "$APP_DIR" ]; then
  echo "!! Folder aplikasi $APP_DIR tidak ada. Pakai setup.sh dulu, atau set APP_DIR=... sesuai lokasi project."
  exit 1
fi

# Kalau ada langkah yang gagal setelah aplikasi dihentikan, jangan tinggalkan situs mati.
bersihkan() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$APP_DIHENTIKAN" -eq 1 ]; then
    echo "!! Deploy gagal (exit $status)."
    echo "!! Menyalakan ulang aplikasi supaya situs tidak ikut mati..."
    pm2 restart ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs || true
    pm2 save || true
    pm2 logs gutok-drive --lines 20 --nostream || true
    if [ -n "$BACKUP" ]; then
      echo "!! Backup sebelum deploy ini: $APP_DIR/$BACKUP"
    fi
    echo "!! Perbaiki penyebabnya, lalu jalankan ulang: bash deploy.sh"
  fi
  return "$status"
}
trap bersihkan EXIT

cd "$APP_DIR"

pm2 stop gutok-drive || true
APP_DIHENTIKAN=1

# data/ berisi kredensial provider terenkripsi, .env berisi STORAGE_CONFIG_KEY.
mkdir -p data storage data/tmp   # tar gagal (exit 2) kalau data/ belum ada
BACKUP="gutok-drive-backup-$(date +%F-%H%M).tar.gz"
BACKUP_ITEMS=(data/)
if [ -f .env ]; then BACKUP_ITEMS+=(.env); fi
if [ -f ecosystem.config.cjs ]; then BACKUP_ITEMS+=(ecosystem.config.cjs); fi
tar -czf "$BACKUP" "${BACKUP_ITEMS[@]}"
echo ">> Backup dibuat: $APP_DIR/$BACKUP"

# Tarik kode terbaru. Secret di ecosystem.config.cjs diamankan update-code.sh lalu disuntik ulang.
APP_DIR="$APP_DIR" BRANCH="$BRANCH" bash "$UPDATE_CODE"

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
  echo "!! Aplikasi belum merespons di port ${PORT}. Cek log di bawah, lalu jalankan ulang"
  echo "!! deploy.sh atau rollback ke commit sebelumnya (lihat README bagian 11)."
fi

curl -I "http://127.0.0.1:${PORT}/" || true
pm2 logs gutok-drive --lines 50 --nostream

[ "$HEALTHY" -eq 1 ]
