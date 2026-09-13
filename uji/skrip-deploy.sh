#!/usr/bin/env bash
# Uji script deploy Gutok Drive di VPS palsu.
# Pindah ke uji/ bersama uji yang lain, jadi DIR_SCRIPT diisi AKAR repo (tempat *.sh deploy).
# Pemakaian: bash uji/skrip-deploy.sh AKAR_REPO [tag]     (env: LEWATI=bersih,setup untuk melewati kasus)
#
# VPS palsu: pm2 / npm / curl / sudo diganti stub (semua panggilan dicatat ke panggilan.log),
# fixture = clone repo ini di commit 0d80ab8 (rilis lama yang masih melacak
# data/mydrive.sqlite, -shm, -wal), lalu isi database ditimpa data "produksi" yang HARUS
# selamat sampai selesai. Semua pemeriksaan dicetak [OK]/[GAGAL].
set -u

DIR_SCRIPT_INPUT="${1:?pakai: bash uji/skrip-deploy.sh AKAR_REPO [tag]}"
TAG_SEMUA="${2:-tanpa-tag}"
REPO="${REPO:-/home/vier/drivegutok}"
FIXTURE_COMMIT="${FIXTURE_COMMIT:-0d80ab8}"
BRANCH="${BRANCH:-main}"
LEWATI="${LEWATI:-}"
LULUS=0
GAGAL=0
DIR_HAPUS=()
KERJA=""

ok()  { LULUS=$((LULUS + 1)); printf '  [OK]    %s\n' "$*"; }
bad() { GAGAL=$((GAGAL + 1)); printf '  [GAGAL] %s\n' "$*"; }
cek_sama() { if [ "$2" = "$3" ]; then ok "$1 = $2"; else bad "$1: dapat '$2', harusnya '$3'"; fi; }
cek_ada() { if [ -n "$3" ] && grep -qF -- "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1 (tidak ditemukan di $3)"; fi; }
cek_tidak_ada() { if [ -n "$3" ] && grep -qF -- "$2" "$3" 2>/dev/null; then bad "$1 (masih ada di $3)"; else ok "$1"; fi; }
header() { printf '\n== [%s] %s ==\n' "$TAG_SEMUA" "$1"; }
dilewati() { case ",$LEWATI," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

bersihkan() { for d in "${DIR_HAPUS[@]:-}"; do if [ -n "$d" ]; then rm -rf "$d"; fi; done; }
trap bersihkan EXIT

# --- VPS palsu ---------------------------------------------------------------
siapkan_bin() {
  BIN="$KERJA/bin"
  mkdir -p "$BIN"
  LOG_UJI="$KERJA/panggilan.log"
  : > "$LOG_UJI"
  cat > "$BIN/pm2" <<'SH'
#!/usr/bin/env bash
echo "pm2 $*" >> "$LOG_UJI"
case "${1:-}" in
  status) echo "gutok-drive  online  0s  0  fork  online" ;;
  logs)   echo "[unhandledRejection] aplikasi tetap berjalan" ;;
esac
exit 0
SH
  cat > "$BIN/npm" <<'SH'
#!/usr/bin/env bash
echo "npm $*" >> "$LOG_UJI"
exit 0
SH
  cat > "$BIN/curl" <<'SH'
#!/usr/bin/env bash
echo "curl $*" >> "$LOG_UJI"
if [ "${CURL_OK:-1}" = "1" ]; then
  printf '{"needsSetup":false}\n'
  exit 0
fi
exit 22
SH
  cat > "$BIN/sudo" <<'SH'
#!/usr/bin/env bash
echo "sudo $*" >> "$LOG_UJI"
exec "$@"
SH
  chmod +x "$BIN/pm2" "$BIN/npm" "$BIN/curl" "$BIN/sudo"
  export LOG_UJI
}

buat_kasus() {
  KERJA=$(mktemp -d)
  DIR_HAPUS+=("$KERJA")
  siapkan_bin
}

siapkan_remote() {
  if [ -z "${SUMBER:-}" ]; then
    SUMBER="$(mktemp -d)/remote"
    DIR_HAPUS+=("$(dirname "$SUMBER")")
    git clone -q --no-hardlinks "$REPO" "$SUMBER"
    git -C "$SUMBER" checkout -q "$BRANCH"
  fi
}

# APP_DIR kondisi VPS: rilis lama, database sudah berisi data produksi, secret di .env,
# update-code.sh ada di working tree tapi belum dilacak, ecosystem.config.cjs masih placeholder.
app_persiapan() {
  APP="$KERJA/app"
  git clone -q --no-hardlinks "$SUMBER" "$APP"
  # VPS asli selalu berada DI branch main (bukan detached), cuma tertinggal di commit lama.
  git -C "$APP" checkout -q -B "$BRANCH" "$FIXTURE_COMMIT"
  git -C "$APP" remote set-url origin "$SUMBER"
  git -C "$APP" fetch -q origin "$BRANCH"
  printf 'BARIS-DB-PRODUKSI\n' >> "$APP/data/mydrive.sqlite"
  printf 'BARIS-WAL-PRODUKSI\n' >> "$APP/data/mydrive.sqlite-wal"
  printf 'BARIS-SHM-PRODUKSI\n' >> "$APP/data/mydrive.sqlite-shm"
  MD5_DB=$(md5sum "$APP/data/mydrive.sqlite" | cut -d' ' -f1)
  MD5_WAL=$(md5sum "$APP/data/mydrive.sqlite-wal" | cut -d' ' -f1)
  MD5_SHM=$(md5sum "$APP/data/mydrive.sqlite-shm" | cut -d' ' -f1)
  printf 'STORAGE_CONFIG_KEY=SECRET-ASLI-UJI-1234567890\n' > "$APP/.env"
  printf '#!/usr/bin/env bash\necho versi-lama-sisa-setup\n' > "$APP/update-code.sh"
  mkdir -p "$APP/storage" "$APP/data/tmp"
  git -C "$APP" show "origin/$BRANCH:ecosystem.config.cjs" > "$APP/ecosystem.config.cjs"
  cp "$DIR_SCRIPT_INPUT"/*.sh "$APP/"
  md5_script="$DIR_SCRIPT_INPUT/update-code.sh"
}

md5_berkas() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }

# DIR_SCRIPT = checkout repo terpisah (seperti ~/drivegutok di VPS) supaya perbaiki-vps.sh
# bisa menghitung origin/$BRANCH.
siapkan_dir_script() {
  DS="$KERJA/dir-script"
  git clone -q --no-hardlinks "$SUMBER" "$DS"
  cp "$DIR_SCRIPT_INPUT"/*.sh "$DS/"
}

kasus_redeploy() {
  header "redeploy.sh: jalur normal"
  buat_kasus
  siapkan_remote
  app_persiapan
  PATH="$BIN:$PATH" CURL_OK=1 APP_DIR="$APP" BRANCH="$BRANCH" PORT=3000 bash "$DIR_SCRIPT_INPUT/redeploy.sh" >"$KERJA/out.log" 2>&1
  cek_sama "exit" "$?" "0"
  cek_sama "commit app == tip" "$(git -C "$APP" rev-parse --short HEAD)" "$(git -C "$SUMBER" rev-parse --short HEAD)"
  cek_sama "md5 DB produksi utuh" "$(md5_berkas "$APP/data/mydrive.sqlite")" "$MD5_DB"
  cek_ada "log: redeploy selesai" "Redeploy selesai" "$KERJA/out.log"
}

kasus_perbaiki() {
  header "perbaiki-vps.sh: deploy + verifikasi lengkap"
  buat_kasus
  siapkan_remote
  app_persiapan
  siapkan_dir_script
  PATH="$BIN:$PATH" CURL_OK=1 APP_DIR="$APP" BRANCH="$BRANCH" PORT=3000 bash "$DS/perbaiki-vps.sh" >"$KERJA/out.log" 2>&1
  cek_sama "exit" "$?" "0"
  cek_tidak_ada "tidak ada pemeriksaan [GAGAL]" "[GAGAL]" "$KERJA/out.log"
  cek_ada "deploy.sh selesai tanpa error" "deploy.sh selesai tanpa error" "$KERJA/out.log"
  cek_ada "commit naik ke tip" "commit produksi naik" "$KERJA/out.log"
  cek_ada "database utuh" "database utuh" "$KERJA/out.log"
  cek_ada "backup memuat data/" "backup rilis ini memuat folder data/" "$KERJA/out.log"
  cek_ada "secret terisi dan cocok" "terisi dan cocok dengan .env" "$KERJA/out.log"
  cek_ada "PM2 online" "PM2 online" "$KERJA/out.log"
  cek_sama "commit app == tip" "$(git -C "$APP" rev-parse --short HEAD)" "$(git -C "$SUMBER" rev-parse --short HEAD)"
  cek_sama "md5 DB produksi utuh" "$(md5_berkas "$APP/data/mydrive.sqlite")" "$MD5_DB"
}

kasus_bersih() {
  header "deploy-bersih.sh: hapus & clone fresh, data/secret kembali"
  buat_kasus
  siapkan_remote
  app_persiapan
  PATH="$BIN:$PATH" CURL_OK=1 APP_DIR="$APP" BRANCH="$BRANCH" PORT=3000 REMOTE="$SUMBER" \
    bash "$DIR_SCRIPT_INPUT/deploy-bersih.sh" >"$KERJA/out.log" 2>&1
  cek_sama "exit" "$?" "0"
  cek_tidak_ada "tidak ada [GAGAL]" "[GAGAL]" "$KERJA/out.log"
  cek_sama "commit app == tip" "$(git -C "$APP" rev-parse --short HEAD)" "$(git -C "$SUMBER" rev-parse --short HEAD)"
  cek_sama "md5 DB produksi utuh" "$(md5_berkas "$APP/data/mydrive.sqlite")" "$MD5_DB"
  cek_sama "data/ tidak dilacak Git" "$(git -C "$APP" ls-files -- data/ | wc -l)" "0"
  cek_sama "secret disuntik ke ecosystem.config.cjs" "$(sed -n "s/^ *STORAGE_CONFIG_KEY: *'\(.*\)'.*/\1/p" "$APP/ecosystem.config.cjs" | head -1)" "SECRET-ASLI-UJI-1234567890"
  cek_ada "log: .env direstore" ".env direstore" "$KERJA/out.log"
  cek_ada "log: PM2 online" "PM2 online" "$KERJA/out.log"
}

kasus_setup() {
  header "setup.sh: VPS kosong -> clone, .env, secret, pm2 start"
  buat_kasus
  siapkan_remote
  APP_BARU="$KERJA/app-baru"
  PATH="$BIN:$PATH" APP_DIR="$APP_BARU" REPO_URL="$SUMBER" BRANCH="$BRANCH" PORT=3000 \
    bash "$DIR_SCRIPT_INPUT/setup.sh" >"$KERJA/out.log" 2>&1
  cek_sama "exit" "$?" "0"
  if [ -d "$APP_BARU/.git" ]; then ok "repo ter-clone"; else bad "repo tidak ter-clone"; fi
  if [ -f "$APP_BARU/.env" ]; then ok ".env dibuat"; else bad ".env tidak ada"; fi
  SECRET_ENV=$(grep '^STORAGE_CONFIG_KEY=' "$APP_BARU/.env" 2>/dev/null | cut -d'=' -f2-)
  SECRET_ECO=$(sed -n "s/^ *STORAGE_CONFIG_KEY: *'\(.*\)'.*/\1/p" "$APP_BARU/ecosystem.config.cjs" 2>/dev/null | head -1)
  if [ -n "$SECRET_ENV" ] && [ "$SECRET_ENV" != "ganti-dengan-secret-acak-minimal-32-karakter" ]; then
    ok "secret .env terisi (${#SECRET_ENV} karakter)"
  else
    bad "secret .env kosong/masih placeholder"
  fi
  cek_sama "secret ecosystem == secret .env" "$SECRET_ECO" "$SECRET_ENV"
  cek_ada "pm2 start dijalankan" "pm2 start ecosystem.config.cjs" "$LOG_UJI"
  cek_ada "mkdir lewat sudo dijalankan" "sudo mkdir -p" "$LOG_UJI"
}

jalankan_kasus() {
  local label="$1" fungsi="$2"
  if dilewati "$label"; then
    printf '\n== [%s] (dilewati) %s ==\n' "$TAG_SEMUA" "$label"
    return 0
  fi
  "$fungsi"
}



# --- Kasus -------------------------------------------------------------------
kasus_update_code() {
  header "update-code.sh: DB lama masih dilacak + update-code.sh untracked"
  buat_kasus
  siapkan_remote
  app_persiapan
  PATH="$BIN:$PATH" APP_DIR="$APP" BRANCH="$BRANCH" bash "$APP/update-code.sh" >"$KERJA/out.log" 2>&1
  cek_sama "exit" "$?" "0"
  cek_sama "commit app == tip" "$(git -C "$APP" rev-parse --short HEAD)" "$(git -C "$SUMBER" rev-parse --short HEAD)"
  cek_sama "md5 DB produksi utuh" "$(md5_berkas "$APP/data/mydrive.sqlite")" "$MD5_DB"
  cek_sama "md5 -wal utuh" "$(md5_berkas "$APP/data/mydrive.sqlite-wal")" "$MD5_WAL"
  cek_sama "md5 -shm utuh" "$(md5_berkas "$APP/data/mydrive.sqlite-shm")" "$MD5_SHM"
  cek_sama "data/ tidak lagi dilacak" "$(git -C "$APP" ls-files -- data/ | wc -l)" "0"
  cek_sama "update-code.sh kini versi repo" "$(md5_berkas "$APP/update-code.sh")" "$(git -C "$APP" show "origin/$BRANCH:update-code.sh" | md5sum | cut -d' ' -f1)"
  cek_sama "secret disuntik ke ecosystem.config.cjs" "$(sed -n "s/^ *STORAGE_CONFIG_KEY: *'\(.*\)'.*/\1/p" "$APP/ecosystem.config.cjs" | head -1)" "SECRET-ASLI-UJI-1234567890"
  cek_sama "satu-satunya perubahan tracked: ecosystem.config.cjs (secret)" "$(git -C "$APP" status --porcelain --untracked-files=no | tr -d ' ')" "Mecosystem.config.cjs"
}

kasus_deploy() {
  header "deploy.sh: jalur normal sampai tip"
  buat_kasus
  siapkan_remote
  app_persiapan
  PATH="$BIN:$PATH" CURL_OK=1 APP_DIR="$APP" BRANCH="$BRANCH" PORT=3000 bash "$DIR_SCRIPT_INPUT/deploy.sh" >"$KERJA/out.log" 2>&1
  cek_sama "exit" "$?" "0"
  cek_sama "commit app == tip" "$(git -C "$APP" rev-parse --short HEAD)" "$(git -C "$SUMBER" rev-parse --short HEAD)"
  cek_sama "md5 DB produksi utuh" "$(md5_berkas "$APP/data/mydrive.sqlite")" "$MD5_DB"
  cek_sama "data/ tidak lagi dilacak" "$(git -C "$APP" ls-files -- data/ | wc -l)" "0"
  cek_ada "log: backup dibuat" "Backup dibuat" "$KERJA/out.log"
  cek_ada "log: deploy selesai" "Deploy selesai" "$KERJA/out.log"
  bak=$(ls "$APP"/gutok-drive-backup-*.tar.gz 2>/dev/null | head -1)
  if [ -n "$bak" ] && tar -tzf "$bak" 2>/dev/null | grep -q '^data/mydrive.sqlite'; then
    ok "backup memuat data/mydrive.sqlite"
  else
    bad "backup tidak memuat data/mydrive.sqlite"
  fi
  cek_sama "npm ci dijalankan" "$(grep -c 'npm ci --omit=dev' "$LOG_UJI")" "1"
  cek_ada "pm2 dinyalakan ulang" "pm2 restart ecosystem.config.cjs" "$LOG_UJI"
}

kasus_deploy_merge_gagal() {
  header "deploy.sh: ada commit lokal di VPS -> merge gagal, situs dinyalakan ulang"
  buat_kasus
  siapkan_remote
  app_persiapan
  printf 'catatan lokal\n' >> "$APP/README.md"
  git -C "$APP" -c user.email=uji@contoh -c user.name=uji commit -qam 'commit lokal di VPS'
  HEAD_LOKAL=$(git -C "$APP" rev-parse --short HEAD)
  PATH="$BIN:$PATH" CURL_OK=1 APP_DIR="$APP" BRANCH="$BRANCH" PORT=3000 bash "$DIR_SCRIPT_INPUT/deploy.sh" >"$KERJA/out.log" 2>&1
  RC=$?
  if [ "$RC" -ne 0 ]; then ok "exit tidak nol ($RC)"; else bad "exit 0 padahal merge harus gagal"; fi
  cek_sama "commit app tidak berubah" "$(git -C "$APP" rev-parse --short HEAD)" "$HEAD_LOKAL"
  cek_sama "md5 DB produksi utuh" "$(md5_berkas "$APP/data/mydrive.sqlite")" "$MD5_DB"
  cek_ada "log deploy: gagal dan dinyalakan ulang" "Menyalakan ulang aplikasi" "$KERJA/out.log"
  cek_ada "update-code.sh: merge ditolak" "merge --ff-only gagal" "$KERJA/out.log"
  cek_ada "pm2 restart dijalankan" "pm2 restart ecosystem.config.cjs" "$LOG_UJI"
}

kasus_deploy_tak_respond() {
  header "deploy.sh: aplikasi tidak merespons -> exit non-nol"
  buat_kasus
  siapkan_remote
  app_persiapan
  PATH="$BIN:$PATH" CURL_OK=0 APP_DIR="$APP" BRANCH="$BRANCH" PORT=3000 bash "$DIR_SCRIPT_INPUT/deploy.sh" >"$KERJA/out.log" 2>&1
  RC=$?
  if [ "$RC" -ne 0 ]; then ok "exit tidak nol ($RC)"; else bad "exit 0 padahal aplikasi tidak merespons"; fi
  cek_ada "log: aplikasi belum merespons" "belum merespons" "$KERJA/out.log"
  cek_sama "commit tetap naik ke tip" "$(git -C "$APP" rev-parse --short HEAD)" "$(git -C "$SUMBER" rev-parse --short HEAD)"
  cek_sama "md5 DB produksi utuh" "$(md5_berkas "$APP/data/mydrive.sqlite")" "$MD5_DB"
}

# --- Jalankan semua kasus ----------------------------------------------------
printf '### Harness script deploy Gutok Drive — tag=%s, DIR_SCRIPT=%s, fixture=%s\n' \
  "$TAG_SEMUA" "$DIR_SCRIPT_INPUT" "$FIXTURE_COMMIT"
jalankan_kasus update-code "kasus_update_code"
jalankan_kasus deploy "kasus_deploy"
jalankan_kasus merge-gagal "kasus_deploy_merge_gagal"
jalankan_kasus tak-respond "kasus_deploy_tak_respond"
jalankan_kasus redeploy "kasus_redeploy"
jalankan_kasus perbaiki "kasus_perbaiki"
jalankan_kasus bersih "kasus_bersih"
jalankan_kasus setup "kasus_setup"

printf '\n### [%s] RINGKASAN: %d lolos, %d gagal\n' "$TAG_SEMUA" "$LULUS" "$GAGAL"
[ "$GAGAL" -eq 0 ]
