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
```

`deploy.sh` memanggil `update-code.sh` untuk urusan Git, lalu `npm ci --omit=dev`, `pm2 restart ecosystem.config.cjs --update-env`, `pm2 save`, dan terakhir menunggu `http://127.0.0.1:3000/api/setup` merespons. Script keluar dengan status gagal kalau aplikasi tidak hidup, jadi log PM2 yang ikut ditampilkan bisa langsung diperiksa.

`update-code.sh` perlu ada karena `setup.sh` menyuntik `STORAGE_CONFIG_KEY` asli ke `ecosystem.config.cjs`, padahal file itu dilacak Git. Tanpa script itu `git pull` ditolak dengan `Your local changes to the following files would be overwritten by merge`. Sekarang nilai secret diamankan lebih dulu (dari `.env`, cadangannya dari file itu sendiri), file dikembalikan ke versi repo, kode ditarik dengan `git merge --ff-only`, lalu secret disuntik ulang. Kalau `git merge --ff-only` gagal (misalnya VPS punya commit lokal sendiri), script berhenti dengan error tanpa mengubah kode, dan `ecosystem.config.cjs` tetap disuntik secret yang benar supaya restart manual tidak merusak kredensial provider. `redeploy.sh` adalah versi ringkas tanpa backup untuk VPS yang projectnya ada di `~/drivegutok` dan memakai `update-code.sh` yang sama.

Sekali saja, kalau VPS kamu masih memakai `deploy.sh` versi lama (yang belum memanggil `update-code.sh`), jalankan langkah berikut untuk sampai ke versi terbaru:

```bash
cd /var/www/gutok-drive
SECRET=$(grep '^STORAGE_CONFIG_KEY=' .env | cut -d '=' -f2-)
cp ecosystem.config.cjs ~/ecosystem.config.cjs.bak
git checkout -- ecosystem.config.cjs
git pull origin main
sed -i "s#STORAGE_CONFIG_KEY: '.*'#STORAGE_CONFIG_KEY: '${SECRET}'#" ecosystem.config.cjs
pm2 restart ecosystem.config.cjs --update-env
pm2 save
```

Setelah itu `bash deploy.sh` sudah aman dipakai berulang kali tanpa langkah manual.

Mengubah `TRASH_RETENTION_DAYS` (masa simpan item di Sampah) dilakukan di `ecosystem.config.cjs` karena PM2 tidak membaca `.env`, lalu jalankan `pm2 restart ecosystem.config.cjs --update-env`. Skema database tidak perlu migrasi manual: `server.js` membuat tabel dan menambah kolom yang kurang saat aplikasi start.

Sesuaikan `APP_DIR` di `deploy.sh` maupun `setup.sh` kalau lokasi project bukan `/var/www/gutok-drive`.
