# Gutok Drive

Cloud storage multi-provider berbasis Node.js, Express, dan SQLite. File dikirim ke provider remote yang dipilih Owner: Google Drive, Telegram Channel, atau Mega. VPS hanya menjalankan aplikasi, database metadata, dan file temporary saat proses upload.

Deployment hanya untuk VPS (PM2 + Nginx). Tidak ada target Cloudflare Workers/D1/KV — cukup Node.js dan satu VPS.

## Struktur Project

```
drivegutok/
├─ server.js               seluruh backend: API, provider, otentikasi, enkripsi config
├─ cleanup.js              pembersih Sampah otomatis (dipanggil PM2/cron)
├─ ecosystem.config.cjs    konfigurasi PM2
├─ *.sh                    setup.sh, deploy.sh, redeploy.sh, update-code.sh, deploy-bersih.sh, perbaiki-vps.sh, vps-nginx.sh, bersih-vps.sh
├─ assets/                 satu-satunya folder yang dikirim ke browser (express.static)
│  ├─ index.html           kerangka halaman: hanya #app dan #toast
│  ├─ logo.jpg
│  ├─ app.js               titik masuk: daftar rute, listener global, start()
│  ├─ js/                  core.js (api/toast/helper), router.js (ke()), state.js, ikon.js (SVG inline)
│  │  └─ views/            login.js, files.js, admin.js, trash.js
│  └─ styles/              tokens.css, base.css, components.css, views.css
├─ uji/                    semua uji otomatis
├─ data/, storage/         runtime, tidak dilacak Git
└─ README.md, FIXES.md     dokumen ini dan catatan perbaikan
```

Script `*.sh` sengaja tetap di akar repo karena alur VPS memanggilnya dengan nama itu (`bash deploy.sh`, `cp ~/drivegutok/update-code.sh /var/www/gutok-drive/`), dan `uji/skrip-deploy.sh` berlatih dengan cara menyalin semua `*.sh` dari akar repo.

### Uji

```bash
npm run check                  # sintaks semua berkas + uji cepat
npm run uji                    # lingkup modul, batas waktu upload, render tiap layar, gaya CSS, ikatan handler, provider Google OAuth, rapikan VPS
npm run uji:berat              # cleanup.js, server lambat, dan pemakaian RAM saat upload besar
bash uji/skrip-deploy.sh .     # latihan deploy di VPS palsu (pm2/npm/curl diganti stub)
npm run uji:mega               # jalur galat login Mega (perlu akses API Mega, dilewati bila diblokir)
```

Uji di `uji/` yang berjalan ke proses server sungguhan menyalin `server.js` ke folder sementara
(provider diarahkan ke server tiruan lokal lewat `TELEGRAM_API_BASE` / `GOOGLE_API_BASE` / `GOOGLE_AUTH_BASE`), jadi
tidak ada file uji yang dikirim ke provider asli.

Semua uji di `uji/` boleh dijalankan dari folder mana pun dan tidak menyentuh `data/` maupun `storage/` produksi.

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
UPLOAD_IDLE_TIMEOUT_MS=95000
PROVIDER_MEGA_TIMEOUT_MS=30000
```

Generate secret:

```bash
openssl rand -base64 48
```

`STORAGE_CONFIG_KEY` wajib stabil. Jika berubah, credential provider yang tersimpan terenkripsi tidak bisa didekripsi lagi. `TRASH_RETENTION_DAYS` mengatur berapa hari item di Sampah disimpan sebelum dibersihkan otomatis (default 30); nilai `0` membuat item dibersihkan begitu menu Sampah dibuka.
`UPLOAD_IDLE_TIMEOUT_MS` (default 95000) adalah batas waktu **diamnya soket** saat mengirim berkas ke provider: kalau Telegram sudah menerima seluruh berkas lalu berhenti menjawab, permintaan dijawab `502` dengan pesan yang jelas alih-alih menggantung sampai Cloudflare memutusnya di 100 detik (`524`) tanpa baris database dan tanpa catatan log. Nilai defaultnya 95 detik karena lama jawaban Telegram tumbuh seiring ukuran berkas (terukur di VPS: 3 MB selesai di detik ke-35, 5 MB baru di detik ke-60) — batas 60 detik membuang unggahan yang sebenarnya berhasil di detik ke-61..95 sambil meninggalkan berkas yatim di channel. Jangan naikkan melewati 100000: di atas itu Cloudflare sudah lebih dulu memutus klien, dan pesannya berubah jadi halaman `524`. Batas ini hanya berlaku untuk soket yang diam; unggahan besar yang datanya terus mengalir tidak terpengaruh. Batas Nginx (`proxy_read_timeout`, lihat `vps-nginx.sh`) harus lebih longgar dari nilai ini supaya yang menjawab galat adalah aplikasi, bukan proxy.
Semua variabel di atas sudah tersedia di `.env.example`. `setup.sh` menyalinnya menjadi `.env` dan mengisi `STORAGE_CONFIG_KEY` otomatis dengan hasil `openssl rand -base64 48`; `ecosystem.config.cjs` ikut disuntik nilai yang sama supaya PM2 memakai secret yang identik.
`PROVIDER_MEGA_TIMEOUT_MS` (default 30000) adalah batas waktu login Mega saat kuotanya dibaca. Mega memasang tantangan proof-of-work (header `X-Hashcash`) di depan login dan megajs menghitung tokennya di CPU — terukur ±5 detik di mesin uji dan lebih lama di VPS 1 core, sehingga batas 8 detik milik provider lain membuat akun yang sehat tampil `Mega tidak merespons dalam 8 detik`. Pembacaan kuota berjalan di latar belakang, jadi batas longgar tidak menahan halaman.
`PUBLIC_BASE_URL` (opsional, tanpa garis miring di akhir) adalah alamat publik situs ini, mis. `https://drive.contoh.com`. Dipakai untuk menyusun **redirect URI** login akun Google. Di balik reverse proxy (Nginx/Cloudflare) permintaan sampai ke Node sebagai `http://`, sehingga tanpa variabel ini redirect URI yang dikirim ke Google berbunyi `http://...` padahal publiknya `https://...` — dan Google menolaknya karena tidak sama dengan yang didaftarkan. Kalau situs diakses langsung tanpa proxy, variabel ini tidak perlu diisi.

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

    # Aset statis (CSS/JS) dikompres Nginx, bukan Node — hemat CPU VPS.
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;

        # Tanpa ini Nginx menulis seluruh badan request upload ke disk dulu (dua kali tulis untuk
        # file besar) lalu menahan respons besar di buffer. Keduanya membebani VPS 1 GB.
        proxy_request_buffering off;
        proxy_buffering off;
    }
}
```

Aktifkan HTTPS menggunakan Certbot atau SSL aaPanel. Saat `NODE_ENV=production`, cookie session otomatis memakai flag `Secure`.

**Batas bawaan Nginx adalah 1 MB.** Kalau `client_max_body_size` tidak ada di server block yang melayani domain, setiap upload di atas 1 MB dijawab `413 Request Entity Too Large` oleh Nginx **sebelum Express melihat request-nya** — aplikasi ini sendiri tidak punya batas 1 MB (`MAX_FILE_SIZE` default 5 GB dan multer menulis file ke `data/tmp`). Jadi keluhan "upload lebih dari 1 MB gagal" selalu masalah lapisan proxy, bukan `server.js`:

```bash
sudo bash vps-nginx.sh                                   # isi 5G + gzip + buffering off, reload, lalu uji
NGINX_CONF=/etc/nginx/sites-enabled/gutokdrive.world DRY=1 bash vps-nginx.sh   # pratinjau perubahan tanpa menyentuh nginx
```

`vps-nginx.sh` mengganti/menyisipkan `client_max_body_size` (default `5G`), menyalakan gzip aset, mematikan `proxy_request_buffering`/`proxy_buffering`, mencadangkan konfigurasi lama, mengembalikannya otomatis kalau `nginx -t` gagal, lalu **membuktikan** hasilnya dengan body 2 MB dan 6 MB di tiga lapis: Express langsung, Nginx lokal, dan URL publik. Uji itu tanpa cookie (Express menjawab 401), jadi tidak ada file yang benar-benar tersimpan.

Kalau trafik lewat Cloudflare (proxy oranye), batas tubuh request di paket gratis adalah 100 MB — Cloudflare akan menjawab 413 sebelum Nginx melihatnya. Untuk file lebih besar, arahkan subdomain upload langsung ke IP VPS (DNS only) dan pastikan `client_max_body_size` di Nginx sesuai.

## 7. Batas Memori VPS 1 GB

Backend ini dijaga tetap ringan tanpa pindah bahasa. Yang diukur dan diperbaiki:

- **Upload mengalir, tidak dimuat ke RAM.** Telegram dulu memakai `new Blob([fs.readFileSync(...)])` (1x ukuran file) dan Google Drive memakai `readFileSync` + `Buffer.concat` (2x ukuran file), jadi mengunggah 300 MB bisa memakai 300–600 MB RAM dan memicu OOM killer. Sekarang keduanya memakai `kirimMultipart()` — `node:http`/`node:https` dengan `Content-Length` pasti, membaca file potongan demi potongan dengan backpressure. `uji/ram.mjs` mengukurnya: upload 240 MB tidak menaikkan puncak RSS secara berarti.
- **`fetch()` Node bukan alat yang tepat untuk badan request besar.** undici menahan seluruh badan di memori sebelum mengirim: terukur +132 MB untuk file 96 MB, sementara pipa `node:http` hanya +21 MB. Karena itu upload provider tidak memakai `fetch`.
- **PM2 dibatasi.** `ecosystem.config.cjs` memasang batas heap dua kali: `node_args: '--max-old-space-size=384'` dan `NODE_OPTIONS: '--max-old-space-size=384'` di `env`, plus `max_memory_restart: '500M'`. Dua-duanya dipasang karena PM2 tidak selalu sama di tiap VPS: pada PM2 di VPS ini `node_args` **tidak** ikut ke command line proses anak (terbukti di VPS: `/proc/<pid>/cmdline` tetap `node /var/www/gutok-drive/server.js` walau `pm2 jlist` menyimpan `"node_args":["--max-old-space-size=384"]`), sementara nilai yang sama di `env` terpakai lewat `NODE_OPTIONS` (`/proc/<pid>/environ` → `NODE_OPTIONS=--max-old-space-size=384`). Karena itu `deploy.sh`/`redeploy.sh` memeriksa **tiga** sumber — `pm2 env 0`, `/proc/<pid>/cmdline`, dan `/proc/<pid>/environ` — sebelum melapor sukses. `pm2 restart` **tidak** menerapkan ulang pengaturan itu (nilai baru hanya masuk saat proses dibuat), jadi kedua script membuat ulang prosesnya dengan `pm2 delete` + `pm2 start` — tanpa menambah downtime karena aplikasi memang sudah dihentikan sebelum tarik kode. Kalau mengubah `ecosystem.config.cjs` secara manual, jalankan `pm2 delete gutok-drive && pm2 start ecosystem.config.cjs && pm2 save`, lalu cek buktinya:
  ```bash
  tr '\0' '\n' < /proc/$(pgrep -f 'gutok-drive/server.js' | head -1)/environ | grep NODE_OPTIONS
  ```
  Untuk memastikan PM2 sendiri melihat batas itu (bukan cuma ada di lingkungan proses): `pm2 env 0 | grep NODE_OPTIONS`. Kalau `cmdline` memang tidak memuat flag sementara `environ`/`pm2 env` memuatnya, itu **normal** di VPS ini — Node selalu membaca `NODE_OPTIONS`, jadi batas heap tetap aktif.
- **SQLite diringankan.** `synchronous = NORMAL`, `busy_timeout = 5000`, `cache_size = -8000` (8 MB): fsync tidak dilakukan tiap transaksi dan cache halaman tetap terbatas.
- **Browser tidak lagi memuat lucide dari CDN.** Ikon disalin ke `assets/js/ikon.js` (22 ikon, ±4 KB); sebelumnya satu skrip `unpkg.com/lucide@latest` ±600 KB plus pemindaian DOM di setiap perubahan render.
- **Nginx tidak menyalin ulang badan request ke disk** (`proxy_request_buffering off` di bagian 6).

Kalau RAM tetap mepet, tambahkan swap 1 GB sebagai pelega:

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Semua beban berat (TLS, kompresi, cache, hooking file besar) sengaja di luar Node: Cloudflare di depan, Nginx di tengah, browser di ujung. Bagian yang harus pintar (metadata, otentikasi, enkripsi config) tetap di Node dan jumlahnya sedikit.

## 8. Setup Provider melalui Dashboard

Login sebagai Owner, buka `Owner control`, lalu konfigurasi provider. Tidak ada provider bawaan: daftar storage kosong sampai Owner menambahkannya sendiri, dan provider baru muncul di pilihan upload setelah dinyatakan **Aktif** (unggahan ditolak `409 Belum ada provider remote yang aktif dan terkonfigurasi.` selama belum ada). Widget **Penyimpanan** di sidebar dashboard menampilkan akumulasi pemakaian semua provider (satu angka terpakai, kapasitas total, dan meter tersegmentasi — tanpa rincian per provider), jadi kuota provider terlihat tanpa membuka `Owner control`. Angka di kedua tempat berasal dari sumber yang sama: `/api/dashboard` dan `/api/admin/overview` sama-sama memakai nilai tersimpan lalu menyegarkan kuota asli di latar belakang (kegagalan disimpan sementara, jadi provider yang diblokir tidak dipanggil ulang setiap menit).

### Google Drive

Kolom **Cara akses** menentukan bagaimana server memakai akun Google — pilih salah satu:

**A. Service account (JSON)** — untuk folder Shared Drive milik organisasi:

1. Buat service account di Google Cloud.
2. Aktifkan Google Drive API.
3. Buat Shared Drive dan folder tujuan.
4. Tambahkan `client_email` service account sebagai `Content manager`.
5. Tempel JSON service account, lalu URL atau ID folder pada panel.
6. Aktifkan provider setelah verifikasi akses berhasil.

**B. Login akun Google (OAuth)** — memakai akun Google Owner sendiri, termasuk kuota pribadinya:

1. Buat OAuth client ID tipe **Web application** di Google Cloud (aktifkan Google Drive API).
2. Daftarkan redirect URI yang ditampilkan di modal konfigurasi — bentuknya `<alamat-situs>/api/admin/providers/<id-provider>/google/callback`. Salin apa adanya; Google menolak URI yang tidak identik. Di balik reverse proxy isi `PUBLIC_BASE_URL` supaya alamatnya `https://`, bukan `http://`.
3. Isi Client ID dan Client secret, tempel URL/ID folder, lalu tekan **Login dengan Google** dan setujui di halaman Google.
4. Refresh token tersimpan terenkripsi di SQLite; server menukarnya jadi access token setiap kali mengunggah atau membaca kuota — tanpa kunci privat dan tanpa JWT. Cabut akses kapan saja di `myaccount.google.com/permissions` (provider langsung merah dengan pesan dari Google).
5. Aktifkan provider.

Folder harus bisa ditulis oleh akun yang dipakai: buat foldernya dengan akun itu sendiri, atau beri akun OAuth itu akses Editor ke folder/Shared Drive yang ada. Kolom rahasia yang dikosongkan saat menyimpan konfigurasi berarti "biarkan seperti semula", jadi refresh token tidak hilang kalau hanya folder ID yang diubah.

Kedua cara memakai API Drive yang sama dan API key Google `AIza...` tidak digunakan untuk upload.

### Telegram

1. Buat bot melalui `@BotFather`.
2. Tambahkan bot sebagai administrator channel.
3. Berikan izin mengirim pesan/file.
4. Masukkan bot token dan channel ID pada panel.
5. Uji upload file kecil.

Telegram tidak menyediakan angka total kuota channel (Bot API tidak punya endpointnya), jadi kartu provider-nya memakai **kapasitas manual** yang diisi Owner pada kolom "Kapasitas" saat menambah provider, sedangkan angka pemakaian adalah byte yang benar-benar **terkirim ke Telegram** — dihitung dari baris database milik provider itu, sehingga ikut turun begitu berkas dihapus permanen. Isi kapasitas `0` kalau tidak ingin batas kuota ditampilkan.

Menghapus permanen berkas (atau mengosongkan Sampah) memanggil `deleteMessage`, jadi pesannya benar-benar hilang dari channel — bukan sekadar disembunyikan dari dashboard. Telegram hanya mengizinkan bot menghapus pesan yang dikirim **kurang dari 48 jam**; untuk berkas yang lebih tua situs tetap menghapusnya dari dashboard sambil menampilkan peringatan bahwa pesannya perlu dihapus manual di channel.

### Mega

1. Gunakan akun Mega khusus aplikasi.
2. Masukkan email dan password Mega melalui panel Owner.
3. Aktifkan provider.
4. Uji upload file kecil.

Kredensial yang salah atau akun yang diblokir tampil apa adanya di badge provider (mis. `ENOENT ... Wrong password?` atau `EBLOCKED`), bukan sebagai "tidak merespons". Badge merah di provider Mega berarti loginnya gagal — periksa pesannya dan cek log PM2 kalau perlu.

## 9. Fitur Upload

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
- Hapus permanen (dan pembersihan otomatis) juga membuang berkasnya dari provider storage. Khusus Telegram, pesan di channel ikut dihapus lewat `deleteMessage`; pesan yang lebih tua dari 48 jam tidak bisa dihapus oleh bot, jadi item tetap hilang dari dashboard dengan peringatan agar channel dibersihkan manual.
- Tombol **Pindahkan** di setiap kartu file/folder memindahkannya ke folder lain; pilihan `MyDrive (root)` mengeluarkan item dari semua folder. Folder tidak bisa dipindahkan ke dirinya sendiri atau ke turunannya.
- Tombol **CDN** hanya muncul untuk gambar/video yang tidak dienkripsi dan dipakai untuk menyalakan atau mematikan link `/cdn/<slug>`. File terenkripsi tidak bisa dipakai sebagai CDN karena link CDN mengirim byte apa adanya.

### Tampilan file: tab File dan CDN

- Isi folder tampil sebagai daftar baris (ikon, nama, ukuran · provider · tanggal upload) dengan aksi muncul saat baris disorot — bukan lagi kartu-kartu terpisah.
- Dua tab di atas daftar memisahkan berkas biasa dan berkas CDN: tab **File** berisi folder dan berkas tanpa link publik, tab **CDN** hanya berkas yang punya link `/cdn/<slug>`. Berkas di tab CDN diberi tanda **CDN** dan warnanya dibedakan.
- Pemisahan ini memakai kolom `cdn_enabled` yang sudah ada; tidak ada permintaan tambahan ke server. Pindah tab hanya menyembunyikan baris lewat CSS (atribut `data-tab` di panel), dan pilihan tab disimpan di state sehingga tidak hilang saat masuk folder atau muat ulang.
- Catatan: gambar/video yang di-upload lewat tombol **Upload file** langsung dianggap berkas CDN karena server memang membuatkan link publiknya. Pakai tab CDN untuk melihat mana saja yang link-nya aktif, lalu matikan lewat tombol CDN di baris tersebut kalau tidak mau publik.

### Widget penyimpanan di sidebar

- Widget **Penyimpanan** menampilkan satu angka akumulasi semua provider: angka terpakai (font JetBrains Mono, menghitung naik dari 0 saat pertama muat), teks `dari` + kapasitas total, meter 28 segmen yang menyala berurutan dari kiri (minimal satu segmen begitu ada pemakaian, supaya 1 MB dari 15 GB tidak terlihat seperti meter kosong), dan persentase kecil di kanan atas yang muncul setelah segmen terakhir selesai.
- Nama provider, status aktif/nonaktif, dan bar kuota per provider tidak lagi ditampilkan di sidebar (rinciannya tetap ada di kartu provider halaman `Owner control`). Angka terpakai/total tetap dihitung dari semua provider yang dikembalikan `/api/dashboard`, sama seperti sebelumnya.
- Angka, segmen menyala, dan persentase sudah final di HTML: kalau animasi dilewati (atau JS mati), yang terlihat tetap nilai yang benar, bukan meter kosong. Animasi masuk hanya jalan **sekali per muat halaman** (dijaga flag modul, jadi pindah folder tidak mengulanginya) dan berhenti total saat `prefers-reduced-motion` aktif — segmen langsung menyala penuh dan angka tidak dihitung naik.
- Font display (`Space Grotesk`) dan font angka (`JetBrains Mono`, token `--f-mono`) dimuat dari Google Fonts di `index.html`; warna meter memakai token `--amber-glow`/`--amber-unlit` dan hairline `--line`, tanpa `box-shadow`.

### Cabut akses member

- Owner dapat mencabut akses user di **Owner control → Member**: tombol **Cabut akses** mengganti status akun menjadi `suspended`, tombol **Pulihkan akses** mengembalikannya ke `active`.
- Sesi user yang sedang berjalan langsung dihapus, jadi permintaan API berikutnya dijawab `401` dan halaman login akan diminta lagi. Login baru juga ditolak selama akses dicabut (`status = 'active'` diperiksa di `currentUser` dan `/api/login`).
- File milik user tetap tersimpan dan tetap miliknya; mencabut akses bukan menghapus akun. Akses owner tidak bisa dicabut (tombolnya tidak muncul, dan server menjawab `403`).
- Semua tindakan ini tercatat di **Aktivitas terakhir** sebagai `revoke` / `restore_access`.

## 10. Data dan Backup

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

## 11. Troubleshooting

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

### Upload di atas ~1 MB gagal (`413 Request Entity Too Large`)

Bukan bug aplikasi: Nginx memakai default `client_max_body_size 1m`, jadi body di atas 1 MB ditolak proxy sebelum Express melihatnya. Pastikan direktifnya ada di server block domain:

```bash
grep -rn client_max_body_size /etc/nginx/sites-enabled /etc/nginx/conf.d
sudo bash vps-nginx.sh      # mengisi 5G + reload + uji body 2 MB dan 6 MB
```

Kalau "Nginx lokal" lulus 401 tapi URL publik masih 413, batasnya ada di Cloudflare (paket gratis 100 MB) — pakai subdomain DNS-only untuk upload besar. Kalau keduanya lulus tapi upload tetap gagal, periksa sisa disk VPS: multer menulis file ke `data/tmp` dulu (`df -h /var/www`).

### File terupload ke channel Telegram tapi tidak muncul di dashboard

Berkas ada di channel Telegram, tetapi tidak ada di daftar file dan log PM2 bersih. Ada dua sebab:

1. **Permintaan ke provider menggantung setelah berkas terkirim** (sejak nomor 43 di `FIXES.md`, ini sudah dibatasi). `kirimMultipart()` mengirim badan multipart lalu menunggu jawaban; kalau Telegram menerima seluruh berkas tetapi jawabannya tidak pernah datang (soket mati tanpa FIN, `api.telegram.org` tersendat dari VPS), permintaan dulu menggantung tanpa batas waktu dan tidak mencatat apa pun — Cloudflare memutus klien di **100 detik** (`524`, atau `499` di log Nginx), berkas sudah ada di channel, baris database tidak pernah dibuat. Sekarang soket punya batas inaktivitas (`UPLOAD_IDLE_TIMEOUT_MS`, default 95000 ms) sehingga permintaan dijawab `502` dan dicatat sebagai `[upload] telegram gagal setelah 63.4s (namafile.mp4, 5298094 byte): Provider tidak menjawab ...` di `pm2 logs gutok-drive --err`. Angka `setelah Xs` itu yang menentukan diagnosa: kalau mendekati 60 detik, waktu tunggu Telegram yang kurang (nomor 45 di `FIXES.md` — pastikan `proxy_read_timeout` Nginx juga sudah 3600, kalau tidak yang menjawab 502 adalah Nginx dan aplikasi tidak sempat mencatat apa pun); kalau mendekati 95 detik, batas aplikasi yang perlu dinaikkan atau berkasnya perlu lewat domain DNS-only. Batas ini hanya berlaku untuk soket yang diam; unggahan besar yang datanya terus mengalir tidak terpengaruh.
2. **Batas 100 detik Cloudflare pada paket gratis** (unggahan besar yang memang lambat, mis. puluhan MB dari ponsel). `proxy_request_buffering off` di Nginx (dipasang `vps-nginx.sh`) memangkas waktu yang terbuang sebelum unggahan diteruskan, tetapi total waktu masih bisa lewat.

Periksa berurutan:

```bash
sudo grep -E 'POST /api/files' /var/log/nginx/access.log | tail -5   # 499/524 = permintaan mati di tengah jalan, 502 = provider gagal
pm2 logs gutok-drive --lines 30 --nostream --err                    # '[upload] telegram gagal ...' = sebab nomor 1
sqlite3 /var/www/gutok-drive/data/mydrive.sqlite "SELECT name, size, uploaded_at FROM files ORDER BY uploaded_at DESC LIMIT 5;"
ls -la /var/www/gutok-drive/data/tmp                                # berkas sisa = proses mati saat upload, bukan selesai dengan galat
```

Kalau barisnya tidak ada padahal berkasnya ada di Telegram: berkas itu tidak bisa dipulihkan (id-nya hanya ada di jawaban yang hilang), jadi hapus dari channel lalu unggah ulang — lewat subdomain DNS-only (tanpa proxy Cloudflare) atau dengan berkas yang lebih kecil.

### Audio/video terupload tetapi tidak bisa diputar di preview

Ada dua sebab yang berbeda.

1. **Container-nya memang tidak didukung browser** (`.mkv`, `.avi`, `.opus`): preview menampilkan pesan + tombol download, bukan pemutar kosong, karena `canPlayType()` diperiksa lebih dulu. Ubah ke MP4 (video) atau MP3 (audio) kalau ingin diputar langsung.
2. **Server tidak melayani `Range`**: pemutar butuh `206 Partial Content` (Safari menolak memutar media tanpanya) dan menggeser posisi putar butuh `Accept-Ranges`. Ini ditangani `sendRemoteFile` dan dijaga `node uji/server-lambat.mjs`. Jawaban rusak yang terlanjur tersimpan di cache Cloudflare masih bisa tersangkut — purge URL berkasnya kalau gejalanya bertahan setelah deploy.

### Perubahan CSS/JS tidak terlihat setelah deploy

Cloudflare menimpa Cache-Control aset statis dengan Browser Cache TTL miliknya (terukur: `no-cache` pun berakhir jadi `max-age=14400`), jadi browser bisa memakai CSS/JS lama sampai 4 jam setelah deploy — gejalanya menyesatkan, misalnya "Owner control terbuka sebentar lalu kembali ke Semua file", "menu Owner control mati", atau "bilah storage kosong" walau berkas di server sudah benar. Karena itu `server.js` mengirim `no-store` untuk `/app.js`, `/js/*.js`, `/styles/*.css`, dan `index.html` — satu-satunya direktif yang menurut tabel direktif Cloudflare membuat browser tidak menyimpan salinan sama sekali, sedangkan `no-cache` hanya menyuruh memvalidasi ulang lewat ETag (304) dan tetap ditimpa oleh Browser Cache TTL. Gambar tetap boleh di-cache 1 hari.

Sesudah deploy, pastikan header yang diterima browser sudah benar:

```bash
curl -sI https://gutokdrive.world/js/views/admin.js | grep -i cache-control   # harus `no-store`
```

Kalau masih `max-age=14400`, yang memaksa adalah Cache Rule Cloudflare: Caching -> Configuration -> Browser Cache TTL = "Respect Existing Headers", lalu Purge Everything. Untuk membandingkan berkas yang dikirim server dengan yang ada di repo:

```bash
curl -s https://gutokdrive.world/js/views/admin.js | md5sum - ; md5sum assets/js/views/admin.js   # harus sama
```

Kalau `md5sum`-nya sama tetapi gejalanya bertahan, penyebabnya cache browser — Ctrl+Shift+R (atau mode incognito) satu kali, lalu muat ulang normal.

```bash
curl -s https://gutokdrive.world/styles/components.css | grep -c storage-meter   # 1 = versi baru
```

### Tombol dashboard tidak bereaksi (Owner control, Upload file, Sampah, logout)

Gejala: halaman dashboard tampil normal, tapi semua tombol di dalamnya diam — tidak ada pesan error apa pun. Ini pernah terjadi karena `bindDashboard()` tetap ada di daftar impor `assets/app.js` tetapi tidak pernah dipanggil setelah refactor modul (commit `a2374c7`). Setelah itu `bindDashboard()` diberi penjaga (`if (!document.querySelector('#upload-trigger')) return;`) supaya aman dipanggil di layar lain. Untuk memastikan rilis di VPS memuat perbaikannya:

```bash
cd /var/www/gutok-drive && grep -c 'bindDashboard()' assets/app.js   # harus 1
```

`uji/ikatan.mjs` (bagian dari `npm run uji`) sekarang menolak dua bentuk kesalahan itu: impor `bind*`/`render*` yang tidak pernah dipakai dan `querySelector('#id')` yang tidak punya elemen `id="id"` di markup mana pun.

### Port 3000 sudah dipakai

```bash
ss -ltnp | grep 3000
pm2 status
```

Hentikan proses lama melalui PM2, atau ubah `PORT` di `ecosystem.config.cjs` dan reverse proxy secara bersamaan.

### Login ditolak karena akses dicabut

Gejala: user memasukkan identitas/password yang benar tetapi selalu dijawab `Identitas atau password salah.` dan halaman langsung kembali ke login.

- Ini bukan bug: owner mencabut aksesnya (status akun `suspended`). Minta owner membuka **Owner control → Member** dan menekan **Pulihkan akses**.
- Cek cepat di VPS: `sqlite3 data/mydrive.sqlite "SELECT username, status FROM users;"` — akun yang `suspended` tidak bisa login dan sesinya sudah dihapus.
- Mencabut akses juga memutus sesi yang sedang berjalan; user cukup **Ctrl+Shift+R** sekali kalau halaman lamanya masih menampilkan data sebelum sesi berakhir.

## 12. Update dan Deploy Ulang

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

`deploy.sh` memanggil `update-code.sh` untuk urusan Git, lalu `npm ci --omit=dev`, `pm2 delete` + `pm2 start ecosystem.config.cjs`, `pm2 save`, dan terakhir menunggu `http://127.0.0.1:3000/api/setup` merespons. Script keluar dengan status gagal kalau aplikasi tidak hidup, jadi log PM2 yang ikut ditampilkan bisa langsung diperiksa. Kalau ada langkah yang gagal — misalnya `git merge --ff-only` ditolak karena VPS punya commit lokal — `deploy.sh` menyalakan ulang aplikasi dengan kode yang ada sekarang, mencetak lokasi backup, lalu menyuruh menjalankan ulang, sehingga deploy yang gagal tidak pernah berakhir dengan situs mati. Folder `data/`, `storage/`, dan `data/tmp/` dibuat lebih dulu sebelum backup karena `tar` gagal kalau `data/` belum ada.

Setelah aplikasi hidup, `deploy.sh` juga mengerjakan dua hal yang dulu jadi langkah manual: memastikan konfigurasi Nginx lengkap — ketiga direktif dari `vps-nginx.sh` dicek (`client_max_body_size`, `gzip on`, `proxy_request_buffering off`), karena `client_max_body_size` saja tidak cukup: upload >1 MB tetap 413 tanpa yang pertama, aset tidak dikompres tanpa gzip, dan Nginx menulis ulang seluruh upload ke disk sebelum diteruskan tanpa `proxy_request_buffering off`. `vps-nginx.sh` dijalankan otomatis kalau salah satu belum ada dan `sudo` bisa tanpa sandi; kalau tidak, perintahnya dicetak supaya tinggal disalin — lalu merapikan VPS (`bersih-vps.sh`). Rapikan bisa dimatikan dengan `RAPIKAN=0 bash deploy.sh`.

Saat dijalankan, `deploy.sh`/`redeploy.sh` lebih dulu menyalin dirinya ke `/tmp` lalu menjalankan salinan itu (`exec bash "$SALINAN_DEPLOY"`). Alasannya konkret: kedua script menarik kode dengan `git pull`, sehingga file script-nya sendiri ikut tertulis ulang **saat sedang berjalan**, sedangkan bash membaca script per-offset byte. Tanpa salinan tetap, sisa script bisa tereksekusi dalam campuran versi lama dan baru — pernah terjadi: verifikasi heap di deploy pertama masih memakai versi lama dan mencetak peringatan palsu `!! Proses berjalan tanpa flag heap` padahal batas heap aktif. Kalau kamu memanggil script ini dari alat lain (misalnya `nohup`/`setsid`), pola itu tetap berlaku: yang penting yang dipanggil adalah `bash deploy.sh`.

`update-code.sh` perlu ada karena `setup.sh` menyuntik `STORAGE_CONFIG_KEY` asli ke `ecosystem.config.cjs`, padahal file itu dilacak Git. Tanpa script itu `git pull` ditolak dengan `Your local changes to the following files would be overwritten by merge`. Sekarang nilai secret diamankan lebih dulu (dari `.env`, cadangannya dari file itu sendiri), file dikembalikan ke versi repo, kode ditarik dengan `git merge --ff-only`, lalu secret disuntik ulang. Kalau `git merge --ff-only` gagal (misalnya VPS punya commit lokal sendiri), script berhenti dengan error tanpa mengubah kode, dan `ecosystem.config.cjs` tetap disuntik secret yang benar supaya restart manual tidak merusak kredensial provider. Perlakuan yang sama diberikan pada file runtime SQLite (`data/mydrive.sqlite*`) yang masih dilacak rilis lama: isinya disisihkan dan dipulihkan kembali, karena rilis terbaru menghapus file itu dari Git dan tanpa penanganan ini database produksi ikut terhapus. `redeploy.sh` adalah versi ringkas tanpa backup untuk VPS yang projectnya ada di `~/drivegutok` dan memakai `update-code.sh` yang sama.

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

### Deploy berhenti karena `data/mydrive.sqlite-wal` (merge ditolak)

Gejalanya: `bash deploy.sh` berhenti dengan

```
error: Your local changes to the following files would be overwritten by merge:
        data/mydrive.sqlite
        data/mydrive.sqlite-shm
        data/mydrive.sqlite-wal
```

Rilis lama ikut melacak file runtime SQLite. Selama masih dilacak, isinya berubah setiap aplikasi berjalan, jadi `git merge --ff-only` selalu ditolak dan kode di VPS tetap versi lama (efek lanjutannya: fitur baru tidak muncul, lihat bagian sebelumnya). Rilis terbaru sudah berhenti melacaknya dan `.gitignore` menutup folder `data/`, tetapi perubahannya berupa **penghapusan file** — kalau fetch/merge dipaksa dengan `git reset --hard` atau `git clean`, database produksi bisa ikut hilang. Karena itu `update-code.sh` sekarang menangani khusus file ini: isinya disalin ke folder sementara, file di working tree dikembalikan ke versi repo (hanya supaya merge bisa jalan), merge dijalankan, lalu isi aslinya dipulihkan sebelum script selesai — juga saat deploy gagal. Aplikasi wajib berhenti selama langkah itu, dan `deploy.sh`/`redeploy.sh` sudah mematikan PM2 lebih dulu.

Jalan tercepat — satu perintah yang mengerjakan semuanya (tarik kode, deploy, lalu memverifikasi commit, database, secret, `/api/setup`, dan PM2):

```bash
cd ~/drivegutok && git pull origin main && bash ~/drivegutok/perbaiki-vps.sh
```

Kalau `perbaiki-vps.sh` masih gagal (misalnya file lama yang tidak dilacak bikin merge ditolak), ada opsi **deploy bersih dari nol** — backup database + secret, hapus seluruh folder, clone fresh, restore, verifikasi:

```bash
cd ~/drivegutok && git pull origin main && bash ~/drivegutok/deploy-bersih.sh
```

`deploy-bersih.sh` aman untuk database: `data/`, `.env`, dan `STORAGE_CONFIG_KEY` disalin ke `/tmp` sebelum apa pun dihapus, dan dipulihkan setelah clone selesai. Kalau backup gagal, skrip berhenti tanpa menyentuh apa pun. Hasilnya sama: `[OK]`/`[GAGAL]` per pemeriksaan, exit code = jumlah kegagalan.

`perbaiki-vps.sh` mencetak `[OK]`/`[GAGAL]` untuk setiap pemeriksaan dan keluar dengan jumlah kegagalan (0 = sukses), sehingga hasilnya bisa langsung ditempel untuk ditelusuri kalau ada yang tidak lolos. Skrip ini juga mengulang sendiri prosesnya kalau ternyata versinya baru saja berubah setelah `git pull`. Kalau lebih suka langkah manual, urutannya sama dengan deploy biasa:

```bash
cd ~/drivegutok && git pull origin main   # ambil update-code.sh terbaru
bash ~/drivegutok/deploy.sh               # isi data/ otomatis diselamatkan
cd /var/www/gutok-drive && git log --oneline -1   # sudah commit terbaru?
```

Kalau `update-code.sh` di VPS masih versi lama, lakukan urutan manual ini (aplikasi dalam keadaan berhenti dulu: `pm2 stop gutok-drive`):

```bash
cd /var/www/gutok-drive
mkdir -p ~/cadangan-db && cp -p data/mydrive.sqlite* ~/cadangan-db/   # 1. amankan isi database
git checkout -- data/mydrive.sqlite data/mydrive.sqlite-wal data/mydrive.sqlite-shm
cp ~/drivegutok/update-code.sh . && bash deploy.sh                    # 2. tarik kode terbaru
cp -p ~/cadangan-db/mydrive.sqlite* data/                             # 3. pulihkan isi database
pm2 restart ecosystem.config.cjs --update-env && pm2 save             # 4. nyalakan ulang
```

Setelah kode terbaru terpasang sekali, `data/` tidak lagi dilacak Git sehingga kejadian ini tidak terulang. Isi `data/` juga selalu ikut dibackup oleh `deploy.sh` sebelum kode ditarik (`gutok-drive-backup-*.tar.gz`).

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

Untuk batas upload dan Nginx, `deploy.sh` sudah mengurusnya: kalau salah satu dari `client_max_body_size`, `gzip on`, atau `proxy_request_buffering off` belum ada di konfigurasi Nginx, dia menjalankan `vps-nginx.sh` (butuh `sudo` tanpa sandi; kalau tidak, perintahnya dicetak supaya tinggal disalin). Direktifnya diperiksa di tiga tempat — `sites-enabled`, `conf.d`, dan `nginx.conf` — supaya `gzip on` yang sudah ada di blok `http` tidak dianggap hilang; lokasinya bisa diganti lewat `NGINX_DIR`/`NGINX_CONF_D`/`NGINX_MAIN`. Menjalankannya manual juga boleh, kapan saja dan aman diulang:

```bash
sudo bash vps-nginx.sh
```

### Merapikan VPS (sisa file, backup lama, log)

VPS-nya 1 GB, jadi sisa file yang menumpuk bisa membuat upload gagal karena disk penuh (`data/tmp`) dan PM2/Nginx tidak bisa menulis log. `bash deploy.sh` sudah memanggil `bersih-vps.sh` di akhir, dan script itu bisa dijalankan sendiri kapan saja:

```bash
bash bersih-vps.sh                 # hapus sisa file
DRY=1 bash bersih-vps.sh           # pratinjau: cetak rencananya saja, tidak menghapus apa pun
sudo bash bersih-vps.sh            # sekalian memasang logrotate untuk log PM2
HAPUS_CLONE=1 bash bersih-vps.sh   # ikut menghapus klon lama ~/drivegutok (permanen)
```

Yang dibuang: arsip `gutok-drive-backup-*.tar.gz` (disisakan 3 terbaru), salinan `deploy.sh`/`redeploy.sh` dan log uji yang tertinggal di `/tmp` (lebih tua dari 24 jam, hanya milik user yang menjalankan), upload batal di `data/tmp`, cadangan konfigurasi Nginx `*.bak-*` (disisakan yang terbaru), cache npm `~/.npm/_cacache`, dan objek `.git` yang tidak terpakai (`git gc`). Yang **tidak pernah** disentuh: `data/mydrive.sqlite*`, `storage/`, `.env`, `ecosystem.config.cjs`, dan kode aplikasi. Upload yang sedang berjalan juga aman karena hanya berkas di atas 24 jam yang dihapus, dan klon lama `~/drivegutok` hanya dilaporkan ukurannya — menghapusnya perlu `HAPUS_CLONE=1` karena permanen.

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
