// Uji ikatan: fungsi tampilan yang diimpor app.js WAJIB benar-benar dipanggil; `querySelector('#id')` di kode tampilan
// WAJIB punya elemen `id="id"` di suatu markup; ikatan tombol dipasang SEKALI (dua pemanggilan bindDashboard() membuat
// satu klik Owner control menjalankan dua permintaan); dan tombol "Upload CDN" hanya disisipkan di layar dashboard.
//
// Kenapa perlu: commit a2374c7 memecah app.js jadi modul, tetapi `bindDashboard()` tertinggal di
// daftar impor saja — tidak pernah dipanggil. Akibatnya seluruh tombol dashboard mati TANPA
// pesan apa pun: Upload file, Owner control, Sampah, logout, dan breadcrumb folder tidak
// bereaksi. Tidak ada satu pun uji lama yang menangkapnya karena uji layar memanggil bindDashboard
// langsung, bukan lewat app.js. Penjaga kedua menangkap kebalikannya: `bindDashboard` mengikat
// `#dropzone` yang tidak ada di markup mana pun, jadi kalau bindDashboard akhirnya dipanggil,
// baris itu melempar TypeError dan sisa ikatan di bawahnya (Owner control, Sampah) tidak terpasang.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const akar = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const baca = (relatif) => fs.readFileSync(path.join(akar, relatif), 'utf8');
const daftar = (direktori) => fs.readdirSync(path.join(akar, direktori), { withFileTypes: true }).flatMap((entri) => entri.isDirectory() ? daftar(path.join(direktori, entri.name)) : [path.join(direktori, entri.name)]);
const berkasTampilan = ['assets/app.js', ...daftar('assets/js')];
const seluruhAset = [...berkasTampilan, 'assets/index.html'];

let gagal = 0;
const cek = (keterangan, syarat) => { if (syarat) console.log(`  ok  ${keterangan}`); else { console.error(`  GAGAL  ${keterangan}`); gagal += 1; } };

// 1) Setiap impor bind*/render* di app.js harus dipanggil (impor yang tidak dipakai = ikatan hilang).
const sumberApp = baca('assets/app.js');
const badan = sumberApp.replace(/^import .*$/gm, '');
const terimpor = [...sumberApp.matchAll(/import \{([^}]+)\}/g)].flatMap((cocok) => cocok[1].split(',').map((nama) => nama.trim())).filter((nama) => /^(bind|render)/.test(nama));
cek('app.js mengimpor bind*/render*', terimpor.length >= 3);
for (const nama of terimpor) {
  cek(`${nama} dipakai di app.js`, new RegExp(`\\b${nama}\\b`).test(badan));
}

// 2) Setiap selector #id di kode tampilan harus ada di salah satu markup (JS/inline HTML).
const idTersedia = new Set(seluruhAset.flatMap((berkas) => [...baca(berkas).matchAll(/id="([\w-]+)"/g)].map((cocok) => cocok[1])));
let selector = 0;
for (const berkas of berkasTampilan) {
  for (const cocok of baca(berkas).matchAll(/querySelector(?:All)?\(\s*'#([\w-]+)'/g)) {
    selector += 1;
    cek(`${berkas} ${cocok[0]} punya id="${cocok[1]}" di markup`, idTersedia.has(cocok[1]));
  }
}
cek('selector #id kode tampilan dipindai', selector >= 20);

// 3) Satu ikatan per tombol. renderDashboard() dulu memanggil bindDashboard() sendiri padahal app.js
// sudah memanggilnya lewat peristiwa 'layar-siap' setelah setiap render, jadi #admin-view/#admin-card/
// #trash-view punya dua listener: satu klik Owner control = dua kali GET /api/admin/overview
// (dibuktikan di browser tiruan jsdom, 2 panggilan sebelum perbaikan, 1 sesudahnya).
const sumberFiles = baca('assets/js/views/files.js');
const sumberCore = baca('assets/js/core.js');
const badanRender = sumberFiles.slice(sumberFiles.indexOf('export async function renderDashboard'), sumberFiles.indexOf('// Ikatan tombol dipasang satu kali saja'));
cek('renderDashboard tidak memasang ikatan tombol sendiri', badanRender.length > 0 && !/bindDashboard\(\)/.test(badanRender));

// 4) bindCdnUpload() menyisipkan tombol ke `.action-row` pertama yang ditemukan, dan header Owner
// control juga memakai kelas itu — tanpa penjaga #dropzone, tombol "Upload CDN (5 MB)" muncul di
// halaman Owner control.
const badanCdn = sumberFiles.slice(sumberFiles.indexOf('export function bindCdnUpload'), sumberFiles.indexOf('export function bindProviderPicker'));
cek('bindCdnUpload hanya menyisipkan tombol kalau ada #dropzone', badanCdn.includes('#dropzone'));

// 4b) Dropdown "Provider upload" hanya untuk Owner. Elemen tersembunyi bukan pengaman (member tetap
// bisa mengirim multipart langsung ke API), tapi kalau penjaga ini hilang, member melihat pilihan
// provider yang tidak berpengaruh apa pun pada unggahannya. Sisi server diuji terpisah di
// uji/peran-provider.mjs: `providerId` dari selain owner diabaikan, bukan dipercaya.
const badanPicker = sumberFiles.slice(sumberFiles.indexOf('export function bindProviderPicker'), sumberFiles.indexOf('export function bindUploadOptions'));
cek('bindProviderPicker berhenti untuk role selain owner', badanPicker.length > 0 && /state\.user\?\.role !== 'owner'/.test(badanPicker));

// 5) Cabut akses member. Tombol "Cabut akses" hanya berguna kalau dua bagian ini ada: endpoint
// owner-only di server, dan ikatan tombol di layar Owner control.
const sumberServer = baca('server.js');
cek('server.js punya PATCH /api/admin/users/:id', /app\.patch\('\/api\/admin\/users\/:id'/.test(sumberServer));
cek('endpoint cabut akses menolak akun owner', /target\.role === 'owner'/.test(sumberServer));
cek('endpoint cabut akses menghapus sesi aktif', /DELETE FROM sessions WHERE user_id = \?/.test(sumberServer));
const sumberAdmin = baca('assets/js/views/admin.js');
cek('admin.js mengikat tombol .member-access', /querySelectorAll\('\.member-access'\)\.forEach/.test(sumberAdmin));
cek('admin.js memanggil PATCH /api/admin/users/<id>', /api\/admin\/users\/\$\{button\.dataset\.member\}/.test(sumberAdmin));

// 6) Tab File/CDN: ikatan pengalih tab harus ada, kalau tidak tab tidak bisa ditekan sama sekali.
cek('files.js mengikat pengalih tab File/CDN', /querySelectorAll\('\.tab'\)\.forEach/.test(sumberFiles) && /setAttribute\('data-tab', state\.tab\)/.test(sumberFiles));

// 7) Widget penyimpanan: rincian per provider sudah dihapus dari dashboard, dan animasi masuknya
// dijaga flag modul — satu kali per page-load. Tanpa flag itu, setiap render ulang (pindah folder)
// memutar lagi hitungan naik dan nyala segmen: gerakan berulang tanpa alasan.
cek('markup dashboard tidak lagi merender baris per provider', !/storage-item|storage-seg|class="progress|provider-mini/.test(badanRender));
cek('bindDashboard memanggil animateStorage()', /animateStorage\(\);/.test(sumberFiles));
cek('animasi meter dikunci sekali per page-load', /let storageDimainkan = false/.test(sumberFiles) && /storageDimainkan = true/.test(sumberFiles));

// 8) Bilah unggah per baris. Hanya XMLHttpRequest yang memberi xhr.upload.onprogress — satu-satunya
// sumber byte terkirim — jadi tanpa XHR bilah dan kecepatan mustahil ditampilkan. Kecepatannya wajib
// delta byte/delta waktu antar-event (`event.loaded - byteLalu`), bukan rata-rata sejak awal: angka
// rata-rata terus naik walau jaringan melambat, jadi macetnya tidak kelihatan.
const badanUnggah = sumberFiles.slice(sumberFiles.indexOf('function unggahXhr'), sumberFiles.indexOf('export async function uploadCdnFiles'));
cek('unggah file memakai XMLHttpRequest', /new XMLHttpRequest\(\)/.test(badanUnggah));
cek('bilah unggah mengikuti xhr.upload.onprogress', /xhr\.upload\.onprogress = /.test(badanUnggah));
cek('kecepatan dari delta byte antar-event, bukan rata-rata', /event\.loaded - byteLalu/.test(badanUnggah) && !/event\.loaded \/ \(kini - mulai\)/.test(badanUnggah));
cek('baris unggah memakai kelas is-uploading', /file-card is-uploading/.test(badanUnggah));
cek('selesai -> badge sebentar -> render ulang', /classList\.replace\('is-uploading', 'is-selesai'\)/.test(badanUnggah) && /1800/.test(badanUnggah));
cek('unggahan tidak lagi memakai lapisan pemuatan', !/showLoading\('Upload file/.test(badanUnggah));
cek('unggahan gagal membuang barisnya', /baris\?\.remove\(\)/.test(badanUnggah));

// 9) Hapus file: animasi keluar dulu, DELETE kemudian. Kalau API gagal, kelas `removing` dicabut —
// tanpa itu baris yang gagal dihapus tetap tembus pandang dan tidak bisa diklik lagi.
const badanHapus = sumberFiles.slice(sumberFiles.indexOf('const tungguAnimasi'), sumberFiles.indexOf('export async function renameFolder'));
cek('hapus menunggu animationend sebelum memanggil API', /addEventListener\('animationend'/.test(badanHapus) && badanHapus.indexOf('tungguAnimasi(baris)') < badanHapus.indexOf("method:'DELETE'"));
cek('animationend punya batas waktu kalau tidak pernah datang', /setTimeout\(lanjut, batasMs\)/.test(badanHapus));
cek('kelas removing dicabut saat API gagal', /classList\.remove\('removing'\)/.test(badanHapus));
cek('tombol .file-delete tetap terikat', /querySelectorAll\('\.file-delete'\)\.forEach/.test(sumberFiles));

// 10) Sidebar off-canvas. Tombol hamburger dan scrim disisipkan pasangDrawer(), bukan dirender oleh
// tiga markup view — kalau app.js berhenti memanggilnya, di panel <720px sidebar tidak punya pemicu
// sama sekali dan menu (Sampah, Owner control, Keluar) tidak bisa dijangkau.
cek('app.js memanggil pasangDrawer()', /pasangDrawer\(\)/.test(sumberApp));
cek('pasangDrawer menyisipkan tombol hamburger dan scrim', /id="drawer-toggle"/.test(sumberCore) && /id="drawer-scrim"/.test(sumberCore));
cek('tombol hamburger memakai ikon menu', /icon\('menu'\)/.test(sumberCore));
cek('keadaan drawer memakai kelas body is-drawer', /classList\.add\('is-drawer'\)/.test(sumberCore) && /classList\.remove\('is-drawer'\)/.test(sumberCore));
cek('aria-expanded ikut diperbarui', /setAttribute\('aria-expanded', 'true'\)/.test(sumberCore) && /setAttribute\('aria-expanded', 'false'\)/.test(sumberCore));
cek('Escape menutup drawer', /event\.key === 'Escape'/.test(sumberCore));

// 11) Pengaturan akun. Chip akun di header adalah satu-satunya jalan masuk ke halaman ini, jadi chip
// wajib elemen yang bisa diklik (dulu <div> — tidak bisa dijangkau Tab dan tidak bisa ditekan sama
// sekali), semua layar berheader wajib memakai chip yang sama, dan kliknya ditangani sekali di app.js
// (delegasi) supaya layar baru tidak perlu mengikat ulang. Sisi server diuji di uji/akun.mjs.
const sumberAkun = baca('assets/js/views/akun.js');
cek('chip akun dirender sebagai <button class="user-menu">', /<button class="user-menu"/.test(sumberAkun) && !/<div class="user-menu"/.test(sumberAkun));
cek('chip akun dipakai dashboard, Sampah, dan layar akun', /chipAkun\(\)/.test(sumberFiles) && /chipAkun\(\)/.test(baca('assets/js/views/trash.js')) && /chipAkun\(\)/.test(sumberAkun));
cek('app.js mendaftarkan rute.akun', /rute\.akun = renderAkun/.test(sumberApp));
cek('app.js memanggil bindAkun() tiap render', /bindAkun\(\)/.test(sumberApp.slice(sumberApp.indexOf('const pasangUlang'))));
cek('klik .user-menu membuka layar akun', /closest\('\.user-menu'\)[\s\S]{0,80}ke\('akun'\)/.test(sumberApp));
// #logout dulu diikat di dua tempat (bindDashboard + bindTrashView) dan tidak diikat sama sekali di
// layar akun. Sekarang satu handler delegasi di app.js, sehingga berlaku di semua layar.
cek('Keluar ditangani sekali (delegasi) di app.js', /closest\('#logout'\)/.test(sumberApp) && !/#logout/.test(sumberFiles) && !/#logout/.test(baca('assets/js/views/trash.js')));
cek('server.js punya PATCH /api/account/email dan /api/account/password', /app\.patch\('\/api\/account\/email', requireUser/.test(sumberServer) && /app\.patch\('\/api\/account\/password', requireUser/.test(sumberServer));
// Penjaga inti halaman ini: perubahan identitas akun TIDAK boleh diterima tanpa password saat ini.
// Dua endpoint = dua pemeriksaan; satu yang terlewat sudah cukup untuk pengambilalihan akun.
cek('kedua endpoint akun memeriksa password saat ini', (sumberServer.match(/passwordSaatIniSalah\(res\)/g) || []).length === 2 && /hash\(String\(req\.body\.currentPassword/.test(sumberServer));
cek('akun.js memakai endpoint email dan password', /'\/api\/account\/email', \{ method: 'PATCH'/.test(sumberAkun) && /'\/api\/account\/password', \{ method: 'PATCH'/.test(sumberAkun));
cek('akun.js menjelaskan status verifikasi dari balasan server', /data\.verificationRequired/.test(sumberAkun));


// 12) Login akun Google (OAuth) untuk provider Google Drive. Tiga penjaga: tombol konfigurasi harus
// membawa cara akses yang tersimpan (kalau tidak, modal selalu terbuka di mode service account dan
// satu kali Simpan menimpa akun Google yang sudah tersambung), server harus punya rute login dan
// callback-nya, dan callback tidak boleh mengandalkan cookie sesi — browser kembali dari
// accounts.google.com, jadi hanya state acak yang mengikatnya ke provider yang benar.
cek('baris provider mengirim authMode ke tombol konfigurasi', /data-auth="\$\{esc\(provider\.authMode/.test(sumberAdmin));
cek('modal konfigurasi menerima authMode tersimpan', /openProviderConfigModal\(button\.dataset\.provider, button\.dataset\.kind, button\.dataset\.auth\)/.test(sumberAdmin));
cek('modal Google punya pemilih cara akses dan tombol login', /id="gdrive-auth"/.test(sumberAdmin) && /id="google-login"/.test(sumberAdmin) && /#gdrive-oauth/.test(sumberAdmin));
cek('server.js punya rute login dan callback Google', /app\.get\('\/api\/admin\/providers\/:id\/google\/login'/.test(sumberServer) && /app\.get\('\/api\/admin\/providers\/:id\/google\/callback'/.test(sumberServer));
cek('callback Google memakai state acak, bukan cookie sesi', /googleLoginStates\.get\(state\)/.test(sumberServer) && /sesi\.providerId !== req\.params\.id/.test(sumberServer));
cek('access token OAuth dibuat dari refresh token', /grant_type: 'refresh_token'/.test(sumberServer) && /prompt', 'consent'/.test(sumberServer));
console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
