#!/usr/bin/env bash
# Sekali pakai: deploy bersih dari nol di VPS.
# AMAN: database, .env, STORAGE_CONFIG_KEY disalin sebelum hapus. Backup gagal = batal.
set -u

APP_DIR="${APP_DIR:-/var/www/gutok-drive}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"
REMOTE="https://github.com/Xvier86/drivegutok.git"
GAGAL=0

ok()   { printf '  [OK]    %s\n' "$*"; }
bad()  { printf '  [GAGAL] %s\n' "$*"; GAGAL=$((GAGAL + 1)); }
info() { printf '  [info]  %s\n' "$*"; }

echo "== Deploy Bersih Gutok Drive =="
echo "   APP_DIR : $APP_DIR"
echo "   remote  : $REMOTE ($BRANCH)"
echo

echo "-- [0/5] Backup data penting ke /tmp --"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ -d "$APP_DIR/data" ]; then
  mkdir -p "$TMP/data"
  cp -rp "$APP_DIR/data" "$TMP/" || { bad "Gagal menyalin data/"; exit 1; }
  echo "   data/ disalin: $(find "$TMP/data" -type f | wc -l) file"
fi
if [ -f "$APP_DIR/.env" ]; then
  cp -p "$APP_DIR/.env" "$TMP/.env" || { bad "Gagal menyalin .env"; exit 1; }
  echo "   .env disalin"
fi
SECRET=""
if [ -f "$APP_DIR/.env" ]; then
  SECRET=$(grep '^STORAGE_CONFIG_KEY=' "$APP_DIR/.env" | head -1 | cut -d'=' -f2- || true)
fi
if [ -z "$SECRET" ] && [ -f "$APP_DIR/ecosystem.config.cjs" ]; then
  SECRET=$(sed -n "s/^ *STORAGE_CONFIG_KEY: *'\(.*\)'.*/\1/p" "$APP_DIR/ecosystem.config.cjs" | head -1 || true)
fi
if [ -n "$SECRET" ]; then
  echo "   STORAGE_CONFIG_KEY tersimpan ($(echo -n "$SECRET" | wc -c) karakter)"
else
  info "STORAGE_CONFIG_KEY tidak ditemukan."
fi
TAR="/tmp/gutok-drive-backup-bersih-$(date +%F-%H%M).tar.gz"
tar -czf "$TAR" -C "$TMP" . 2>/dev/null && echo "   tarball: $TAR" || info "tarball gagal"
echo

echo "-- [1/5] Matikan aplikasi --"
pm2 stop gutok-drive 2>/dev/null || true
sleep 2
echo

echo "-- [2/5] Hapus $APP_DIR dan clone fresh --"
rm -rf "$APP_DIR"
if [ -d "$APP_DIR" ]; then
  bad "Gagal menghapus $APP_DIR. Backup di $TMP dan $TAR"; exit 1
fi
git clone --branch "$BRANCH" --single-branch "$REMOTE" "$APP_DIR" 2>&1 | sed 's/^/   | /'
if [ ! -d "$APP_DIR/.git" ]; then
  bad "Clone gagal. Backup di $TMP dan $TAR"; exit 1
fi
cd "$APP_DIR"
echo "   commit: $(git rev-parse --short HEAD)"
echo

echo "-- [3/5] Restore data, .env, dan secret --"
mkdir -p data storage data/tmp
if [ -d "$TMP/data" ]; then
  cp -rp "$TMP/data/." data/ || bad "Gagal me-restore data/!"
  echo "   data/ direstore: $(find data -type f | wc -l) file"
fi
if [ -f "$TMP/.env" ]; then
  cp -p "$TMP/.env" .env; echo "   .env direstore"
elif [ -n "$SECRET" ]; then
  printf 'STORAGE_CONFIG_KEY=%s\n' "$SECRET" > .env; echo "   .env dibuat dari secret"
fi
if [ -n "$SECRET" ]; then
  sed -i "s#STORAGE_CONFIG_KEY: '.*'#STORAGE_CONFIG_KEY: '${SECRET}'#" ecosystem.config.cjs
  echo "   SECRET disuntik ke ecosystem.config.cjs"
fi
echo

echo "-- [4/5] npm ci + pm2 start --"
npm ci --omit=dev 2>&1 | tail -3 | sed 's/^/   | /'
pm2 start ecosystem.config.cjs 2>&1 | sed 's/^/   | /'
pm2 save 2>&1 | sed 's/^/   | /'

HEALTHY=0
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/setup" 2>/dev/null; then
    HEALTHY=1; break; fi; sleep 1
done
[ "$HEALTHY" -eq 1 ] && echo "   >> Aplikasi merespons" || bad "Aplikasi belum merespons setelah 20 detik"
echo

echo "-- [5/5] Verifikasi --"
HEAD_NOW=$(git rev-parse --short HEAD)
TIP=$(git rev-parse --short "origin/$BRANCH" 2>/dev/null || echo '?')
[ "$HEAD_NOW" = "$TIP" ] && ok "commit: $HEAD_NOW == origin/$BRANCH" || bad "commit $HEAD_NOW != $TIP"

GIT_LS=$(git ls-files -- data/ 2>/dev/null | wc -l)
[ "$GIT_LS" -eq 0 ] && ok "data/ tidak dilacak Git" || bad "$GIT_LS file di data/ masih dilacak"

[ -f "data/mydrive.sqlite" ] && ok "database ada ($(du -h data/mydrive.sqlite | cut -f1))" || info "database belum ada"

NILAI=$(sed -n "s/^ *STORAGE_CONFIG_KEY: *'\(.*\)'.*/\1/p" ecosystem.config.cjs 2>/dev/null | head -1 || true)
if [ -z "$NILAI" ] || [ "$NILAI" = 'ganti-dengan-secret-acak-minimal-32-karakter' ]; then
  bad "STORAGE_CONFIG_KEY masih placeholder"
elif [ -n "$SECRET" ] && [ "$NILAI" != "$SECRET" ]; then
  bad "STORAGE_CONFIG_KEY berbeda dari .env"
else
  ok "STORAGE_CONFIG_KEY terisi dan cocok"
fi

JAWAB=$(curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/api/setup" 2>/dev/null || true)
[ -n "$JAWAB" ] && ok "/api/setup -> $JAWAB" || bad "aplikasi tidak merespons"

BARIS_PM2=$(pm2 status gutok-drive 2>/dev/null | grep 'gutok-drive' | head -1 || true)
echo "$BARIS_PM2" | grep -q 'online' && ok "PM2 online" || bad "PM2 tidak online"

LOG_PM2=$(pm2 logs gutok-drive --lines 50 --nostream 2>/dev/null || true)
if echo "$LOG_PM2" | grep -q 'aplikasi tetap berjalan'; then
  ok "guard crash loop aktif"
elif echo "$LOG_PM2" | grep -qiE 'eblocked|unhandledRejection'; then
  info "log memuat error provider — nonaktifkan Mega di Owner control"
else
  ok "log PM2 bersih"
fi

echo
[ "$GAGAL" -eq 0 ] && echo "== HASIL: BERHASIL. ==" || echo "== HASIL: ADA $GAGAL GAGAL. Tempel output ini. =="

echo
echo "Langkah lanjutan:"
echo "1. Ctrl+Shift+R (hard reload): ikon rename/move/delete harus muncul."
echo "2. Mega: nonaktifkan di Owner control atau isi kredensial baru."
echo "3. Revoke PAT lama di https://github.com/settings/tokens, buat baru (scope: repo)."
echo "4. Cek Cloudflare Worker lama."

exit "$GAGAL"