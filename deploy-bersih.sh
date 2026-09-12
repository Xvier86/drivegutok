#!/usr/bin/env bash
# Sekali pakai: deploy bersih dari nol di VPS.
# AMAN: database, .env, STORAGE_CONFIG_KEY disalin sebelum hapus. Backup gagal = batal.
# Bisa diuji lokal dengan remote palsu: REMOTE=/tmp/sumber APP_DIR=/tmp/app bash deploy-bersih.sh
set -u

APP_DIR="${APP_DIR:-/var/www/gutok-drive}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"
REMOTE="${REMOTE:-https://github.com/Xvier86/drivegutok.git}"
PLACEHOLDER='ganti-dengan-secret-acak-minimal-32-karakter'
GAGAL=0
TMP=""
TAR=""

ok()   { printf '  [OK]    %s\n' "$*"; }
bad()  { printf '  [GAGAL] %s\n' "$*"; GAGAL=$((GAGAL + 1)); }
info() { printf '  [info]  %s\n' "$*"; }
berhenti() { echo "   Backup ada di $TMP dan $TAR"; exit 1; }

bersihkan() { if [ -n "$TMP" ]; then rm -rf "$TMP"; fi; }
trap bersihkan EXIT

echo "== Deploy Bersih Gutok Drive =="
echo "   APP_DIR : $APP_DIR"
echo "   remote  : $REMOTE ($BRANCH)"
echo

echo "-- [0/5] Backup data penting ke /tmp --"
TMP=$(mktemp -d)

if [ -d "$APP_DIR/data" ]; then
  mkdir -p "$TMP/data"
  if ! cp -rp "$APP_DIR/data" "$TMP/"; then
    bad "Gagal menyalin data/"
    berhenti
  fi
  echo "   data/ disalin: $(find "$TMP/data" -type f | wc -l) file"
fi
if [ -f "$APP_DIR/.env" ]; then
  if ! cp -p "$APP_DIR/.env" "$TMP/.env"; then
    bad "Gagal menyalin .env"
    berhenti
  fi
  echo "   .env disalin"
fi

# Secret harus dibaca SEBELUM folder lama dihapus; ini kunci dekripsi config provider.
SECRET=""
if [ -f "$APP_DIR/.env" ]; then
  SECRET=$(grep '^STORAGE_CONFIG_KEY=' "$APP_DIR/.env" | head -1 | cut -d'=' -f2- || true)
fi
if [ -z "$SECRET" ] && [ -f "$APP_DIR/ecosystem.config.cjs" ]; then
  SECRET=$(sed -n "s/^ *STORAGE_CONFIG_KEY: *'\(.*\)'.*/\1/p" "$APP_DIR/ecosystem.config.cjs" | head -1 || true)
fi
if [ -n "$SECRET" ]; then
  echo "   STORAGE_CONFIG_KEY tersimpan ($(printf '%s' "$SECRET" | wc -c) karakter)"
else
  info "STORAGE_CONFIG_KEY tidak ditemukan."
fi

TAR="/tmp/gutok-drive-backup-bersih-$(date +%F-%H%M).tar.gz"
if tar -czf "$TAR" -C "$TMP" . 2>/dev/null; then
  echo "   tarball: $TAR"
else
  info "tarball gagal"
fi
echo

echo "-- [1/5] Matikan aplikasi --"
pm2 stop gutok-drive 2>/dev/null || true
sleep 2
echo

echo "-- [2/5] Hapus $APP_DIR dan clone fresh --"
rm -rf "$APP_DIR"
if [ -d "$APP_DIR" ]; then
  bad "Gagal menghapus $APP_DIR"
  berhenti
fi
git clone --branch "$BRANCH" --single-branch "$REMOTE" "$APP_DIR" 2>&1 | sed 's/^/   | /'
if [ ! -d "$APP_DIR/.git" ]; then
  bad "Clone gagal"
  berhenti
fi
cd "$APP_DIR" || exit 1
echo "   commit: $(git rev-parse --short HEAD)"
echo

echo "-- [3/5] Restore data, .env, dan secret --"
mkdir -p data storage data/tmp
if [ -d "$TMP/data" ]; then
  cp -rp "$TMP/data/." data/ || bad "Gagal me-restore data/!"
  echo "   data/ direstore: $(find data -type f | wc -l) file"
fi
if [ -f "$TMP/.env" ]; then
  cp -p "$TMP/.env" .env
  echo "   .env direstore"
elif [ -n "$SECRET" ]; then
  printf 'STORAGE_CONFIG_KEY=%s\n' "$SECRET" > .env
  echo "   .env dibuat dari secret"
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
    HEALTHY=1
    break
  fi
  sleep 1
done
if [ "$HEALTHY" -eq 1 ]; then
  echo "   >> Aplikasi merespons"
else
  bad "Aplikasi belum merespons setelah 20 detik"
fi
echo

echo "-- [5/5] Verifikasi --"
HEAD_NOW=$(git rev-parse --short HEAD)
TIP=$(git rev-parse --short "origin/$BRANCH" 2>/dev/null || echo '?')
if [ "$HEAD_NOW" = "$TIP" ]; then
  ok "commit: $HEAD_NOW == origin/$BRANCH"
else
  bad "commit $HEAD_NOW != $TIP"
fi

GIT_LS=$(git ls-files -- data/ 2>/dev/null | wc -l)
if [ "$GIT_LS" -eq 0 ]; then
  ok "data/ tidak dilacak Git"
else
  bad "$GIT_LS file di data/ masih dilacak"
fi

if [ -f "data/mydrive.sqlite" ]; then
  ok "database ada ($(du -h data/mydrive.sqlite | cut -f1))"
else
  info "database belum ada"
fi

NILAI=$(sed -n "s/^ *STORAGE_CONFIG_KEY: *'\(.*\)'.*/\1/p" ecosystem.config.cjs 2>/dev/null | head -1 || true)
if [ -z "$NILAI" ] || [ "$NILAI" = "$PLACEHOLDER" ]; then
  bad "STORAGE_CONFIG_KEY masih placeholder"
elif [ -n "$SECRET" ] && [ "$NILAI" != "$SECRET" ]; then
  bad "STORAGE_CONFIG_KEY berbeda dari .env"
else
  ok "STORAGE_CONFIG_KEY terisi dan cocok"
fi

JAWAB=$(curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/api/setup" 2>/dev/null || true)
if [ -n "$JAWAB" ]; then
  ok "/api/setup -> $JAWAB"
else
  bad "aplikasi tidak merespons"
fi

BARIS_PM2=$(pm2 status gutok-drive 2>/dev/null | grep 'gutok-drive' | head -1 || true)
if echo "$BARIS_PM2" | grep -q 'online'; then
  ok "PM2 online"
else
  bad "PM2 tidak online"
fi

LOG_PM2=$(pm2 logs gutok-drive --lines 50 --nostream 2>/dev/null || true)
if echo "$LOG_PM2" | grep -q 'aplikasi tetap berjalan'; then
  ok "guard crash loop aktif"
elif echo "$LOG_PM2" | grep -qiE 'eblocked|unhandledRejection'; then
  info "log memuat error provider — nonaktifkan Mega di Owner control"
else
  ok "log PM2 bersih"
fi

echo
if [ "$GAGAL" -eq 0 ]; then
  echo "== HASIL: BERHASIL. =="
else
  echo "== HASIL: ADA $GAGAL GAGAL. Tempel output ini. =="
fi

echo
echo "Langkah lanjutan:"
echo "1. Ctrl+Shift+R (hard reload): ikon rename/move/delete harus muncul."
echo "2. Mega: nonaktifkan di Owner control atau isi kredensial baru."
echo "3. Revoke PAT lama di https://github.com/settings/tokens, buat baru (scope: repo)."
echo "4. Cek Cloudflare Worker lama."

exit "$GAGAL"
