// Uji gaya: setiap kelas yang dipakai JS wajib punya aturan di assets/styles/*.css,
// tidak boleh ada inline style statis (hanya lebar progress yang dinamis), setiap nama ikon harus
// ada di assets/js/ikon.js, dan assets/index.html tidak boleh memuat skrip pihak ketiga.
// Bug lama: tombol Owner control memakai var(--yellow) yang tidak pernah ada di CSS.
import fs from 'node:fs';

// Akar repo (folder induk uji/) supaya uji bisa dijalankan dari folder mana pun.
const akar = new URL('../', import.meta.url);
const baca = (rel) => fs.readFileSync(new URL(rel, akar), 'utf8');
const daftar = (rel) => fs.readdirSync(new URL(rel, akar)).map((f) => `${rel}/${f}`);

const berkasJs = ['assets/app.js', ...daftar('assets/js').filter((f) => f.endsWith('.js')), ...daftar('assets/js/views').filter((f) => f.endsWith('.js'))];
const berkasCss = daftar('assets/styles');

// Kelas penanda aksi/keadaan: sengaja tanpa aturan sendiri (gaya ikut .icon-btn/.file-card).
const PENANDA = /^(on|active|drag|show|folder|danger|member-view|view-enter)$|^(file|folder|provider|trash)-(view|rename|move|delete|cdn|share|config|toggle|restore|purge)$/;

const dipakai = new Set();
// Buang ekspresi ${...} di dalam kelas supaya 'current'/'on'/'off' tidak dianggap kelas statis.
const bersih = (teks) => { let t = teks; for (let i = 0; i < 5 && t.includes('${'); i += 1) t = t.replace(/\$\{[^{}]*\}/g, ' '); return t; };
for (const berkas of berkasJs) {
  const src = baca(berkas);
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    for (const kelas of bersih(m[1]).split(/\s+/)) if (/^[a-z][a-z0-9-]*$/.test(kelas)) dipakai.add(kelas);
  }
}

const bergaya = new Set();
for (const berkas of berkasCss) {
  const src = baca(berkas).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of src.matchAll(/\.([a-zA-Z][\w-]*)/g)) bergaya.add(m[1]);
}

let gagal = 0;
const cek = (keterangan, syarat) => { if (syarat) console.log(`  ok  ${keterangan}`); else { console.error(`  GAGAL  ${keterangan}`); gagal += 1; } };

const tanpaGaya = [...dipakai].filter((kelas) => !bergaya.has(kelas) && !PENANDA.test(kelas)).sort();
cek(`semua kelas punya aturan CSS (${dipakai.size} kelas dipakai)`, tanpaGaya.length === 0);
if (tanpaGaya.length) console.error(`        tanpa aturan: ${tanpaGaya.join(', ')}`);

const inline = [];
for (const berkas of berkasJs) {
  for (const m of baca(berkas).matchAll(/style="([^"]*)"/g)) if (!m[1].includes('${')) inline.push(`${berkas}: ${m[1]}`);
}
cek('tidak ada inline style statis', inline.length === 0);
inline.forEach((baris) => console.error(`        ${baris}`));

// Struktur CSS: kurung seimbang dan tidak ada selector bersarang di dalam blok deklarasi.
// Bug nyata: `.card-actions {` lupa ditutup di components.css, sehingga `.provider`, `.stats`,
// `.progress`, `.modal-backdrop`, `.toast`, `.loading-overlay`, dan `.admin-card` semuanya
// menjadi nested rule — hanya berlaku di dalam `.card-actions`, dan browser yang tidak mendukung
// CSS nesting membuangnya seluruhnya. Akibatnya modal Owner control tampil tanpa overlay (tombol
// konfigurasi/invite seolah tidak bisa dipakai) dan bilah provider di dashboard tidak terlihat.
const rusak = [];
for (const berkas of berkasCss) {
  let kedalaman = 0;
  for (const [index, baris] of baca(berkas).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').entries()) {
    const teks = baris.trim();
    if (kedalaman > 0 && /^\S[^{}]*\{\s*$/.test(teks) && !teks.startsWith('@')) rusak.push(`${berkas}:${index + 1} selector bersarang: ${teks}`);
    kedalaman += (baris.match(/\{/g) || []).length - (baris.match(/\}/g) || []).length;
  }
  if (kedalaman !== 0) rusak.push(`${berkas}: kurung tidak seimbang (${kedalaman})`);
}
cek('struktur CSS: kurung seimbang dan tanpa selector bersarang', rusak.length === 0);
rusak.forEach((baris) => console.error(`        ${baris}`));

// Bilah storage wajib tumbuh (bukan muncul mendadak). Dipakai .storage-seg dan .progress span.
cek('keyframes tumbuh untuk bilah storage ada', berkasCss.some((berkas) => /@keyframes\s+tumbuh\s*\{/.test(baca(berkas))));

const token = new Set([...berkasCss.map((berkas) => baca(berkas)).join('\n').matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const dipakaiToken = new Set();
for (const berkas of [...berkasJs, ...berkasCss]) {
  for (const m of baca(berkas).matchAll(/var\(--([a-z0-9-]+)/g)) dipakaiToken.add(m[1]);
}
const tokenHilang = [...dipakaiToken].filter((nama) => !token.has(nama)).sort();
cek('semua var(--token) terdefinisi', tokenHilang.length === 0);
if (tokenHilang.length) console.error(`        token hilang: ${tokenHilang.join(', ')}`);

// Ikon: nama yang dipanggil icon('...') harus ada di peta ikon.js, karena nama yang salah hanya
// menghasilkan SVG kosong (tombol tanpa ikon) tanpa error apa pun di browser.
const petaIkon = new Set([...baca('assets/js/ikon.js').matchAll(/^\s+'([a-z0-9-]+)':/gm)].map((m) => m[1]));
const dipakaiIkon = new Set();
for (const berkas of [...berkasJs, ...berkasCss]) {
  for (const m of baca(berkas).matchAll(/icon\(['"]([a-z0-9-]+)['"]/g)) dipakaiIkon.add(m[1]);
}
const ikonHilang = [...dipakaiIkon].filter((nama) => !petaIkon.has(nama)).sort();
cek(`semua nama ikon terdaftar di ikon.js (${dipakaiIkon.size} ikon dipakai)`, ikonHilang.length === 0);
if (ikonHilang.length) console.error(`        ikon hilang: ${ikonHilang.join(', ')}`);

const halaman = baca('assets/index.html');
const skripLuar = [...halaman.matchAll(/<script[^>]+src="(https?:[^"]+)"/g)].map((m) => m[1]);
cek('index.html tidak memuat skrip pihak ketiga', skripLuar.length === 0);
if (skripLuar.length) console.error(`        skrip luar: ${skripLuar.join(', ')}`);

console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
