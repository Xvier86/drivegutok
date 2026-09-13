// Uji lingkup modul frontend.
// Bug lama: kurung } hilang membuat renderTrash dkk tersarang di dalam fungsi lain,
// sehingga klik Sampah error "renderTrash is not defined".
// Sekarang setiap fungsi kunci harus benar-benar ter-export, dan modul tidak boleh
// membentuk impor melingkar.
import fs from 'node:fs';
import path from 'node:path';

// Path aset selalu relatif ke akar repo, bukan ke folder uji/.
const akar = new URL('../', import.meta.url);

const BERKAS = [
  'assets/app.js',
  'assets/js/core.js',
  'assets/js/router.js',
  'assets/js/state.js',
  'assets/js/views/login.js',
  'assets/js/views/files.js',
  'assets/js/views/admin.js',
  'assets/js/views/trash.js',
];
const WAJIB = ['start', 'renderDashboard', 'bindDashboard', 'renderAdmin', 'bindTrashView', 'renderTrash', 'emptyTrash', 'toggleCdn', 'ke'];

let gagal = 0;
const cek = (keterangan, syarat) => { if (syarat) console.log(`  ok  ${keterangan}`); else { console.error(`  GAGAL  ${keterangan}`); gagal += 1; } };

// Deteksi impor melingkar antar modul aplikasi.
const impor = new Map();
for (const berkas of BERKAS) {
  const src = fs.readFileSync(new URL(berkas, akar), 'utf8');
  impor.set(berkas, [...src.matchAll(/^import[^']*'(\.[^']+)'/gm)]
    .map((m) => path.normalize(path.join(path.dirname(berkas), m[1])))
    .filter((tujuan) => BERKAS.includes(tujuan)));
}
const jejak = new Set();
const selesai = new Set();
const melingkar = [];
const telusuri = (berkas, rantai) => {
  if (selesai.has(berkas)) return;
  if (jejak.has(berkas)) { melingkar.push([...rantai, berkas].join(' -> ')); return; }
  jejak.add(berkas);
  for (const tujuan of impor.get(berkas) || []) telusuri(tujuan, [...rantai, berkas]);
  jejak.delete(berkas);
  selesai.add(berkas);
};
BERKAS.forEach((berkas) => telusuri(berkas, []));
cek('tidak ada impor melingkar antar modul', melingkar.length === 0);
melingkar.forEach((rute) => console.error(`        ${rute}`));

// DOM tiruan serba bisa (Proxy) supaya modul bisa dievaluasi di Node.
const el = new Proxy(function () {}, { get: () => el, set: () => true, apply: () => el, has: () => true, construct: () => el });
for (const nama of ['document', 'window', 'location', 'localStorage', 'sessionStorage', 'navigator', 'lucide', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt', 'history', 'screen', 'requestAnimationFrame', 'cancelAnimationFrame', 'FileReader', 'Image', 'XMLHttpRequest']) globalThis[nama] = el;
globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => ({ user: null }) });
process.on('unhandledRejection', () => {});

const lingkup = {};
for (const berkas of BERKAS) Object.assign(lingkup, await import(new URL(berkas, akar)));
for (const nama of WAJIB) cek(`${nama} ter-export`, typeof lingkup[nama] === 'function');

console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
