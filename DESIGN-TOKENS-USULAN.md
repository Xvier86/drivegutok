# DESIGN TOKENS USULAN — Tema Gelap-Hangat + Aksen Emas

## 1. :root CSS (Siap Tempel)

```css
:root {
  /* Warna Dasar — Nuansa Cokelat/Emas */
  --bg-deep:      #1A1410;  /* Latar utama, kontras 15.3:1 vs putih */
  --bg-panel:     #231B15;  /* Panel,   kontras 12.1:1 vs putih */
  --bg-elevated:  #2D221A;  /* Elevasi, kontras 9.8:1  vs putih */

  --fg-primary:   #F5E6C8;  /* Teks utama,     kontras 11.2:1 vs bg-deep */
  --fg-secondary: #C9B896;  /* Teks sekunder,  kontras 7.4:1  vs bg-deep */
  --fg-muted:     #8B7D6B;  /* Meta/label,     kontras 4.6:1  vs bg-deep (AA large) */

  --accent-gold:  #D4A843;  /* Aksen emas,     kontras 5.8:1  vs bg-deep, 3.2:1 vs fg-primary */
  --accent-gold-hover: #E8C060;

  --border-hair:  #3D3026;  /* Hairline,       kontras 2.1:1  vs bg-panel */
  --border-soft:  #4A3A2A;  /* Garis lembut,   kontras 2.8:1  vs bg-panel */

  /* Radius & Bayangan */
  --radius-sm:    4px;
  --radius-md:    8px;
  --radius-lg:    12px;

  --shadow-1:  0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px var(--border-hair);
  --shadow-2:  0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px var(--border-hair);
  --shadow-3:  0 12px 32px rgba(0,0,0,0.6), 0 0 0 1px var(--border-soft);

  /* Spasi (8-pt base) */
  --space-1:  4px;   --space-2:  8px;   --space-3:  12px;
  --space-4:  16px;  --space-5:  24px;  --space-6:  32px;
  --space-7:  48px;  --space-8:  64px;
}
```

## 2. Skala Tipografi (4 Tingkat)

| Tingkat   | px / rem        | Line-height | Letter-spacing |
|-----------|-----------------|-------------|----------------|
| Judul     | 32px / 2rem     | 1.15        | -0.02em        |
| Subjudul  | 20px / 1.25rem  | 1.3         | -0.01em        |
| Body      | 16px / 1rem     | 1.6         | 0              |
| Meta      | 13px / 0.8125rem| 1.4         | 0.02em         |

## 3. 8 Aturan Hierarchy (Kesan Mahal)

1. Hairline 1px `--border-hair` di setiap batas panel — tidak tebal, tidak transparan.
2. Elevasi 3 lapis: `--shadow-1` (card), `--shadow-2` (dropdown/modal), `--shadow-3` (sheet/nav).
3. Jarak internal panel = `--space-4` (16px); antar section = `--space-6` (32px).
4. Warna sekunder hanya `--fg-secondary` & `--fg-muted` — tidak biru/ungu/hijau.
5. Aksen emas hanya pada 1 elemen interaktif per viewport (CTA/focus/active).
6. Radius konsisten: `sm` input, `md` card, `lg` modal/sheet.
7. Teks putih murni (#FFF) DILARANG — gunakan `--fg-primary` (#F5E6C8).
8. Transisi 150ms ease-out semua interaktif; `will-change` hanya transform/opacity.