# PRD — Multi-Provider Cloud Storage Web App

## 1. Overview
Website penyimpanan file mirip Google Drive, dengan backend storage multi-provider (Telegram Channel, Mega Drive, Google Drive, dll) yang bisa dikelola dari dashboard owner. Autentikasi berbasis email/username terdaftar, pendaftaran akun tertutup (invite/approve manual oleh owner).

## 2. Goals
- Satu web app sebagai frontend, banyak backend storage sebagai "wadah" penyimpanan aktual.
- Owner punya kontrol penuh atas provider, kuota, dan user.
- User biasa cukup upload, kelola folder, share, dan preview file tanpa tahu file-nya fisik disimpan di provider mana.

## 3. Tech Stack
- **Hosting/Backend**: Cloudflare Workers
- **Database**: Cloudflare D1 (metadata user, file, folder, session, share link)
- **Cache/Session**: Cloudflare KV
- **Deploy**: Cloudflare Dashboard direct upload (no Wrangler CLI)

## 4. User Roles

| Role | Akses |
|---|---|
| Owner | Full access: kelola user, kelola provider (on/off), lihat kapasitas semua provider, override quota, hapus/lihat semua file |
| User | Login, kelola file/folder milik sendiri, upload, share link, preview |

## 5. Auth & Registrasi
- Login pakai email/username + password.
- **Tidak ada self-register.** Owner yang invite/approve akun baru (generate akun atau approve request).
- Session disimpan di KV, token JWT atau session ID di cookie httpOnly.

## 6. Storage Provider (Multi-Backend)
- Provider yang didukung awal: **Telegram Channel, Mega Drive, Google Drive** (arsitektur harus extensible untuk provider baru).
- Dashboard owner:
  - Toggle on/off tiap provider.
  - Lihat total kapasitas & kapasitas terpakai per provider (real-time atau cache berkala).
- **Kuota user**: mengikuti sisa kapasitas provider yang aktif/terhubung — bukan kuota fix per user. Kalau provider penuh/off, upload ke provider itu ditolak, sistem fallback ke provider lain yang aktif (perlu keputusan lanjut: auto-select provider mana saat upload — lihat Open Question #1).
- Tiap file di DB (D1) menyimpan: `provider`, `remote_file_id`, `size`, `owner_id`, `folder_id`, `uploaded_by`, `uploaded_at`.
- `uploaded_by` selalu diisi dari session user yang aktif saat upload — dipakai buat audit trail dan ditampilkan di UI (misal badge "diupload oleh X" di file detail/list, kelihatan terutama kalau owner share akses ke banyak user).

## 7. Folder & File Management
- Folder **nested** (sub-folder di dalam sub-folder).
- Operasi: create, rename, move, delete (folder & file).
- Delete folder = delete semua isi di dalamnya (soft delete direkomendasikan, lihat Open Question #2).

## 8. Upload
- Upload utama: **drag & drop dari browser**.
- Karena Cloudflare Workers punya limit request body, file besar perlu **chunked upload** (upload per-bagian lalu digabung di sisi provider atau di-assembly sebelum kirim ke provider final).
- Validasi tipe/size file sebelum upload (dikonfigurasi owner).

## 9. Preview
- Preview langsung di browser untuk: **gambar, video, PDF**.
- File tipe lain (zip, docx, dll): tampil sebagai item dengan opsi download saja (tidak ada preview).

## 10. Share Link
- Generate link publik per file/folder.
- Opsi saat generate: **expiry date** (opsional) dan **password** (opsional).
- Link yang expired otomatis invalid (dicek saat akses, tidak perlu cron aktif hapus).

## 11. Fitur CDN Gambar/Video
- Setiap gambar/video yang diupload otomatis dapat **link CDN publik** yang bisa dipanggil langsung di kode (`<img src="...">`, `<video src="...">`, dsb) tanpa perlu login/session.
- Link CDN pakai **nama acak** (random string/UUID/hash), **tidak memakai nama file asli** — mencegah tebak-tebakan nama file dan bocor info dari nama asli.
- Nama asli file tetap disimpan di metadata (D1) untuk ditampilkan di UI, tapi tidak pernah muncul di URL publik.
- Request ke link CDN: Worker cari `remote_file_id` dari mapping random-slug → file, lalu proxy/redirect ke provider penyimpanan aslinya (Telegram/Mega/GDrive), atau serve langsung kalau providernya support direct link.
- Perlu cache header (Cache-Control) yang wajar supaya request berulang ke gambar/video yang sama tidak terus-menerus hit provider asal.
- Owner bisa nonaktifkan/regenerate link CDN per file (misal kalau link kebocoran, file bisa di-generate ulang link barunya tanpa reupload).
- Khusus file yang dipakai sebagai CDN (gambar/video), field share link (section 10) dan link CDN ini terpisah: share link untuk halaman viewer manusia (bisa expiry/password), CDN link untuk dipanggil langsung di kode (tanpa expiry by default, karena tujuannya dipasang permanen di kode/halaman lain).

## 12. Integrasi Bot Telegram (Fase Lanjutan)
- Rencana ke depan: bot Telegram existing bisa upload/kelola file ke akun user via API yang sama dengan web.
- Implikasi desain: backend harus expose internal API (bukan cuma UI langsung ke DB) supaya bot bisa dipakai sebagai client kedua.

## 13. Dashboard Owner
- Kelola user (invite, suspend, hapus).
- Kelola provider (on/off, lihat kapasitas).
- Monitoring: total user, total file, total storage terpakai per provider.
- Log/audit: siapa upload/hapus/share file apa dan kapan (memanfaatkan `uploaded_by` di section 6).

## 14. UI/UX — Dashboard Modern
- Desain dashboard modern, bukan tampilan admin generik/tabel polos.
- Pakai icon set yang konsisten (misal Lucide/Feather-style) untuk tiap aksi (upload, folder, share, delete, preview, provider status).
- Animasi/transisi fresh tapi ringan: hover state, transisi buka folder, progress bar upload animatif, skeleton loading saat fetch data — bukan animasi berat yang bikin lambat di Workers/edge.
- State visual jelas per provider (aktif/nonaktif/penuh) pakai warna & icon status, bukan cuma teks.
- Layout: sidebar navigasi (folder tree, provider status singkat) + area utama grid/list file dengan thumbnail preview untuk gambar/video.
- Dark/light mode jadi nilai tambah kalau waktu memungkinkan (bukan wajib v1).

## 15. Non-Goals (v1)
- Tidak ada real-time collaborative editing (bukan Google Docs).
- Tidak ada versioning file (v1).
- Tidak ada mobile app native (web-only, responsive).

## 16. Open Questions
1. Saat user upload dan lebih dari satu provider aktif, apakah **user pilih provider manual** atau **sistem auto-pilih** (misal round-robin / provider dengan sisa kapasitas terbesar)?
2. Delete file/folder: **soft delete (bisa restore dari trash)** atau **hard delete langsung**?
3. Batas ukuran per file (terutama untuk Telegram Channel yang punya limit ukuran file bawaan) — perlu ditentukan per provider.
4. Format API internal untuk integrasi bot Telegram nanti: REST biasa atau ada auth token terpisah (API key) dari session login web?

## 17. Suggested Build Phases
- **Fase 1**: Auth (invite-only) + folder/file CRUD metadata di D1 + 1 provider (misal Telegram Channel dulu, paling gampang di-scriptkan) + upload/download basic + `uploaded_by` tracking.
- **Fase 2**: Tambah provider Mega Drive & Google Drive + dashboard owner (toggle provider, kapasitas).
- **Fase 3**: Link CDN gambar/video (random slug) + share link (expiry/password) + preview (gambar/video/pdf).
- **Fase 4**: UI/UX modern pass (icon set, animasi, dashboard redesign).
- **Fase 5**: Integrasi API untuk bot Telegram.
