#!/usr/bin/env bash
set -euo pipefail

# Tarik kode terbaru dari Git dengan aman.
# Dipakai oleh deploy.sh (VPS /var/www/gutok-drive) dan redeploy.sh (~/drivegutok).
#
# Kenapa tidak cukup "git pull": setup.sh menyuntik STORAGE_CONFIG_KEY asli ke
# ecosystem.config.cjs, padahal file itu dilacak Git. Modifikasi lokal itu bikin
# git pull ditolak ("Your local changes to the following files would be overwritten").
# Script ini menyimpan nilainya dulu (dari .env, cadangan dari file itu sendiri),
# melepas modifikasi lokalnya, pull, lalu menyuntik ulang nilai yang sama.
#
# Bisa diuji lokal: APP_DIR=/tmp/coba BRANCH=main bash update-code.sh
APP_DIR="${APP_DIR:-/var/www/gutok-drive}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"
mkdir -p data storage data/tmp

SECRET=""
if [ -f .env ]; then
  SECRET=$(grep '^STORAGE_CONFIG_KEY=' .env | head -1 | cut -d '=' -f2- || true)
fi
if [ -z "$SECRET" ] && [ -f ecosystem.config.cjs ]; then
  SECRET=$(sed -n "s/^ *STORAGE_CONFIG_KEY: *'\(.*\)'.*/\1/p" ecosystem.config.cjs | head -1 || true)
fi

if ! git diff --quiet -- ecosystem.config.cjs; then
  echo ">> ecosystem.config.cjs dimodifikasi lokal (secret dari setup.sh)."
  echo ">> Dikembalikan ke versi repo, secret disuntik ulang setelah pull."
  git checkout -- ecosystem.config.cjs
fi

# Rilis lama sempat ikut melacak file runtime SQLite (data/mydrive.sqlite, -shm, -wal). Selama
# masih dilacak, isinya berubah setiap aplikasi berjalan, sehingga `git merge --ff-only` selalu
# ditolak: "Your local changes to the following files would be overwritten by merge".
# Rilis terbaru berhenti melacaknya, tetapi perubahan itu berupa PENGHAPUSAN — kalau isi file
# dibiarkan apa adanya, merge gagal; kalau git yang menghapus, database produksi ikut lenyap.
# Jadi: isi aslinya disalin dulu, file di working tree dikembalikan ke versi repo (hanya supaya
# merge bisa jalan), lalu isi asli dipulihkan lagi oleh kembalikan_runtime() sebelum script
# selesai. Aplikasi wajib dalam keadaan berhenti (deploy.sh sudah mematikan PM2 lebih dulu).
RUNTIME_FILES=()
mapfile -t RUNTIME_FILES < <(git ls-files -- 'data/*.sqlite' 'data/*.sqlite-wal' 'data/*.sqlite-shm')
RUNTIME_SIMPAN=""
if [ "${#RUNTIME_FILES[@]}" -gt 0 ]; then
  RUNTIME_SIMPAN=$(mktemp -d)
  for berkas in "${RUNTIME_FILES[@]}"; do
    if [ -e "$berkas" ]; then
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
    fi
  done
fi

kembalikan_runtime() {
  if [ -z "$RUNTIME_SIMPAN" ]; then
    return 0
  fi
  gagal_pulih=0
  for berkas in "${RUNTIME_FILES[@]}"; do
    if [ -e "$RUNTIME_SIMPAN/$berkas" ] && { [ ! -e "$berkas" ] || ! cmp -s "$berkas" "$RUNTIME_SIMPAN/$berkas"; }; then
      if cp -p "$RUNTIME_SIMPAN/$berkas" "$berkas"; then
        echo ">> $berkas dipulihkan dari salinan sementara (merge ingin menghapusnya)."
      else
        echo "!! Gagal memulihkan $berkas; salinan aslinya masih ada di $RUNTIME_SIMPAN."
        gagal_pulih=1
      fi
    fi
  done
  if [ "$gagal_pulih" -eq 0 ]; then
    rm -rf "$RUNTIME_SIMPAN"
  fi
  return 0
}
trap kembalikan_runtime EXIT

suntik_secret() {
  if [ -z "$SECRET" ]; then
    return 0
  fi
  sed -i "s#STORAGE_CONFIG_KEY: '.*'#STORAGE_CONFIG_KEY: '${SECRET}'#" ecosystem.config.cjs
}

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  echo ">> Pindah branch $CURRENT_BRANCH -> $BRANCH"
  git checkout "$BRANCH"
fi

git fetch origin "$BRANCH"

declare -A UNTRACKED_SALIN=()

kembalikan_untracked() {
  for berkas in "${!UNTRACKED_SALIN[@]}"; do
    if [ -f "${UNTRACKED_SALIN[$berkas]}" ]; then
      cp -p "${UNTRACKED_SALIN[$berkas]}" "$berkas"
      rm -f "${UNTRACKED_SALIN[$berkas]}"
      echo ">> $berkas dipulihkan ke working tree."
    fi
  done
}

# Juga tangani file yang belum dilacak Git di working tree tapi sudah ada di commit
# tujuan (contoh: update-code.sh yang dulu ditambah setup.sh tapi belum pernah di-track).
# Tanpa ini, git merge --ff-only menolak:
#   "The following untracked working tree files would be overwritten by merge: update-code.sh"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -e "$f" ] && [ -z "$(git ls-files -- "$f")" ] || continue
  SALIN=$(mktemp)
  cp -p "$f" "$SALIN"
  UNTRACKED_SALIN["$f"]="$SALIN"
  rm -f "$f"
  echo ">> $f ada di working tree tapi belum dilacak: disisihkan sementara supaya merge bisa jalan."
done < <(git diff --name-only --diff-filter=A "HEAD..origin/$BRANCH" 2>/dev/null)

if ! git merge --ff-only "origin/$BRANCH"; then
  echo "!! git merge --ff-only gagal (biasanya karena ada commit lokal di VPS)."
  echo "!! Kode tidak diubah. Secret disuntik ulang supaya ecosystem.config.cjs tetap benar."
  suntik_secret
  kembalikan_untracked
  exit 1
fi

# File yang tadi disisihkan karena untracked sekarang sudah ada di repo (merge berhasil),
# jadi tidak perlu dipulihkan — biarkan versi repo yang baru.
for berkas in "${!UNTRACKED_SALIN[@]}"; do rm -f "${UNTRACKED_SALIN[$berkas]}"; done

# Merge menimpa ecosystem.config.cjs dengan versi repo (secret balik ke placeholder), suntik ulang.
suntik_secret

if [ -z "$SECRET" ]; then
  echo "!! STORAGE_CONFIG_KEY tidak ditemukan di .env maupun ecosystem.config.cjs."
  echo "!! Isi manual sebelum restart, kalau tidak config provider lama tidak bisa didekrip."
fi

echo ">> Kode sekarang di commit:"
git --no-pager log -1 --oneline
