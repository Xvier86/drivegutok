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
  echo ">> Dikembalikan ke versi repo, secret disuntik ulang dari .env setelah pull."
  git checkout -- ecosystem.config.cjs
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  echo ">> Pindah branch $CURRENT_BRANCH -> $BRANCH"
  git checkout "$BRANCH"
fi

git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH"

if [ -n "$SECRET" ]; then
  sed -i "s#STORAGE_CONFIG_KEY: '.*'#STORAGE_CONFIG_KEY: '${SECRET}'#" ecosystem.config.cjs
else
  echo "!! STORAGE_CONFIG_KEY tidak ditemukan di .env maupun ecosystem.config.cjs."
  echo "!! Isi manual sebelum restart, kalau tidak config provider lama tidak bisa didekrip."
fi

echo ">> Kode sekarang di commit:"
git --no-pager log -1 --oneline
