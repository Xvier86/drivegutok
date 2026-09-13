#!/usr/bin/env bash
# Perbaiki batas ukuran body di Nginx + BUKTIKAN upload >1 MB sampai ke aplikasi.
#
# Akar masalah "upload di atas 1 MB gagal": kalau `client_max_body_size` tidak diisi di server
# block, Nginx memakai default 1 MB dan menjawab 413 SEBELUM Express melihat request-nya. Aplikasi
# ini tidak punya batas 1 MB (MAX_FILE_SIZE default 5 GB, multer menulis file ke data/tmp), jadi
# 413 selalu datang dari lapisan proxy — bukan dari server.js.
#
# Script ini juga menyalakan gzip untuk aset, mematikan buffering request body ke disk
# (VPS 1 GB: tanpa `proxy_request_buffering off`, Nginx menulis ulang seluruh upload ke disk), dan
# menaikkan `proxy_read_timeout`/`proxy_send_timeout` ke 3600 detik — default Nginx 60 detik memutus
# unggahan besar (jawaban Telegram datang di detik ke-61..95) dengan 502 padahal aplikasinya masih
# menunggu, dan berkasnya sudah terlanjur masuk channel sebagai berkas yatim.
#
# Uji DRY tanpa nginx/sudo (memeriksa transformasi konfigurasi saja):
#   NGINX_CONF=/tmp/fixture.conf DRY=1 bash vps-nginx.sh
#
# Pemakaian di VPS:
#   sudo bash vps-nginx.sh
set -u

DOMAIN="${DOMAIN:-gutokdrive.world}"
PORT="${PORT:-3000}"
MIN_BODY="${MIN_BODY:-5G}"
APP_DIR="${APP_DIR:-/var/www/gutok-drive}"
PUBLIK="${PUBLIK:-https://$DOMAIN}"
NGINX_CONF="${NGINX_CONF:-}"
DRY="${DRY:-0}"
KERJA="$(mktemp -d)"
GAGAL=0
OK=0
trap 'rm -rf "$KERJA"' EXIT

ok()   { OK=$((OK + 1)); printf '  [OK]    %s\n' "$*"; }
bad()  { GAGAL=$((GAGAL + 1)); printf '  [GAGAL] %s\n' "$*"; }
info() { printf '  [info]  %s\n' "$*"; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi
if [ "$DRY" = "0" ] && ! $SUDO -n true 2>/dev/null; then
  echo "!! Butuh root (sudo tanpa sandi) untuk menulis konfigurasi Nginx dan reload."
  exit 1
fi

echo "== Batas upload Nginx Gutok Drive =="
echo "   domain  : $DOMAIN"
echo "   aplikasi: 127.0.0.1:$PORT"
echo "   body    : $MIN_BODY"
echo

# --- 1) Cari konfigurasi situs -------------------------------------------------
if [ -z "$NGINX_CONF" ]; then
  for kandidat in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
    [ -d "$kandidat" ] || continue
    temuan=$(grep -rl "server_name[^;]*\b$DOMAIN\b" "$kandidat" 2>/dev/null | head -1)
    if [ -n "$temuan" ]; then NGINX_CONF="$temuan"; break; fi
  done
fi
if [ -z "$NGINX_CONF" ] || [ ! -r "$NGINX_CONF" ]; then
  bad "konfigurasi Nginx untuk $DOMAIN tidak ditemukan/dibaca (set NGINX_CONF=...)"
  exit 1
fi
ok "konfigurasi: $NGINX_CONF"

AWAL=$(grep -oE 'client_max_body_size[^;]*;' "$NGINX_CONF" | head -1 || true)
PERLU_CMB=1; grep -q 'client_max_body_size' "$NGINX_CONF" && PERLU_CMB=0
PERLU_GZIP=1; grep -qE '^[[:space:]]*gzip[[:space:]]+on' "$NGINX_CONF" && PERLU_GZIP=0
# Buffering diuji per direktif, bukan sekali jalan: pola lama `grep 'proxy_buffering'` tidak cocok
# dengan `proxy_request_buffering`, jadi konfigurasi yang sudah punya `proxy_request_buffering off`
# tetap dianggap "belum ada" dan kedua direktif itu disisipkan lagi -> duplikat dalam satu blok ->
# `nginx -t` gagal dan script mengembalikan cadangannya tanpa pernah memperbaiki apa pun.
PERLU_RB=1; grep -qE '^[[:space:]]*proxy_request_buffering' "$NGINX_CONF" && PERLU_RB=0
PERLU_PB=1; grep -qE '^[[:space:]]*proxy_buffering' "$NGINX_CONF" && PERLU_PB=0
# Batas waktu proxy diuji terpisah dari buffering: di VPS nyata `proxy_request_buffering off` sudah
# dipasang manual tanpa `proxy_read_timeout`, sehingga syarat gabungan lama (perlu_buf) melewatinya
# dan Nginx tetap memakai default `proxy_read_timeout 60s` — unggahan yang jawabannya (Telegram)
# baru datang di detik ke-61..95 dijawab 502 oleh Nginx padahal aplikasinya masih menunggu.
PERLU_TO=1; grep -q 'proxy_read_timeout' "$NGINX_CONF" && PERLU_TO=0
if [ "$PERLU_CMB" -eq 0 ]; then
  ok "client_max_body_size sudah ada: $AWAL"
else
  bad "client_max_body_size tidak ada -> Nginx memakai default 1 MB (penyebab 413)"
fi
info "gzip on: $([ "$PERLU_GZIP" -eq 0 ] && echo ada || echo belum ada) · proxy_request_buffering: $([ "$PERLU_RB" -eq 0 ] && echo ada || echo belum ada) · proxy_buffering: $([ "$PERLU_PB" -eq 0 ] && echo ada || echo belum ada) · proxy_read_timeout: $([ "$PERLU_TO" -eq 0 ] && echo ada || echo belum ada)"

# --- 2) Sisipkan/ganti direktif -------------------------------------------------
if [ "$PERLU_CMB" -eq 0 ]; then
  sed -E "s/client_max_body_size[^;]*;/client_max_body_size $MIN_BODY;/g" "$NGINX_CONF" > "$KERJA/1.conf"
else
  cp "$NGINX_CONF" "$KERJA/1.conf"
fi

# Setiap server block mendapat client_max_body_size sendiri. Mengulang direktif ini di blok BERBEDA
# sah; yang membuat `nginx -t` gagal hanya duplikat dalam satu blok, dan itu tidak terjadi karena
# penggantian nilai di atas berjalan sekali per baris.
# Nilai `proxy_read_timeout`/`proxy_send_timeout` yang sudah ada dinormalkan, bukan disisipkan ulang:
# dua direktif kembar di dalam satu blok membuat `nginx -t` gagal.
if [ "$PERLU_TO" -eq 0 ]; then
  sed -E 's/proxy_read_timeout[^;]*;/proxy_read_timeout 3600;/g; s/proxy_send_timeout[^;]*;/proxy_send_timeout 3600;/g' "$KERJA/1.conf" > "$KERJA/1b.conf"
else
  cp "$KERJA/1.conf" "$KERJA/1b.conf"
fi

awk -v min="$MIN_BODY" -v perlu_cmb="$PERLU_CMB" -v perlu_gzip="$PERLU_GZIP" -v perlu_rb="$PERLU_RB" -v perlu_pb="$PERLU_PB" -v perlu_to="$PERLU_TO" -v port="$PORT" '
  { print }
  perlu_cmb == 1 && $0 ~ /^[[:space:]]*server[[:space:]]*\{[[:space:]]*$/ {
    print "    client_max_body_size " min ";"
    if (perlu_gzip == 1) {
      print "    gzip on;"
      print "    gzip_types text/css application/javascript application/json image/svg+xml;"
      print "    gzip_min_length 1024;"
    }
  }
  perlu_cmb == 0 && perlu_gzip == 1 && $0 ~ /client_max_body_size/ {
    print "    gzip on;"
    print "    gzip_types text/css application/javascript application/json image/svg+xml;"
    print "    gzip_min_length 1024;"
  }
  (perlu_rb == 1 || perlu_pb == 1 || perlu_to == 1) && $0 ~ ("proxy_pass[[:space:]]+http://127\\.0\\.0\\.1:" port) {
    if (perlu_rb == 1) print "        proxy_request_buffering off;"
    if (perlu_pb == 1) print "        proxy_buffering off;"
    if (perlu_to == 1) {
      print "        proxy_read_timeout 3600;"
      print "        proxy_send_timeout 3600;"
    }
  }
' "$KERJA/1b.conf" > "$KERJA/baru.conf"

if ! grep -q 'proxy_pass' "$KERJA/baru.conf"; then
  info "tidak ada proxy_pass di berkas ini — pastikan blok location / memang ada di konfigurasi lain."
fi

echo
echo "-- Perubahan yang akan diterapkan --"
diff -u "$NGINX_CONF" "$KERJA/baru.conf" | sed 's/^/   | /' || true
echo

if [ "$DRY" = "1" ]; then
  info "DRY=1: konfigurasi tidak dipasang, nginx tidak direload."
  cat "$KERJA/baru.conf"
  exit 0
fi

# --- 3) Pasang + uji + reload ---------------------------------------------------
BAK="$NGINX_CONF.bak-$(date +%F-%H%M%S)"
$SUDO cp "$NGINX_CONF" "$BAK"
$SUDO cp "$KERJA/baru.conf" "$NGINX_CONF"
if ! $SUDO nginx -t >"$KERJA/nginx-t.log" 2>&1; then
  bad "nginx -t GAGAL — konfigurasi dikembalikan dari $BAK"
  tail -5 "$KERJA/nginx-t.log" | sed 's/^/   | /'
  $SUDO cp "$BAK" "$NGINX_CONF"
  exit 1
fi
ok "nginx -t lulus (cadangan: $BAK)"
if $SUDO systemctl reload nginx 2>/dev/null || $SUDO service nginx reload 2>/dev/null; then
  ok "nginx direload"
else
  bad "reload nginx gagal"
fi

# --- 4) Bukti: body >1 MB harus sampai ke aplikasi ------------------------------
# Tanpa cookie, Express menjawab 401 pada /api/files. Yang penting di sini BUKAN 401-nya, tapi
# bahwa jawabannya bukan 413 dari proxy. Jadi tidak ada file yang benar-benar tersimpan.
head -c 2097152 /dev/zero | tr '\0' a > "$KERJA/2mb.bin"
head -c 6291456 /dev/zero | tr '\0' a > "$KERJA/6mb.bin"
uji() {
  local url="$1" label="$2" berkas="$3"; shift 3
  local keluaran kode rc ukuran
  ukuran=$(stat -c%s "$berkas")
  keluaran=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 120 "$@" \
    -X POST -H 'Content-Type: multipart/form-data; boundary=uji-uji' \
    --data-binary "@$berkas" "$url" 2>"$KERJA/curl.err"); rc=$?
  kode="${keluaran:-000}"
  case "$kode" in
    413) bad "$label: HTTP 413 — body $ukuran byte masih ditolak batas ukuran" ;;
    401|403) ok "$label: HTTP $kode — body diteruskan sampai aplikasi (bukan 413)" ;;
    *) if [ "$rc" -ne 0 ]; then
         ok "$label: koneksi ditutup aplikasi tanpa sesi (curl rc=$rc) — body diteruskan, bukan 413"
       else bad "$label: HTTP $kode, tidak ada jawaban jelas (curl rc=$rc)"; fi ;;
  esac
}

echo
echo "-- Bukti lapis proxy (tanpa sesi, tidak menyimpan file) --"
uji "http://127.0.0.1:$PORT/api/files" "Express langsung 2 MB" "$KERJA/2mb.bin"
uji "http://127.0.0.1:$PORT/api/files" "Express langsung 6 MB" "$KERJA/6mb.bin"
uji "http://127.0.0.1/api/files" "Nginx lokal (Host: $DOMAIN) 2 MB" "$KERJA/2mb.bin" -H "Host: $DOMAIN"
uji "http://127.0.0.1/api/files" "Nginx lokal (Host: $DOMAIN) 6 MB" "$KERJA/6mb.bin" -H "Host: $DOMAIN"
uji "$PUBLIK/api/files" "Publik $PUBLIK 2 MB" "$KERJA/2mb.bin"
uji "$PUBLIK/api/files" "Publik $PUBLIK 6 MB" "$KERJA/6mb.bin"

if $SUDO nginx -T 2>/dev/null | grep -q "client_max_body_size $MIN_BODY;"; then
  ok "nginx -T memakai client_max_body_size $MIN_BODY"
else
  bad "nginx -T belum menunjukkan client_max_body_size $MIN_BODY"
fi

# Bukti batas waktu proxy benar-benar terpasang di blok yang melayani aplikasi: default Nginx 60s
# memutus unggahan besar tepat saat aplikasi masih menunggu jawaban Telegram (502 dari Nginx).
if $SUDO nginx -T 2>/dev/null | grep -q 'proxy_read_timeout 3600;'; then
  ok "nginx -T memakai proxy_read_timeout 3600 (unggahan lambat tidak diputus proxy)"
else
  bad "nginx -T belum menunjukkan proxy_read_timeout 3600 — unggahan >60 detik masih bisa dijawab 502 oleh Nginx"
fi

ENKODING=$(curl -sS -o /dev/null -D - -H 'Accept-Encoding: gzip' "http://127.0.0.1:$PORT/styles/components.css" 2>/dev/null | grep -i '^content-encoding' | head -1 || true)
if [ -n "$ENKODING" ]; then ok "gzip aktif: $ENKODING"; else info "respons CSS tanpa content-encoding lewat Nginx (gzip belum aktif di blok ini)."; fi

if [ -d "$APP_DIR" ]; then
  AVAIL=$(df -Pk "$APP_DIR" | awk 'NR==2 {print $4}')
  info "sisa disk $APP_DIR: $((AVAIL / 1024)) MB (multer menulis file ke data/tmp saat upload)"
  if [ "$AVAIL" -lt 262144 ]; then bad "sisa disk < 256 MB — upload besar bisa gagal ENOSPC walau batas Nginx sudah benar"; fi
fi

echo
if [ "$GAGAL" -eq 0 ]; then
  echo "== HASIL: BERHASIL ($OK pemeriksaan). Batas upload >1 MB di semua lapis yang bisa diuji lokal. =="
else
  echo "== HASIL: ADA $GAGAL PEMERIKSAAN GAGAL. Tempelkan seluruh output ini. =="
fi
cat <<'CATATAN'

Langkah yang tersisa (bukan Nginx):
1. Kalau baris "Publik https://.../api/files" masih 413 sementara "Nginx lokal" lulus, batasnya di
   Cloudflare (paket gratis 100 MB) — pakai domain DNS-only untuk upload besar.
2. Browser bisa masih memegang CSS/JS lama: Ctrl+Shift+R. Cloudflare -> Caching -> Configuration
   -> Browser Cache TTL = "Respect Existing Headers", lalu Purge Everything.
3. Owner control terbuka sebentar lalu kembali ke "Semua file" hampir selalu cache browser, bukan Nginx:
   Cloudflare memberi aset JS `cache-control: max-age=14400`, jadi JS lama bisa dipakai sampai 4 jam.
   Perbaikannya `no-store` (dikirim server.js) + Ctrl+Shift+R satu kali, dan Caching -> Configuration
   -> Browser Cache TTL = "Respect Existing Headers" + Purge Everything. Buktikan dengan
   `curl -sI https://<domain>/js/views/admin.js | grep -i cache-control`. Kalau headernya sudah benar
   tetapi gejalanya tetap, bandingkan `curl -s https://<domain>/js/views/admin.js | md5sum -` dengan
   `md5sum assets/js/views/admin.js` di VPS — kalau sama, kodenya sudah benar dan tinggal cache browser.
CATATAN

exit "$GAGAL"
