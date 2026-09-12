# Bug fix log — Gutok Drive

1. **package.json**: dependency `"20": "^3.1.9"` bukan package asli, bikin `npm install`/`npm ci` gagal. Dihapus, diganti `engines.node: >=20`. `package-lock.json` sudah di-regenerate biar sinkron.
2. **assets/styles.css**: logo minta `/image/logo.jpg` yang gak pernah ada (file aslinya di root assets). Diganti `/logo.jpg` → logo tampil.
3. **ecosystem.config.cjs**: `STORAGE_CONFIG_KEY` dan `MAX_FILE_SIZE` gak ada di `env`. PM2 pakai env dari file ini secara eksklusif saat start/restart — kalau sebelumnya kamu jalanin `npm start` manual pakai secret custom lalu pindah ke PM2, key balik ke default dan **semua config provider yang udah terenkripsi jadi gak bisa didekrip lagi**. Sudah ditambahkan, WAJIB kamu isi manual dengan secret yang sama persis dengan yang dipakai saat setup pertama kali.
4. **.env.example**: `STORAGE_CONFIG_KEY` gak ada padahal README bilang wajib. Ditambahkan.
5. **server.js** (`getGoogleAccessToken`): ada jalur lama yang reuse token OAuth mentah dari config selamanya tanpa refresh. Token Google expired ~1 jam → upload Google Drive gagal berkala tanpa pesan jelas. Jalur ini dihapus, sekarang selalu generate token baru dari service account JSON (auto-refresh tiap request, sesuai desain awal).
6. **assets/app.js** (form "Tambah storage" → Google Drive): sebelumnya minta field "Google access token" yang gak pernah bisa diisi user secara valid dan gak dipakai validasi backend (backend butuh `serviceAccountJson`). Diganti jadi textarea Service Account JSON, jadi provider Google Drive bisa langsung dikonfigurasi sekali jalan (gak perlu buat lalu edit lagi).
7. **src/worker.js** (Cloudflare Worker target): `DELETE /api/files/:id` gak pernah decrement `providers.used_bytes`, jadi angka storage terpakai di dashboard owner cuma naik terus walau file dihapus. Sudah di-fix.

## Belum di-touch (bukan bug, tapi perlu keputusan produk — lihat PRD Open Questions)
- Limit ukuran file per provider (terutama Telegram bot API ~50MB) belum divalidasi sebelum upload — sekarang baru ketahuan gagal setelah request ke Telegram API.
- `src/worker.js` (Cloudflare) masih versi Fase 1 minimal: belum ada share link, folder delete, CDN slug, retention, enkripsi — semua itu cuma ada di `server.js` (VPS/Node target). Jangan campur dua target ini kecuali sudah migrasi schema.
