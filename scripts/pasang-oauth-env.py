#!/usr/bin/env python3
"""Tulis/pastikan blok GOOGLE_OAUTH_* di .env VPS tanpa menampilkan nilainya.

Dipakai sekali untuk mengaktifkan tombol "Tambah Google Drive" satu-klik (kredensial aplikasi OAuth
milik project sendiri). Nilai dibaca dari berkas token Google milik Hermes, ditulis langsung ke .env,
dan tidak pernah dicetak. Idempoten: baris lama diganti, bukan ditambahkan dua kali.
"""
import json
import pathlib
import sys

env_path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/var/www/gutok-drive/.env")
sumber = pathlib.Path("/tmp/dg-oauth-app.json")
if not sumber.exists():
    print("GAGAL: berkas sumber tidak ada"); sys.exit(1)
d = json.loads(sumber.read_text())
if not d.get("clientId") or not d.get("clientSecret"):
    print("GAGAL: kredensial tidak lengkap"); sys.exit(1)

kunci = {"GOOGLE_OAUTH_CLIENT_ID": d["clientId"], "GOOGLE_OAUTH_CLIENT_SECRET": d["clientSecret"]}
baris = env_path.read_text().splitlines() if env_path.exists() else []
ada = set()
hasil = []
for b in baris:
    nama = b.split("=", 1)[0].strip()
    if nama in kunci:
        hasil.append("%s=%s" % (nama, kunci[nama])); ada.add(nama)
    else:
        hasil.append(b)
for nama, nilai in kunci.items():
    if nama not in ada:
        hasil.append("%s=%s" % (nama, nilai))
env_path.write_text("\n".join(hasil).rstrip() + "\n")
print("ditulis ke %s: %s" % (env_path, ", ".join(sorted(kunci))))
print("baris GOOGLE_OAUTH_* sekarang:", sum(1 for b in env_path.read_text().splitlines() if b.startswith("GOOGLE_OAUTH_")))
