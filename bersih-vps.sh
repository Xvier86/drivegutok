#!/usr/bin/env bash
# Rapikan VPS: buang file sisa yang tidak dipakai runtime, lalu putar log PM2.
#
# Kenapa perlu: VPS-nya 1 GB dan disk penuh membuat upload gagal (ENOSPC di data/tmp) serta
# PM2/nginx gagal menulis log. Sisa yang menumpuk tanpa terasa:
#   - arsip backup deploy (gutok-drive-backup-*.tar.gz) dibuat setiap deploy, tidak pernah dihapus
#   - salinan diri deploy.sh/redeploy.sh di /tmp + log uji/perbaikan yang tertinggal
#   - upload yang batal di data/tmp (proses mati sebelum multer selesai)
#   - cadangan konfigurasi nginx dari vps-nginx.sh (*.bak-*), satu per pemanggilan
#   - log PM2 (~/.pm2/logs) yang tidak pernah diputar
#   - cache npm (~/.npm/_cacache) dan objek .git yang sudah tidak terpakai
#
# Aman dijalankan berulang; dipanggil otomatis di akhir deploy.sh (matikan: RAPIKAN=0 bash deploy.sh).
# Pratinjau tanpa menghapus apa pun: DRY=1 bash bersih-vps.sh
#
# Yang TIDAK pernah disentuh: data/mydrive.sqlite*, storage/, .env, ecosystem.config.cjs, kode.
set -u

APP_DIR="${APP_DIR:-/var/www/gutok-drive}"
TMP_DIR="${TMP_DIR:-/tmp}"
SIMPAN_BACKUP="${SIMPAN_BACKUP:-3}"   # jumlah arsip backup terbaru yang disimpan
UMUR_TMP="${UMUR_TMP:-0}"             # nilai -mtime untuk /tmp: +0 = lebih tua dari 24 jam
UMUR_UPLOAD="${UMUR_UPLOAD:-0}"       # nilai -mtime untuk data/tmp (upload yang masih jalan aman)
PM2_LOG_DIR="${PM2_LOG_DIR:-$HOME/.pm2/logs}"
LOGROTATE_DIR="${LOGROTATE_DIR:-/etc/logrotate.d}"
NGINX_DIR="${NGINX_DIR:-/etc/nginx/sites-enabled}"
NPM_CACHE="${NPM_CACHE:-$HOME/.npm/_cacache}"
CLONE_LAMA="${CLONE_LAMA:-$HOME/drivegutok}"
DRY="${DRY:-0}"
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

GAGAL=0
OK=0
BEBAS=0

ok()   { OK=$((OK + 1)); printf '  [OK]    %s\n' "$*"; }
bad()  { GAGAL=$((GAGAL + 1)); printf '  [GAGAL] %s\n' "$*"; }
info() { printf '  [info]  %s\n' "$*"; }

ukuran_kb() { du -sk "$1" 2>/dev/null | awk '{print $1 + 0}'; }

# Hapus satu path (berkas atau folder) sambil mencatat berapa KB yang dibebaskan.
buang() {
  local path="$1" kb
  kb=$(ukuran_kb "$path")
  BEBAS=$((BEBAS + kb))
  if [ "$DRY" = "1" ]; then
    info "[DRY] akan dihapus: $path ($((kb / 1024)) MB)"
    return 0
  fi
  rm -rf -- "$path" 2>/dev/null || { bad "gagal menghapus $path"; return 1; }
}

ukuran_awal=""
if [ -d "$APP_DIR" ]; then
  ukuran_awal=$(df -Pk "$APP_DIR" | awk 'NR==2 {print $4}')
fi

echo "== Rapikan VPS Gutok Drive =="
echo "   aplikasi : $APP_DIR"
echo "   mode     : $([ "$DRY" = "1" ] && echo 'pratinjau (tidak menghapus)' || echo 'hapus')"
echo

# --- 1) Arsip backup lama: sisakan $SIMPAN_BACKUP terbaru -------------------------
if [ -d "$APP_DIR" ]; then
  arsip=$(ls -1t "$APP_DIR"/gutok-drive-backup-*.tar.gz 2>/dev/null || true)
  jumlah=$(printf '%s' "$arsip" | grep -c . || true)
  if [ "$jumlah" -gt "$SIMPAN_BACKUP" ]; then
    while IFS= read -r berkas; do
      [ -n "$berkas" ] && buang "$berkas"
    done < <(printf '%s\n' "$arsip" | tail -n "+$((SIMPAN_BACKUP + 1))")
    ok "arsip backup: $jumlah ada, $((jumlah - SIMPAN_BACKUP)) lama dibuang"
  else
    ok "arsip backup: $jumlah ada (batas simpan $SIMPAN_BACKUP)"
  fi
else
  bad "folder aplikasi $APP_DIR tidak ada (set APP_DIR=...)"
fi

# --- 2) Sisa di /tmp: salinan diri script, log, berkas e2e ------------------------
# Hanya berkas milik user sendiri yang lebih tua dari $UMUR_TMP, jadi salinan deploy.sh yang
# sedang berjalan (baru dibuat) tidak ikut terhapus.
sisa=0
if [ -d "$TMP_DIR" ]; then
  while IFS= read -r -d '' berkas; do
    [ -n "$berkas" ] || continue
    sisa=$((sisa + 1))
    buang "$berkas"
  done < <(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -user "$(id -un)" -mtime "+$UMUR_TMP" \
    \( -name 'deploy-*.sh' -o -name 'redeploy-*.sh' -o -name 'gutok-*' -o -name 'e2e*' \
       -o -name 'perbaiki-vps-*.log' -o -name 'skrip-uji*.log' -o -name 'klik.mjs' -o -name 'debug-*.mjs' \) \
    -print0 2>/dev/null)
fi
ok "sisa /tmp: $sisa item dibuang"

# --- 3) Upload batal di data/tmp --------------------------------------------------
sisa=0
if [ -d "$APP_DIR/data/tmp" ]; then
  while IFS= read -r -d '' berkas; do
    [ -n "$berkas" ] || continue
    sisa=$((sisa + 1))
    buang "$berkas"
  done < <(find "$APP_DIR/data/tmp" -maxdepth 1 -type f -mtime "+$UMUR_UPLOAD" -print0 2>/dev/null)
fi
ok "data/tmp: $sisa upload batal dibuang (upload yang sedang jalan tidak disentuh)"

# --- 4) Cadangan konfigurasi nginx: sisakan yang terbaru --------------------------
if [ -d "$NGINX_DIR" ]; then
  cadangan=$(ls -1t "$NGINX_DIR"/*.bak-* 2>/dev/null || true)
  jumlah=$(printf '%s' "$cadangan" | grep -c . || true)
  if [ "$jumlah" -gt 1 ]; then
    while IFS= read -r berkas; do
      [ -n "$berkas" ] && buang "$berkas"
    done < <(printf '%s\n' "$cadangan" | tail -n +2)
    ok "cadangan nginx: $((jumlah - 1)) berkas lama dibuang (1 terbaru disimpan)"
  else
    ok "cadangan nginx: $jumlah berkas, tidak ada yang menumpuk"
  fi
fi

# --- 5) Log PM2: kosongkan sekarang + pasang logrotate supaya tidak tumbuh lagi ---
# pm2-logrotate adalah modul npm pihak ketiga; logrotate sudah ada di VPS dan bekerja dengan
# `copytruncate`, jadi tidak ada dependensi baru yang perlu dipasang.
if [ -d "$PM2_LOG_DIR" ]; then
  besar=$(ukuran_kb "$PM2_LOG_DIR")
  if [ "$DRY" = "1" ]; then
    info "[DRY] akan dikosongkan: $PM2_LOG_DIR ($((besar / 1024)) MB)"
  elif command -v pm2 >/dev/null 2>&1; then
    if pm2 flush gutok-drive >/dev/null 2>&1; then
      BEBAS=$((BEBAS + besar - $(ukuran_kb "$PM2_LOG_DIR")))
      ok "log PM2 dikosongkan (sebelumnya $((besar / 1024)) MB)"
    else
      info "pm2 flush gagal/skipped"
    fi
  fi
fi

KONF_LOGROTATE="$LOGROTATE_DIR/gutok-drive-pm2"
if ! { [ "$(id -u)" -eq 0 ] || $SUDO -n true 2>/dev/null; }; then
  info "logrotate dilewati: butuh sudo tanpa sandi (jalankan: sudo bash bersih-vps.sh)"
elif [ "$DRY" = "1" ]; then
  info "[DRY] akan ditulis: $KONF_LOGROTATE (size 10M, rotate 5, compress)"
elif printf '%s\n' \
  "$PM2_LOG_DIR/*.log {" \
  "  size 10M" \
  "  rotate 5" \
  "  missingok" \
  "  notifempty" \
  "  copytruncate" \
  "  compress" \
  "  delaycompress" \
  "}" | $SUDO tee "$KONF_LOGROTATE" >/dev/null; then
  ok "logrotate PM2: $KONF_LOGROTATE (log di atas 10 MB diputar otomatis)"
else
  bad "gagal menulis $KONF_LOGROTATE"
fi

# --- 6) Cache npm + pemadatan .git ------------------------------------------------
if [ -d "$NPM_CACHE" ]; then
  b=$(ukuran_kb "$NPM_CACHE")
  buang "$NPM_CACHE" && ok "cache npm dibuang ($((b / 1024)) MB); npm ci berikutnya mengunduh ulang"
fi

if [ -d "$APP_DIR/.git" ] && [ "$DRY" = "0" ]; then
  sebelum=$(ukuran_kb "$APP_DIR/.git")
  if git -C "$APP_DIR" gc --prune=now --quiet 2>/dev/null; then
    sesudah=$(ukuran_kb "$APP_DIR/.git")
    BEBAS=$((BEBAS + sebelum - sesudah))
    ok ".git dipadatkan: $((sebelum / 1024)) MB -> $((sesudah / 1024)) MB"
  else
    info ".git gc dilewati"
  fi
fi

# --- 7) Clone lama yang tidak dipakai lagi (hanya dilaporkan) ---------------------
# Menghapus folder repo utuh bersifat permanen, jadi butuh izin eksplisit:
#   HAPUS_CLONE=1 bash bersih-vps.sh
if [ -d "$CLONE_LAMA" ] && [ "$CLONE_LAMA" != "$APP_DIR" ]; then
  if [ "${HAPUS_CLONE:-0}" = "1" ]; then
    buang "$CLONE_LAMA" && ok "clone lama $CLONE_LAMA dihapus (deploy tetap dari $APP_DIR)"
  else
    info "clone lama masih ada: $CLONE_LAMA ($(( $(ukuran_kb "$CLONE_LAMA") / 1024 )) MB) — hapus: HAPUS_CLONE=1 bash bersih-vps.sh"
  fi
fi

echo
if [ "$GAGAL" -eq 0 ]; then
  echo "== HASIL: SELESAI — $OK pemeriksaan, $((BEBAS / 1024)) MB dibebaskan. =="
else
  echo "== HASIL: ADA $GAGAL MASALAH — tempelkan seluruh output ini. =="
fi
if [ -n "$ukuran_awal" ] && [ -d "$APP_DIR" ]; then
  echo "   Sisa disk $APP_DIR: $((ukuran_awal / 1024)) MB -> $(( $(df -Pk "$APP_DIR" | awk 'NR==2 {print $4}') / 1024 )) MB"
fi
exit "$GAGAL"
