// Uji ikatan: fungsi tampilan yang diimpor app.js WAJIB benar-benar dipanggil, dan setiap
// `querySelector('#id')` di kode tampilan WAJIB punya elemen `id="id"` di suatu markup.
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

console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
