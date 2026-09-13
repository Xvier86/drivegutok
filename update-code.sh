#!/usr/bin/env bash
set -euo pipefail

# Tarik kode terbaru dari Git tanpa merusak keadaan runtime di VPS.
# Dipakai oleh deploy.sh (/var/www/gutok-drive) dan redeploy.sh (~/drivegutok).
#
# "git pull" saja tidak cukup karena tiga hal:
#  1. setup.sh menyuntik STORAGE_CONFIG_KEY asli (dan PUBLIC_BASE_URL, kalau diisi di .env) ke
#     ecosystem.config.cjs yang dilacak Git, jadi pull ditolak: "Your local changes ... would be
#     overwritten by merge".
#  2. Rilis lama ikut melacak file runtime SQLite (data/mydrive.sqlite*) yang isinya berubah
#     setiap aplikasi berjalan, jadi merge selalu ditolak. Rilis baru menghapus file itu dari
#     Git, sehingga isinya harus disisihkan dulu supaya database produksi tidak ikut terhapus.
#  3. Ada file di working tree yang belum dilacak tapi sudah ada di commit tujuan
#     (mis. update-code.sh sisa setup lama) -> merge ditolak "untracked working tree files".
# Aplikasi wajib berhenti: deploy.sh/redeploy.sh sudah mematikan PM2 lebih dulu.
#
# Bisa diuji lokal: APP_DIR=/tmp/coba BRANCH=main bash update-code.sh
APP_DIR="${APP_DIR:-/var/www/gutok-drive}"
BRANCH="${BRANCH:-main}"
RUNTIME_POLA=('data/*.sqlite' 'data/*.sqlite-wal' 'data/*.sqlite-shm')

cd "$APP_DIR"
mkdir -p data storage data/tmp

# Nilai secret: dari .env, cadangan dari ecosystem.config.cjs yang sudah tersuntik.
SECRET=""
if [ -f .env ]; then
  SECRET=$(grep '^STORAGE_CONFIG_KEY=' .env | head -1 | cut -d '=' -f2- || true)
fi
if [ -z "$SECRET" ] && [ -f ecosystem.config.cjs ]; then
  SECRET=$(sed -n "s/^ *STORAGE_CONFIG_KEY: *'\(.*\)'.*/\1/p" ecosystem.config.cjs | head -1 || true)
fi

# PUBLIC_BASE_URL bukan rahasia, tapi nasibnya sama: nilainya ada di .env sedangkan file yang dibaca
# PM2 (ecosystem.config.cjs) dilacak Git, jadi setiap pull mengembalikannya ke placeholder. Tanpa
# suntikan ini redirect URI login Google kembali tersusun dari permintaan yang masuk dan berbunyi
# http:// padahal situs publiknya https:// — Google menolak URI yang tidak sama dengan yang
# didaftarkan.
PUBLIK=""
if [ -f .env ]; then
  PUBLIK=$(grep '^PUBLIC_BASE_URL=' .env | head -1 | cut -d '=' -f2- || true)
fi

suntik_secret() {
  if [ -n "$SECRET" ]; then
    sed -i "s#STORAGE_CONFIG_KEY: '.*'#STORAGE_CONFIG_KEY: '${SECRET}'#" ecosystem.config.cjs
  fi
  if [ -n "$PUBLIK" ] && [ -f ecosystem.config.cjs ]; then
    sed -i "s#PUBLIC_BASE_URL: '.*'#PUBLIC_BASE_URL: '${PUBLIK}'#" ecosystem.config.cjs
  fi
}

if ! git diff --quiet -- ecosystem.config.cjs; then
  echo ">> ecosystem.config.cjs dimodifikasi lokal (secret dari setup.sh)."
  echo ">> Dikembalikan ke versi repo, secret disuntik ulang setelah pull."
  git checkout -- ecosystem.config.cjs
fi

# File runtime SQLite yang masih dilacak rilis lama: isi aslinya disalin ke luar repo dulu,
# working tree dibuat versi repo (supaya merge bisa jalan / tidak ikut terhapus), lalu
# isinya dikembalikan oleh rapikan() saat script selesai — termasuk saat merge gagal.
RUNTIME_SIMPAN=$(mktemp -d)
RUNTIME_FILES=()
mapfile -t RUNTIME_FILES < <(git ls-files -- "${RUNTIME_POLA[@]}")

pulihkan_runtime() {
  for berkas in "${RUNTIME_FILES[@]}"; do
    if [ ! -e "$RUNTIME_SIMPAN/$berkas" ]; then
      continue
    fi
    if [ ! -e "$berkas" ] || ! cmp -s "$berkas" "$RUNTIME_SIMPAN/$berkas"; then
      if cp -p "$RUNTIME_SIMPAN/$berkas" "$berkas"; then
        echo ">> $berkas dipulihkan dari salinan sementara (merge ingin menghapusnya)."
      else
        echo "!! Gagal memulihkan $berkas; salinan aslinya masih ada di $RUNTIME_SIMPAN."
        return 0   # jangan buang folder salinan
      fi
    fi
  done
  rm -rf "$RUNTIME_SIMPAN"
}

for berkas in "${RUNTIME_FILES[@]}"; do
  if [ ! -e "$berkas" ]; then
    continue
  fi
  mkdir -p "$RUNTIME_SIMPAN/$(dirname "$berkas")"
  if ! cp -p "$berkas" "$RUNTIME_SIMPAN/$berkas"; then
    echo "!! Gagal menyisihkan $berkas. Deploy dibatalkan supaya database tidak hilang."
    exit 1
  fi
  git update-index --no-assume-unchanged "$berkas" 2>/dev/null || true
  git update-index --no-skip-worktree "$berkas" 2>/dev/null || true
  git checkout -- "$berkas" 2>/dev/null || true
  echo ">> $berkas masih dilacak rilis lama: isi aslinya disisihkan, file di working tree dibuat"
  echo ">>   versi repo supaya merge bisa jalan, lalu isinya dipulihkan lagi setelah merge."
done

declare -A UNTRACKED_SALIN=()
MERGE_BERHASIL=0

kembalikan_untracked() {
  for berkas in "${!UNTRACKED_SALIN[@]}"; do
    if [ -f "${UNTRACKED_SALIN[$berkas]}" ]; then
      cp -p "${UNTRACKED_SALIN[$berkas]}" "$berkas"
      rm -f "${UNTRACKED_SALIN[$berkas]}"
      echo ">> $berkas dipulihkan ke working tree."
    fi
  done
}

# Merge berhasil: file yang disisihkan sudah ada di repo, salinannya dibuang.
# Merge gagal: seluruh keadaan working tree dikembalikan seperti semula.
rapikan() {
  if [ "$MERGE_BERHASIL" -eq 1 ]; then
    for berkas in "${!UNTRACKED_SALIN[@]}"; do rm -f "${UNTRACKED_SALIN[$berkas]}"; done
  else
    kembalikan_untracked
  fi
  pulihkan_runtime
}
trap rapikan EXIT

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  echo ">> Pindah branch $CURRENT_BRANCH -> $BRANCH"
  git checkout "$BRANCH"
fi

git fetch origin "$BRANCH"

# File yang ada di working tree tapi belum dilacak Git dan sudah ada di commit tujuan:
# tanpa disisihkan, merge menolak dengan
# "The following untracked working tree files would be overwritten by merge".
while IFS= read -r berkas; do
  if [ -z "$berkas" ] || [ ! -e "$berkas" ] || [ -n "$(git ls-files -- "$berkas")" ]; then
    continue
  fi
  SALIN=$(mktemp)
  cp -p "$berkas" "$SALIN"
  UNTRACKED_SALIN["$berkas"]="$SALIN"
  rm -f "$berkas"
  echo ">> $berkas ada di working tree tapi belum dilacak: disisihkan sementara supaya merge bisa jalan."
done < <(git diff --name-only --diff-filter=A "HEAD..origin/$BRANCH" 2>/dev/null)

if ! git merge --ff-only "origin/$BRANCH"; then
  echo "!! git merge --ff-only gagal (biasanya karena ada commit lokal di VPS)."
  echo "!! Kode tidak diubah. Secret dan PUBLIC_BASE_URL disuntik ulang supaya ecosystem.config.cjs tetap benar."
  suntik_secret
  exit 1
fi
MERGE_BERHASIL=1

# File yang tadi disisihkan sekarang sudah ada di repo, jadi versi repo yang dipakai.
for berkas in "${!UNTRACKED_SALIN[@]}"; do rm -f "${UNTRACKED_SALIN[$berkas]}"; done
UNTRACKED_SALIN=()

# Merge menimpa ecosystem.config.cjs dengan versi repo (secret balik ke placeholder), suntik ulang.
suntik_secret

if [ -z "$SECRET" ]; then
  echo "!! STORAGE_CONFIG_KEY tidak ditemukan di .env maupun ecosystem.config.cjs."
  echo "!! Isi manual sebelum restart, kalau tidak config provider lama tidak bisa didekrip."
fi

echo ">> Kode sekarang di commit:"
git --no-pager log -1 --oneline
