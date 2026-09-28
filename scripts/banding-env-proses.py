#!/usr/bin/env python3
"""Bandingkan nilai env proses dengan nilai yang diharapkan, memakai sha256.

Nilai TIDAK PERNAH dicetak — hanya cocok/tidak cocok dan panjangnya. Dipakai untuk memastikan
kredensial yang benar-benar diterima proses adalah yang baru, bukan sisa yang lama (dua kredensial
Google bisa sama panjangnya, jadi panjang saja tidak cukup membedakan).
"""
import hashlib
import json
import sys
from pathlib import Path

pid = sys.argv[1]
harapan = json.loads(Path(sys.argv[2]).read_text())  # {"GOOGLE_OAUTH_CLIENT_ID": "...", ...}
raw = Path("/proc/%s/environ" % pid).read_bytes().decode("utf-8", "replace")
env = dict(item.split("=", 1) for item in raw.split("\0") if "=" in item)
for nama, nilai_harap in harapan.items():
    ada = env.get(nama, "")
    h_ada = hashlib.sha256(ada.encode()).hexdigest()[:12] if ada else "(kosong)"
    h_harap = hashlib.sha256(nilai_harap.encode()).hexdigest()[:12]
    print("%-26s len=%-4d %s" % (nama, len(ada), "COCOK dengan yang baru" if ada == nilai_harap else "BEDA (env %s vs baru %s)" % (h_ada, h_harap)))
