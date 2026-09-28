#!/usr/bin/env python3
"""Hitung rasio kontras WCAG untuk palet dua mode Gutok Drive.

Nilainya HARUS sama dengan assets/styles/tokens.css — berkas ini adalah pengecekan independen, jadi
kalau token diubah tanpa dihitung ulang, uji ini yang menangkapnya. Rasio tidak boleh diklaim dari
perasaan: dua kali sebelumnya angka kontras dari sumber lain salah (diklaim 11,2:1 padahal 14,79:1;
diklaim 3,2:1 padahal 1,80:1), jadi semuanya dihitung kode di sini.

Ambang: 4,5:1 untuk teks normal, 3:1 untuk elemen grafis/UI (WCAG 2.1 AA). Pemisahan antar permukaan
(sidebar vs kanvas) TIDAK punya ambang WCAG — angkanya dilaporkan sebagai informasi, bukan lulus/gagal.
"""
import sys

GELAP = {
    "ink": "#14110e", "ink-soft": "#1b1713", "panel": "#211c17", "panel-soft": "#2b251e",
    "line": "#4e4335", "line-soft": "#342c23", "paper": "#f4eee4", "muted": "#b5a793",
    "muted-strong": "#d2c5b3", "gold": "#e1b75b", "gold-bright": "#f3cf83", "gold-dark": "#8c7039",
    "gold-hover": "#f3cf83", "on-gold": "#14110e", "danger": "#f0917d",
    "amber-glow": "#f3cf83", "amber-unlit": "#33291a",
}
TERANG = {
    "ink": "#f7f2e8", "ink-soft": "#efe8da", "panel": "#fffdf7", "panel-soft": "#f4ede0",
    "line": "#d9ccb7", "line-soft": "#e8dfcf", "paper": "#241d15", "muted": "#6b5d4e",
    "muted-strong": "#4a3f34", "gold": "#8a6106", "gold-bright": "#6f4e05", "gold-dark": "#b8912f",
    "gold-hover": "#7a5505", "on-gold": "#fffdf7", "danger": "#a51f16",
    "amber-glow": "#8a6106", "amber-unlit": "#e3d8c4",
}

# (label, latar, depan, ambang) — ambang 4.5 = teks, 3.0 = grafis/UI
WAJIB = [
    ("teks utama di kartu", "panel", "paper", 4.5),
    ("teks utama di kanvas", "ink-soft", "paper", 4.5),
    ("teks redup di kartu", "panel", "muted", 4.5),
    ("teks redup di kanvas", "ink-soft", "muted", 4.5),
    ("teks tegas di kartu", "panel", "muted-strong", 4.5),
    ("aksen sebagai teks di kartu", "panel", "gold-bright", 4.5),
    ("aksen sebagai teks di kanvas", "ink-soft", "gold-bright", 4.5),
    ("teks di atas tombol emas", "gold", "on-gold", 4.5),
    ("teks di atas tombol emas (hover)", "gold-hover", "on-gold", 4.5),
    ("nada bahaya di kartu", "panel", "danger", 4.5),
    ("teks nav di sidebar", "ink", "muted", 4.5),
    ("judul/brand di sidebar", "ink", "paper", 4.5),
    ("teks di kanvas saat hover baris", "panel-soft", "paper", 4.5),
    ("busur penyimpanan di kartu (grafis)", "panel", "amber-glow", 3.0),
    # Garis pemisah: harus terlihat (>=1.2) tapi tidak boleh menyaingi isi.
    ("garis pemisah di kartu", "panel", "line", 1.2),
]
# Informasi saja: tidak ada ambang WCAG untuk beda dua permukaan yang berdampingan.
INFO = [
    ("sidebar vs kanvas", "ink", "ink-soft"),
    ("kartu vs kanvas", "panel", "ink-soft"),
    ("permukaan hover vs kartu", "panel-soft", "panel"),
    ("garis halus vs kartu", "line-soft", "panel"),
]


def _rgb(hex_warna):
    h = hex_warna.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _luminansi(hex_warna):
    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (_ for _ in map(f, _rgb(hex_warna)))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def kontras(a, b):
    la, lb = _luminansi(a), _luminansi(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


gagal = 0
for mode, palet in (("GELAP", GELAP), ("TERANG", TERANG)):
    print("=== MODE %s ===" % mode)
    for label, latar, depan, ambang in WAJIB:
        r = kontras(palet[latar], palet[depan])
        if r < ambang:
            gagal += 1
        print("  %s %-40s %5.2f:1  (min %.1f)" % ("OK  " if r >= ambang else "GAGAL", label, r, ambang))
    for label, latar, depan in INFO:
        print("  info %-40s %5.2f:1  (tanpa ambang)" % (label, kontras(palet[latar], palet[depan])))
    print()

print("RINGKASAN: %d pemeriksaan gagal" % gagal)
sys.exit(1 if gagal else 0)
