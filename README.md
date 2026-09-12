# Gutok Drive

Cloud storage multi-provider berbasis Node.js, Express, dan SQLite. File dikirim ke provider remote yang dipilih Owner: Google Drive, Telegram Channel, atau Mega. VPS hanya menjalankan aplikasi, database metadata, dan file temporary saat proses upload.

Deployment hanya untuk VPS (PM2 + Nginx). Tidak ada target Cloudflare Workers/D1/KV — cukup Node.js dan satu VPS.

## 1. Prasyarat VPS

- Ubuntu/Debian Linux.
- Node.js 20 LTS atau lebih baru.
- npm.
- PM2 untuk proses production.
- Domain yang sudah diarahkan ke IP VPS.
- Nginx atau reverse proxy aaPanel.
- Port internal aplikasi: `3000`.

Periksa versi:

```bash
node --version
npm --version
```

## 2. Upload Project ke VPS

Contoh lokasi production:

```bash
sudo mkdir -p /var/www/gutok-drive
sudo chown -R "$USER":"$USER" /var/www/gutok-drive
cd /var/www/gutok-drive
```

Upload seluruh isi project ke folder tersebut menggunakan Git, SCP, SFTP, atau File Manager aaPanel. Jangan upload file rahasia ke repository publik.

Source backend jangan diletakkan di folder web root yang dilayani Nginx secara langsung. Aplikasi hanya boleh diakses melalui reverse proxy ke port Node. Setelah upload, batasi permission:

```bash
cd /var/www/gutok-drive
chmod 750 . server.js ecosystem.config.cjs
chmod 640 package.json package-lock.json
chmod 700 data storage
```

Enkripsi source code tidak dapat membuat Node tetap menjalankan aplikasi tanpa memiliki plaintext saat runtime. Perlindungan yang benar adalah repository private, user Linux khusus aplikasi, permission filesystem, firewall, HTTPS, dan tidak membuka port source ke publik. Frontend `assets/app.js` tetap dapat dilihat pengguna karena browser harus menerimanya.

Jika menggunakan Git:

```bash
git clone URL_REPOSITORY /var/www/gutok-drive
cd /var/www/gutok-drive
npm ci
```

Jika project dikirim sebagai arsip:

```bash
cd /var/www/gutok-drive
npm install --omit=dev
```

## 3. Konfigurasi Environment

Environment penting:

```text
NODE_ENV=production
PORT=3000
STORAGE_CONFIG_KEY=ganti-dengan-secret-acak-minimal-32-karakter
MAX_FILE_SIZE=5368709120
TRASH_RETENTION_DAYS=30
```

Generate secret:

```bash
openssl rand -base64 48
```

`STORAGE_CONFIG_KEY` wajib stabil. Jika berubah, credential provider yang tersimpan terenkripsi tidak bisa didekripsi lagi. `TRASH_RETENTION_DAYS` mengatur berapa hari item di Sampah disimpan sebelum dibersihkan otomatis (default 30); nilai `0` membuat item dibersihkan begitu menu Sampah dibuka.
Semua variabel di atas sudah tersedia di `.env.example`. `setup.sh` menyalinnya menjadi `.env` dan mengisi `STORAGE_CONFIG_KEY` otomatis dengan hasil `openssl rand -base64 48`; `ecosystem.config.cjs` ikut disuntik nilai yang sama supaya PM2 memakai secret yang identik.

Jangan menaruh token Telegram, password Mega, private key Google, atau API key di Git. Credential provider dimasukkan melalui panel Owner dan disimpan terenkripsi di SQLite.

## 4. Jalankan Pertama Kali

```bash
cd /var/www/gutok-drive
npm ci
NODE_ENV=production PORT=3000 STORAGE_CONFIG_KEY='SECRET_ANDA' npm start
```

Tes dari VPS:

```bash
curl -I http://127.0.0.1:3000/
curl http://127.0.0.1:3000/api/setup
```

Buka domain atau `http://IP_VPS:3000`, lalu buat Owner pertama. Setelah Owner dibuat, akun berikutnya dibuat melalui menu invite Owner.

## 5. Deploy dengan PM2

```bash
npm install --global pm2
```

Edit `ecosystem.config.cjs`:

```js
module.exports = {
  apps: [{
    name: 'gutok-drive',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      STORAGE_CONFIG_KEY: 'ganti-dengan-secret-acak',
      MAX_FILE_SIZE: 5368709120
    }
  }]
};
```

Jalankan:

```bash
cd /var/www/gutok-drive
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Jalankan perintah `sudo` yang dicetak oleh `pm2 startup`, lalu cek:

```bash
pm2 status
pm2 logs gutok-drive --lines 100
curl -I http://127.0.0.1:3000/
```

Restart setelah perubahan:

```bash
pm2 restart gutok-drive --update-env
```

Jalankan PM2 sebagai user aplikasi, bukan `root`. Batasi SSH, aktifkan firewall hanya untuk SSH/HTTP/HTTPS, dan jangan membuka port `3000` ke internet jika memakai Nginx.

## 6. Reverse Proxy Nginx

```nginx
server {
    listen 80;
    server_name drive.example.com;

    client_max_body_size 5G;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }
}
```

Aktifkan HTTPS menggunakan Certbot atau SSL aaPanel. Saat `NODE_ENV=production`, cookie session otomatis memakai flag `Secure`.

## 7. Setup Provider melalui Dashboard

Login sebagai Owner, buka `Owner control`, lalu konfigurasi provider.

### Google Drive

1. Buat service account di Google Cloud.
2. Aktifkan Google Drive API.
3. Buat Shared Drive dan folder tujuan.
4. Tambahkan `client_email` service account sebagai `Content manager`.
5. Tempel JSON service account dan URL atau ID folder pada panel.
6. Aktifkan provider setelah verifikasi akses berhasil.

Server membuat OAuth access token otomatis dari JSON service account. API key Google `AIza...` tidak digunakan untuk upload.

### Telegram

1. Buat bot melalui `@BotFather`.
2. Tambahkan bot sebagai administrator channel.
3. Berikan izin mengirim pesan/file.
4. Masukkan bot token dan channel ID pada panel.
5. Uji upload file kecil.

Telegram tidak menyediakan angka total quota channel. Dashboard menghitung penggunaan file yang tercatat di aplikasi.

### Mega

1. Gunakan akun Mega khusus aplikasi.
2. Masukkan email dan password Mega melalui panel Owner.
3. Aktifkan provider.
4. Uji upload file kecil.

## 8. Fitur Upload

- Owner dapat memilih provider upload.
- User biasa memakai provider aktif secara otomatis.
- Upload CDN hanya menerima gambar/video maksimal 5 MB.
- File biasa dapat dienkripsi AES-256-CTR sebelum dikirim ke provider.
- Masa simpan dapat dipilih `Selamanya`, `Hari`, atau `Bulan`.
- File kedaluwarsa tidak ditampilkan di dashboard.
- Preview tersedia untuk gambar, video, audio, PDF, teks, JSON, dan XML. Format lain tersedia melalui buka/download.

### Sampah, pindah, dan CDN

- Menghapus file/folder dari dashboard tidak langsung membuang datanya: item dipindahkan ke **Sampah** dan masih terhitung sebagai pemakaian provider sampai dihapus permanen, sama seperti Google Drive.
- Folder yang dipindahkan ke Sampah membawa seluruh isinya. Saat dipulihkan, hanya isi yang terhapus bersamaan yang ikut kembali; item yang sebelumnya sudah di Sampah tetap tinggal di sana.
- Sampah dibuka lewat menu **Sampah** di sidebar: tersedia tombol pulihkan dan hapus permanen per item, plus **Kosongkan Sampah**. Item yang lebih tua dari `TRASH_RETENTION_DAYS` dibersihkan otomatis saat menu ini dibuka.
- Tombol **Pindahkan** di setiap kartu file/folder memindahkannya ke folder lain; pilihan `MyDrive (root)` mengeluarkan item dari semua folder. Folder tidak bisa dipindahkan ke dirinya sendiri atau ke turunannya.
- Tombol **CDN** hanya muncul untuk gambar/video yang tidak dienkripsi dan dipakai untuk menyalakan atau mematikan link `/cdn/<slug>`. File terenkripsi tidak bisa dipakai sebagai CDN karena link CDN mengirim byte apa adanya.

## 9. Data dan Backup

Data penting:

- `data/mydrive.sqlite`: user, session, folder, metadata, dan konfigurasi provider terenkripsi.
- `data/mydrive.sqlite-wal` dan `data/mydrive.sqlite-shm`: journal SQLite saat database aktif.
- `data/tmp/`: file sementara upload; boleh dibersihkan saat tidak ada upload.
- `storage/`: legacy/runtime directory. Provider remote tidak menyimpan file permanen di sini.

Backup database secara konsisten:

```bash
pm2 stop gutok-drive
tar -czf gutok-drive-backup-$(date +%F).tar.gz data/ ecosystem.config.cjs
pm2 start gutok-drive
```

Simpan backup di server berbeda dan jangan menyertakan credential mentah di log atau repository.

## 10. Troubleshooting

### `Failed to fetch`

```bash
pm2 status
pm2 logs gutok-drive --lines 100
ss -ltnp | grep 3000
curl -I http://127.0.0.1:3000/
```

Pastikan browser memakai domain/port yang sama dengan instance PM2. Jangan menjalankan beberapa `npm start` pada port yang sama.

### Upload Google gagal

- Pastikan folder dibagikan ke `client_email` service account.
- Gunakan hak `Editor` atau `Content manager`.
- Gunakan folder Shared Drive bila memakai service account.
- Pastikan `STORAGE_CONFIG_KEY` tidak berubah.
- Baca pesan API Google di dashboard dan `pm2 logs`.

### Upload Telegram gagal

- Bot harus benar-benar admin channel.
- Chat ID channel biasanya berbentuk `-100...`.
- Pastikan bot memiliki izin mengirim file.
- Periksa token dan konfigurasi provider.

### Port 3000 sudah dipakai

```bash
ss -ltnp | grep 3000
pm2 status
```

Hentikan proses lama melalui PM2, atau ubah `PORT` di `ecosystem.config.cjs` dan reverse proxy secara bersamaan.

## 11. Update dan Deploy Ulang

Aplikasi hanya punya satu target deployment: VPS (`server.js` + SQLite + PM2). Target Cloudflare Workers/D1/KV sudah dihapus, jadi tidak ada `wrangler` maupun migrasi terpisah — skema database dibuat dan di-update otomatis oleh `server.js` setiap aplikasi start.

`deploy.sh` mengambil versi terbaru dari Git sekaligus membuat backup `data/`, `.env`, dan `ecosystem.config.cjs` lebih dulu (folder `data/` dan `.env` berisi kredensial provider terenkripsi serta `STORAGE_CONFIG_KEY`):

```bash
cd /var/www/gutok-drive
bash deploy.sh

# boleh juga dari folder mana pun, misalnya: bash ~/drivegutok/deploy.sh
```

**Penting:** yang di-update adalah folder aplikasi (`APP_DIR`, default `/var/www/gutok-drive`). Melakukan `git pull` di `~/drivegutok` (klon kedua di VPS) **tidak** mengubah aplikasi yang berjalan. Kalau setelah `git pull` fitur baru tetap tidak muncul, periksa commit di folder aplikasi:

```bash
cd /var/www/gutok-drive && git log --oneline -1 && git status --short
```

`update-code.sh` dicari di `APP_DIR` dulu; kalau belum ada di sana (deployment yang belum pernah menarik commit ini), dipakai yang ada di folder tempat `deploy.sh` berada. Jadi `bash ~/drivegutok/deploy.sh` tetap bisa menyelesaikan deploy pertama ke `/var/www/gutok-drive` tanpa langkah manual. Kalau tidak ditemukan di keduanya, `deploy.sh` berhenti **sebelum** `pm2 stop` — aplikasi tidak ikut mati.

`deploy.sh` memanggil `update-code.sh` untuk urusan Git, lalu `npm ci --omit=dev`, `pm2 restart ecosystem.config.cjs --update-env`, `pm2 save`, dan terakhir menunggu `http://127.0.0.1:3000/api/setup` merespons. Script keluar dengan status gagal kalau aplikasi tidak hidup, jadi log PM2 yang ikut ditampilkan bisa langsung diperiksa. Kalau ada langkah yang gagal — misalnya `git merge --ff-only` ditolak karena VPS punya commit lokal — `deploy.sh` menyalakan ulang aplikasi dengan kode yang ada sekarang, mencetak lokasi backup, lalu menyuruh menjalankan ulang, sehingga deploy yang gagal tidak pernah berakhir dengan situs mati. Folder `data/`, `storage/`, dan `data/tmp/` dibuat lebih dulu sebelum backup karena `tar` gagal kalau `data/` belum ada.

`update-code.sh` perlu ada karena `setup.sh` menyuntik `STORAGE_CONFIG_KEY` asli ke `ecosystem.config.cjs`, padahal file itu dilacak Git. Tanpa script itu `git pull` ditolak dengan `Your local changes to the following files would be overwritten by merge`. Sekarang nilai secret diamankan lebih dulu (dari `.env`, cadangannya dari file itu sendiri), file dikembalikan ke versi repo, kode ditarik dengan `git merge --ff-only`, lalu secret disuntik ulang. Kalau `git merge --ff-only` gagal (misalnya VPS punya commit lokal sendiri), script berhenti dengan error tanpa mengubah kode, dan `ecosystem.config.cjs` tetap disuntik secret yang benar supaya restart manual tidak merusak kredensial provider. `redeploy.sh` adalah versi ringkas tanpa backup untuk VPS yang projectnya ada di `~/drivegutok` dan memakai `update-code.sh` yang sama.

Sekali saja, kalau VPS kamu masih memakai `deploy.sh` versi lama (yang belum memanggil `update-code.sh`), jalankan langkah berikut untuk sampai ke versi terbaru:

```bash
cd /var/www/gutok-drive
SECRET=$(grep '^STORAGE_CONFIG_KEY=' .env | cut -d '=' -f2-)
cp ecosystem.config.cjs ~/ecosystem.config.cjs.bak
git checkout -- ecosystem.config.cjs
git pull origin main
npm ci --omit=dev        # kalau rilis itu menambah dependency
sed -i "s#STORAGE_CONFIG_KEY: '.*'#STORAGE_CONFIG_KEY: '${SECRET}'#" ecosystem.config.cjs
pm2 restart ecosystem.config.cjs --update-env
pm2 save
```

Setelah itu `bash deploy.sh` sudah aman dipakai berulang kali tanpa langkah manual.

### Fitur baru tidak muncul atau Owner control error

Gejalanya: `git pull` sudah dijalankan, tapi UI masih versi lama (tombol ganti nama/hapus folder tidak ada), atau halaman **Owner control** gagal terbuka. Hampir selalu penyebabnya salah satu dari ini:

1. **Pull dilakukan di folder yang salah.** Aplikasi dilayani dari `APP_DIR` (default `/var/www/gutok-drive`), bukan dari `~/drivegutok`. Pastikan commit di folder aplikasi sudah terbaru:
   ```bash
   cd /var/www/gutok-drive && git log --oneline -1
   ```
   Kalau masih commit lama dan `update-code.sh` belum ada di folder itu, lakukan sekali:
   ```bash
   cp ~/drivegutok/update-code.sh /var/www/gutok-drive/
   cd /var/www/gutok-drive && bash deploy.sh
   ```
2. **Browser memakai `app.js` dari cache.** Nginx/Express menyajikan aset statis dengan ETag; setelah deploy, lakukan hard reload (Ctrl+Shift+R).
3. **Proses aplikasi sedang restart berulang (crash loop).** Cek `pm2 status` — angka kolom `↺` yang terus naik berarti aplikasi dimatikan oleh error, bukan oleh provider yang lambat. Sejak commit terbaru `server.js` menahan `unhandledRejection`/`uncaughtException` dan mencatatnya sebagai `[unhandledRejection] aplikasi tetap berjalan: ...`, jadi kasus provider bermasalah (mis. Mega diblokir) tidak lagi mematikan situs. Kalau kamu masih melihat log lama tanpa awalan itu, kode di VPS belum terbaru — kembali ke langkah 1.
4. **Satu provider menahan seluruh halaman.** `/api/admin/overview` memanggil semua provider sekaligus; sekarang setiap pembacaan kapasitas dibatasi 8 detik (`PROVIDER_TIMEOUT_MS`), jadi provider yang tidak menjawab hanya muncul sebagai pesan error di kartunya, bukan membuat halaman kosong. Provider yang kamu **Nonaktifkan** tidak dihubungi sama sekali, jadi mematikan provider bermasalah membuat dashboard kembali instan.

Mengubah `TRASH_RETENTION_DAYS` (masa simpan item di Sampah) dilakukan di `ecosystem.config.cjs` karena PM2 tidak membaca `.env`, lalu jalankan `pm2 restart ecosystem.config.cjs --update-env`. Skema database tidak perlu migrasi manual: `server.js` membuat tabel dan menambah kolom yang kurang saat aplikasi start.

### Deploy ulang dari nol (VPS baru atau folder project hilang)

`setup.sh` sudah menangani clone, pembuatan `.env`, generate `STORAGE_CONFIG_KEY`, izin file, dan start PM2. Dua hal yang wajib dijaga:

- Pakai `STORAGE_CONFIG_KEY` yang sama dengan sebelumnya (ambil dari backup `.env` atau `~/ecosystem.config.cjs.bak`). Kalau nilainya berubah, seluruh kredensial provider yang tersimpan terenkripsi di SQLite tidak bisa didekrip lagi dan provider harus dikonfigurasi ulang dari panel Owner.
- Kembalikan `data/` dari backup supaya user, session, folder, metadata file, dan konfigurasi provider ikut kembali.

```bash
# 1. Kembalikan data + secret dari backup (jalankan di /var/www/gutok-drive)
tar -xzf gutok-drive-backup-YYYY-MM-DD-HHMM.tar.gz -C /var/www/gutok-drive

# 2. Kalau folder project memang kosong, siapkan dulu kerangkanya
bash setup.sh        # clone + .env + izin + pm2 start

# 3. Baru tarik versi terbaru
bash deploy.sh
```

Kalau backup hanya berisi `data/`, isi `STORAGE_CONFIG_KEY` di `.env` dan `ecosystem.config.cjs` dengan nilai yang sama seperti sebelumnya sebelum start.

### Rollback ke versi sebelumnya

```bash
cd /var/www/gutok-drive
pm2 stop gutok-drive
git log --oneline -5                    # pilih commit tujuan
git checkout -- ecosystem.config.cjs    # lepas suntikan secret lokal dulu (nilainya tetap ada di .env)
git checkout <commit>                   # kembali ke main dengan: git checkout main
SECRET=$(grep '^STORAGE_CONFIG_KEY=' .env | cut -d '=' -f2-)
sed -i "s#STORAGE_CONFIG_KEY: '.*'#STORAGE_CONFIG_KEY: '${SECRET}'#" ecosystem.config.cjs
npm ci --omit=dev
pm2 restart ecosystem.config.cjs --update-env
pm2 save
pm2 logs gutok-drive --lines 50 --nostream
```

`git checkout <commit>` akan ditolak (`Your local changes ... would be overwritten by checkout`) kalau `ecosystem.config.cjs` masih berisi suntikan secret `setup.sh`, jadi baris `git checkout -- ecosystem.config.cjs` di atas wajib dijalankan lebih dulu. Setelah commit-nya pindah, file itu kembali ke placeholder sehingga langkah `sed` juga wajib dijalankan sebelum restart. Rollback tidak perlu migrasi database: perubahan skema sejauh ini hanya menambah kolom, dan versi lama mengabaikan kolom yang tidak dikenalinya. Setelah kode baik lagi, jalankan `bash deploy.sh` untuk kembali ke `main` — `update-code.sh` menangani perpindahan dari detached HEAD itu.

### Verifikasi setelah deploy

```bash
pm2 status
git log --oneline -1
grep -o "STORAGE_CONFIG_KEY: '.\{6\}" ecosystem.config.cjs   # pastikan bukan 'ganti-'
curl -s http://127.0.0.1:3000/api/setup
pm2 logs gutok-drive --lines 50 --nostream
```

Lanjutkan dari browser: login, upload file kecil, buka menu **Sampah**, dan uji satu tombol **Pindahkan**/**CDN**.

Kalau `pm2 restart ecosystem.config.cjs --update-env` terasa tidak memuat env baru, paksa dengan `pm2 delete gutok-drive && pm2 start ecosystem.config.cjs && pm2 save`.

Sesuaikan `APP_DIR` di `deploy.sh` maupun `setup.sh` kalau lokasi project bukan `/var/www/gutok-drive`.

### Akun Mega diblokir (`Error: EBLOCKED (-16): User blocked`)

Pesan ini datang dari Mega, bukan dari aplikasi: akun Mega yang dipakai provider sedang dibatasi Mega (biasanya karena aktivitas mencurigakan, login dari banyak IP, atau verifikasi yang belum selesai). Sejak commit terbaru aplikasi tidak mati karena ini — provider itu hanya gagal dipakai, dan penyebabnya tampil sebagai `capacityError` di kartu provider.

- Kalau Mega tidak dipakai lagi: buka **Owner control** → **Nonaktifkan** pada Mega Drive supaya dashboard tidak lagi menanyakan kapasitasnya.
- Kalau masih dipakai: login ke mega.nz dengan akun itu, selesaikan verifikasi/unblock, atau pindah ke akun lain lewat **Ubah konfigurasi**. File yang sudah diunggah tetap ada di akun lama selama akunnya belum pulih.

```bash
pm2 status
pm2 logs gutok-drive --lines 50 --nostream | grep -iE 'EBLOCKED|unhandledRejection'
```

Kalau kolom `↺` di `pm2 status` terus bertambah dan log masih menampilkan `EBLOCKED` tanpa awalan `[unhandledRejection]`, kode di VPS belum memuat perbaikan crash loop — ulangi deploy (lihat bagian "Fitur baru tidak muncul atau Owner control error").
