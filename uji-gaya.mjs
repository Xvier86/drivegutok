// Uji gaya: setiap kelas yang dipakai JS wajib punya aturan di assets/styles/*.css,
// dan tidak boleh ada inline style statis (hanya lebar progress yang dinamis).
// Bug lama: tombol Owner control memakai var(--yellow) yang tidak pernah ada di CSS.
import fs from 'node:fs';

const berkasJs = ['assets/app.js', ...fs.readdirSync('assets/js').filter((f) => f.endsWith('.js')).map((f) => `assets/js/${f}`), ...fs.readdirSync('assets/js/views').map((f) => `assets/js/views/${f}`)];
const berkasCss = fs.readdirSync('assets/styles').map((f) => `assets/styles/${f}`);

// Kelas penanda aksi/keadaan: sengaja tanpa aturan sendiri (gaya ikut .icon-btn/.file-card).
const PENANDA = /^(on|active|drag|show|folder|danger|member-view|view-enter)$|^(file|folder|provider|trash)-(view|rename|move|delete|cdn|share|config|toggle|restore|purge)$/;

const dipakai = new Set();
// Buang ekspresi ${...} di dalam kelas supaya 'current'/'on'/'off' tidak dianggap kelas statis.
const bersih = (teks) => { let t = teks; for (let i = 0; i < 5 && t.includes('${'); i += 1) t = t.replace(/\$\{[^{}]*\}/g, ' '); return t; };
for (const berkas of berkasJs) {
  const src = fs.readFileSync(berkas, 'utf8');
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    for (const kelas of bersih(m[1]).split(/\s+/)) if (/^[a-z][a-z0-9-]*$/.test(kelas)) dipakai.add(kelas);
  }
}

const bergaya = new Set();
for (const berkas of berkasCss) {
  const src = fs.readFileSync(berkas, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of src.matchAll(/\.([a-zA-Z][\w-]*)/g)) bergaya.add(m[1]);
}

let gagal = 0;
const cek = (keterangan, syarat) => { if (syarat) console.log(`  ok  ${keterangan}`); else { console.error(`  GAGAL  ${keterangan}`); gagal += 1; } };

const tanpaGaya = [...dipakai].filter((kelas) => !bergaya.has(kelas) && !PENANDA.test(kelas)).sort();
cek(`semua kelas punya aturan CSS (${dipakai.size} kelas dipakai)`, tanpaGaya.length === 0);
if (tanpaGaya.length) console.error(`        tanpa aturan: ${tanpaGaya.join(', ')}`);

const inline = [];
for (const berkas of berkasJs) {
  for (const m of fs.readFileSync(berkas, 'utf8').matchAll(/style="([^"]*)"/g)) if (!m[1].includes('${')) inline.push(`${berkas}: ${m[1]}`);
}
cek('tidak ada inline style statis', inline.length === 0);
inline.forEach((baris) => console.error(`        ${baris}`));

const token = new Set([...berkasCss.map((berkas) => fs.readFileSync(berkas, 'utf8')).join('\n').matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const dipakaiToken = new Set();
for (const berkas of [...berkasJs, ...berkasCss]) {
  for (const m of fs.readFileSync(berkas, 'utf8').matchAll(/var\(--([a-z0-9-]+)/g)) dipakaiToken.add(m[1]);
}
const tokenHilang = [...dipakaiToken].filter((nama) => !token.has(nama)).sort();
cek('semua var(--token) terdefinisi', tokenHilang.length === 0);
if (tokenHilang.length) console.error(`        token hilang: ${tokenHilang.join(', ')}`);

console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
