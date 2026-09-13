#!/usr/bin/env bash
set -euo pipefail

# Deploy normal di VPS: backup -> hentikan PM2 -> tarik kode -> npm ci -> start -> health check.
# `git pull` di dalam script ini menulis ulang deploy.sh saat script sedang berjalan, sedangkan bash
# membaca script per-offset byte: sisa script bisa tereksekusi dalam versi lama (pernah terjadi —
# peringatan heap palsu di deploy yang sama). Karena itu script menjalankan dirinya dari salinan
# tetap di /tmp, sehingga isi yang dieksekusi tidak berubah sampai selesai.
if [ -z "${SALINAN_DEPLOY:-}" ]; then
  SALINAN_DEPLOY="$(mktemp /tmp/deploy-XXXXXX.sh)"
  cp "${BASH_SOURCE[0]}" "$SALINAN_DEPLOY"
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" SALINAN_DEPLOY="$SALINAN_DEPLOY" exec bash "$SALINAN_DEPLOY" "$@"
fi

APP_DIR="${APP_DIR:-/var/www/gutok-drive}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"
SELF_DIR="${SELF_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
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

# `pm2 restart` tidak menerapkan ulang `node_args` dari ecosystem.config.cjs: flag heap baru masuk
# ke command line saat proses dibuat. Aplikasi sudah dihentikan di langkah sebelumnya, jadi proses
# dibuat ulang (tanpa tambahan downtime) supaya konfigurasi di repo ini pasti terpakai.
pm2 delete gutok-drive >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save

# Pastikan aplikasi benar-benar hidup sebelum lapor selesai.
HEALTHY=0
for _ in $(seq 1 20); do
  # 2>/dev/null: percobaan pertama memang sering "Connection refused" (proses baru dibuat), dan
  # pesan curl itu di log terbaca seolah deploy gagal padahal loop ini yang menunggu.
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/setup" 2>/dev/null; then
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

# Bukti flag heap benar-benar terpakai di proses yang berjalan, bukan hanya tersimpan di config PM2.
# Tiga sumber dicek: `pm2 env` (PM2 tahu environment proses anaknya), `/proc/<pid>/environ` (di VPS
# ini PM2 menaruh flag di NODE_OPTIONS), dan command line (versi PM2 yang menyalin `node_args`).
PM2_ENV=$(pm2 env 0 2>/dev/null | grep -m1 '^NODE_OPTIONS' || true)
PROSES=$(pgrep -f "$APP_DIR/server.js" 2>/dev/null | head -1) || true
CMDLINE=$(tr '\0' ' ' < "/proc/${PROSES:-0}/cmdline" 2>/dev/null || true)
ENVIRON=$(tr '\0' '\n' < "/proc/${PROSES:-0}/environ" 2>/dev/null | grep '^NODE_OPTIONS=' || true)
case "${CMDLINE}${ENVIRON}${PM2_ENV}" in
  *max-old-space-size*) echo ">> Flag heap terpakai: ${PM2_ENV:-${CMDLINE}${ENVIRON}}" ;;
  *) echo "!! Proses berjalan tanpa flag heap dari ecosystem.config.cjs: ${CMDLINE:-tidak terbaca}" ;;
esac

# Nginx: tanpa `client_max_body_size`, Nginx menjawab 413 untuk body >1 MB SEBELUM Express melihatnya
# (aplikasi ini sendiri tidak punya batas 1 MB, lihat README bagian 11). Dua direktif lain dari
# vps-nginx.sh diuji di sini juga, karena di VPS nyata `client_max_body_size` sudah dipasang manual
# sehingga syarat lama ("belum ada") tidak pernah terpenuhi: `gzip on` membuat aset dikompres, dan
# `proxy_request_buffering off` mencegah Nginx menulis ulang seluruh upload ke disk dulu (di VPS kecil
# itu berarti pemakaian disk dua kali + timeout pada file besar).
# Diparametrikan supaya bisa diuji (uji/skrip-deploy.sh) tanpa menyentuh /etc/nginx.
NGINX_DIR="${NGINX_DIR:-/etc/nginx/sites-enabled}"
NGINX_CONF_D="${NGINX_CONF_D:-/etc/nginx/conf.d}"
NGINX_MAIN="${NGINX_MAIN:-/etc/nginx/nginx.conf}"
NGINX_KURANG=0
if [ -d "$NGINX_DIR" ] || [ -d "$NGINX_CONF_D" ]; then
  for pola in 'client_max_body_size' '^[[:space:]]*gzip[[:space:]]+on' 'proxy_request_buffering'; do
    grep -rEsq "$pola" "$NGINX_DIR" "$NGINX_CONF_D" "$NGINX_MAIN" 2>/dev/null || NGINX_KURANG=1
  done
fi

if [ "$NGINX_KURANG" -eq 1 ]; then
  if [ -f "$APP_DIR/vps-nginx.sh" ] && { [ "$(id -u)" -eq 0 ] || sudo -n true 2>/dev/null; }; then
    echo ">> Nginx belum lengkap (batas upload / gzip / buffering) — memperbaiki dengan vps-nginx.sh..."
    SUDO_CMD=""; [ "$(id -u)" -ne 0 ] && SUDO_CMD="sudo -n"
    APP_DIR="$APP_DIR" $SUDO_CMD bash "$APP_DIR/vps-nginx.sh" || echo "!! vps-nginx.sh melaporkan masalah; lihat output di atas"
  else
    echo "!! Konfigurasi Nginx belum lengkap (batas upload / gzip / buffering): upload di atas 1 MB"
    echo "!! bisa dijawab 413 dan aset tidak dikompres. Jalankan sekali: sudo bash $APP_DIR/vps-nginx.sh"
  fi
fi

# Rapikan sisa file VPS (arsip backup lama, /tmp, upload batal, log PM2, cache npm).
# Matikan dengan: RAPIKAN=0 bash deploy.sh
if [ "${RAPIKAN:-1}" = "1" ] && [ -f "$APP_DIR/bersih-vps.sh" ]; then
  bash "$APP_DIR/bersih-vps.sh" || echo "!! Rapikan melaporkan masalah — jalankan manual: bash $APP_DIR/bersih-vps.sh"
fi

curl -I "http://127.0.0.1:${PORT}/" || true
pm2 logs gutok-drive --lines 50 --nostream

[ "$HEALTHY" -eq 1 ]
