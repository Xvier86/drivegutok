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
const badanRender = sumberFiles.slice(sumberFiles.indexOf('export async function renderDashboard'), sumberFiles.indexOf('// Ikatan tombol dipasang satu kali saja'));
cek('renderDashboard tidak memasang ikatan tombol sendiri', badanRender.length > 0 && !/bindDashboard\(\)/.test(badanRender));

// 4) bindCdnUpload() menyisipkan tombol ke `.action-row` pertama yang ditemukan, dan header Owner
// control juga memakai kelas itu — tanpa penjaga #dropzone, tombol "Upload CDN (5 MB)" muncul di
// halaman Owner control.
const badanCdn = sumberFiles.slice(sumberFiles.indexOf('export function bindCdnUpload'), sumberFiles.indexOf('export function bindProviderPicker'));
cek('bindCdnUpload hanya menyisipkan tombol kalau ada #dropzone', badanCdn.includes('#dropzone'));

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

console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
