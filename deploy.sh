#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/gutok-drive}"   # samain dengan setup.sh
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"
BACKUP=""

# Kalau ada langkah yang gagal setelah aplikasi dihentikan, jangan tinggalkan situs mati.
bersihkan() {
  status=$?
  if [ "$status" -ne 0 ]; then
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

# Backup dulu: data/ berisi kredensial provider terenkripsi, .env berisi STORAGE_CONFIG_KEY.
mkdir -p data storage data/tmp   # tar gagal (exit 2) kalau data/ belum ada
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
  echo "!! Aplikasi belum merespons di port ${PORT}. Cek log di bawah, lalu jalankan ulang"
  echo "!! deploy.sh atau rollback ke commit sebelumnya (lihat README bagian 11)."
fi

curl -I "http://127.0.0.1:${PORT}/" || true
pm2 logs gutok-drive --lines 50 --nostream

[ "$HEALTHY" -eq 1 ]
