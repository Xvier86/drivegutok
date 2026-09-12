#!/usr/bin/env bash
# Sekali pakai: menyelesaikan deploy di VPS yang macet di rilis lama.
#
# Kenapa perlu: rilis lama ikut melacak data/mydrive.sqlite, -shm, dan -wal. Isinya berubah
# setiap aplikasi berjalan, jadi `git merge --ff-only` di update-code.sh selalu ditolak dan
# deploy berhenti (kode produksi tertinggal, fitur folder rename/hapus tidak muncul).
# Script ini menjalankan deploy.sh terbaru, lalu MEMBUKTIKAN hasilnya: commit naik, database
# tidak hilang (md5sum dibandingkan sebelum/sesudah), folder data/ tidak lagi dilacak Git,
# secret provider utuh, aplikasi merespons, dan PM2 tidak crash loop.
set -u

APP_DIR="${APP_DIR:-/var/www/gutok-drive}"
BRANCH="${BRANCH:-main}"
DIR_SCRIPT="$(cd "$(dirname "$0")" && pwd)"
LOG="/tmp/perbaiki-vps-$(date +%Y%m%d-%H%M%S).log"
GAGAL=0

ok()   { printf '  [OK]    %s\n' "$*"; }
bad()  { printf '  [GAGAL] %s\n' "$*"; GAGAL=$((GAGAL + 1)); }
info() { printf '  [info]  %s\n' "$*"; }

echo "== Perbaikan VPS Gutok Drive =="
echo "   APP_DIR    : $APP_DIR"
echo "   script     : $DIR_SCRIPT"
echo "   log deploy : $LOG"
echo

if [ ! -d "$APP_DIR/.git" ]; then
  echo "!! $APP_DIR bukan checkout Git. Periksa APP_DIR, script berhenti."
  exit 1
fi

# 0) Pastikan script ini versinya terbaru (best effort). Kalau file ini berubah setelah pull,
#    jalankan ulang supaya versi baru yang dipakai.
if [ -z "${SUDAH_PULL:-}" ] && git -C "$DIR_SCRIPT" rev-parse --git-dir >/dev/null 2>&1; then
  sebelum=$(md5sum "$0" | cut -d' ' -f1)
  if git -C "$DIR_SCRIPT" fetch -q origin "$BRANCH" 2>/dev/null && \
     git -C "$DIR_SCRIPT" merge --ff-only "origin/$BRANCH" >/dev/null 2>&1; then
    :
  else
    info "repo script tidak bisa di-ff-merge (aman, dipakai versi yang ada sekarang)."
  fi
  if [ "$sebelum" != "$(md5sum "$0" | cut -d' ' -f1)" ]; then
    echo ">> Versi baru script terdeteksi, dijalankan ulang dari awal..." && echo
    SUDAH_PULL=1 exec env SUDAH_PULL=1 APP_DIR="$APP_DIR" BRANCH="$BRANCH" bash "$0"
  fi
fi

cd "$APP_DIR" || exit 1

HEAD_SEBELUM=$(git rev-parse --short HEAD 2>/dev/null || echo '?')
MD5_DB_SEBELUM=$(md5sum data/mydrive.sqlite 2>/dev/null | cut -d' ' -f1)
SECRET=$(grep '^STORAGE_CONFIG_KEY=' .env 2>/dev/null | head -1 | cut -d'=' -f2- || true)
BACKUP_AWAL=$(ls -t gutok-drive-backup-*.tar.gz 2>/dev/null | head -1)
echo "Kondisi sebelum deploy:"
echo "   commit   : $HEAD_SEBELUM"
echo "   data/    : $(git ls-files -- data/ | wc -l) file dilacak Git, data/mydrive.sqlite md5=${MD5_DB_SEBELUM:-tidak-ada}"
echo "   backup   : ${BACKUP_AWAL:-belum ada}"
echo

# 1) Jalankan deploy (deploy.sh: backup -> stop PM2 -> update-code.sh -> npm ci -> start -> health check)
echo "-- Menjalankan deploy.sh (keluarannya disimpan ke $LOG) --"
bash "$DIR_SCRIPT/deploy.sh" >"$LOG" 2>&1
RC=$?
tail -n 5 "$LOG" | sed 's/^/   | /'
if [ "$RC" -eq 0 ]; then
  ok "deploy.sh selesai tanpa error"
else
  bad "deploy.sh gagal (exit $RC) — seluruh log ada di $LOG"
fi
echo
echo "-- Hasil verifikasi --"
HEAD_SESUDAH=$(git rev-parse --short HEAD 2>/dev/null || echo '?')
TIP=$(git -C "$DIR_SCRIPT" rev-parse --short "origin/$BRANCH" 2>/dev/null || echo '?')

if [ "$HEAD_SESUDAH" = "$TIP" ] && [ "$HEAD_SESUDAH" != "$HEAD_SEBELUM" ]; then
  ok "commit produksi naik: $HEAD_SEBELUM -> $HEAD_SESUDAH (sama dengan origin/$BRANCH)"
elif [ "$HEAD_SESUDAH" = "$TIP" ]; then
  ok "commit produksi sudah paling baru: $HEAD_SESUDAH"
else
  bad "commit produksi masih $HEAD_SESUDAH, seharusnya $TIP (kode belum masuk, lihat $LOG)"
fi

if [ "$(git ls-files -- data/ | wc -l)" -eq 0 ]; then
  ok "folder data/ tidak lagi dilacak Git (penyebab merge ditolak hilang untuk selamanya)"
else
  bad "masih ada $(git ls-files -- data/ | wc -l) file di data/ yang dilacak Git"
fi

MD5_DB_SESUDAH=$(md5sum data/mydrive.sqlite 2>/dev/null | cut -d' ' -f1)
if [ -z "$MD5_DB_SEBELUM" ] && [ -z "$MD5_DB_SESUDAH" ]; then
  info "data/mydrive.sqlite tidak ada sebelum & sesudah deploy (database baru dibuat saat start)."
elif [ "$MD5_DB_SEBELUM" = "$MD5_DB_SESUDAH" ]; then
  ok "database utuh: md5sum data/mydrive.sqlite sama sebelum & sesudah ($MD5_DB_SEBELUM)"
else
  bad "md5sum database BERUBAH ($MD5_DB_SEBELUM -> $MD5_DB_SESUDAH) — periksa $LOG dan backup"
fi
BACKUP_BARU=$(ls -t gutok-drive-backup-*.tar.gz 2>/dev/null | head -1 || true)
if [ -n "$BACKUP_BARU" ] && tar -tzf "$BACKUP_BARU" 2>/dev/null | grep -q '^data/'; then
  ok "backup rilis ini memuat folder data/: $BACKUP_BARU"
elif [ -n "$BACKUP_BARU" ]; then
  bad "backup $BACKUP_BARU tidak memuat data/ — jangan lanjut sebelum ada cadangan"
else
  info "belum ada file backup (dilewati kalau deploy berhenti sebelum tahap backup)."
fi

NILAI_ECOSYSTEM=$(sed -n "s/^ *STORAGE_CONFIG_KEY: *'\(.*\)'.*/\1/p" ecosystem.config.cjs 2>/dev/null | head -1 || true)
if [ -z "$NILAI_ECOSYSTEM" ] || [ "$NILAI_ECOSYSTEM" = 'ganti-dengan-secret-acak-panjang' ]; then
  bad "STORAGE_CONFIG_KEY di ecosystem.config.cjs masih placeholder/kosong — config provider lama tidak bisa didekrip"
elif [ -n "$SECRET" ] && [ "$NILAI_ECOSYSTEM" != "$SECRET" ]; then
  bad "STORAGE_CONFIG_KEY di ecosystem.config.cjs berbeda dengan yang ada di .env"
else
  ok "STORAGE_CONFIG_KEY di ecosystem.config.cjs terisi dan cocok dengan .env"
fi

JAWAB=$(curl -fsS --max-time 10 http://127.0.0.1:3000/api/setup 2>/dev/null || true)
if [ -n "$JAWAB" ]; then
  ok "aplikasi merespons: /api/setup -> $JAWAB"
else
  bad "aplikasi tidak merespons di http://127.0.0.1:3000/api/setup"
fi


BARIS_PM2=$(pm2 status gutok-drive 2>/dev/null | grep 'gutok-drive' | head -1 || true)
if echo "$BARIS_PM2" | grep -q 'online'; then
  ok "PM2 online: $(echo "$BARIS_PM2" | sed 's/  */ /g' | cut -c1-110)"
else
  bad "PM2 tidak melaporkan status online untuk gutok-drive (jalankan: pm2 status)"
fi

LOG_PM2=$(pm2 logs gutok-drive --lines 50 --nostream 2>/dev/null || true)
if echo "$LOG_PM2" | grep -q 'aplikasi tetap berjalan'; then
  ok "guard crash loop aktif (log memuat '[unhandledRejection] aplikasi tetap berjalan')"
elif echo "$LOG_PM2" | grep -qiE 'eblocked|unhandledRejection'; then
  info "log masih memuat error provider (EBLOCKED dll) TANPA guard: kode di VPS kemungkinan masih lama."
else
  ok "50 baris log PM2 terakhir bersih dari error provider"
fi
echo

if [ "$GAGAL" -eq 0 ]; then
  echo "== HASIL: BERHASIL. Deploy selesai dan semua pemeriksaan lolos. =="
else
  echo "== HASIL: ADA $GAGAL PEMERIKSAAN GAGAL. Tempelkan seluruh output ini (dan $LOG) untuk analisis. =="
fi
cat <<'CATATAN'

Langkah lanjutan yang butuh keputusanmu (tidak dijalankan otomatis):
1. Buka situsnya, tekan Ctrl+Shift+R (hard reload). Di folder harus muncul ikon ganti nama,
   pindah, dan hapus; halaman Owner control harus terbuka.
2. Provider Mega: kalau tidak dipakai, matikan di Owner control (dashboard langsung instan).
   Kalau dipakai, buka blokir di mega.nz atau isi kredensial baru, lalu simpan.
   Cek cepat: pm2 logs gutok-drive --lines 50 --nostream | grep -iE 'eblocked|unhandledRejection'
3. Token GitHub yang bocor (ghp_Mb63...) WAJIB di-revoke di https://github.com/settings/tokens,
   buat token baru (scope repo), lalu di VPS jalankan:
     git config --global credential.helper store
     printf 'https://USERNAME:TOKEN-BARU@github.com\n' > ~/.git-credentials && chmod 600 ~/.git-credentials
4. Cek apakah Cloudflare Worker lama masih hidup; kalau ya dan tidak dipakai, hapus.
CATATAN

exit "$GAGAL"

