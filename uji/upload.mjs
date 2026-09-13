// Uji batas waktu permintaan di assets/app.js.
// Upload memakai FormData dan bisa memakan menit (file puluhan MB lewat Cloudflare/Nginx),
// jadi TIDAK boleh memakai batas 15 detik milik request JSON biasa.
// Bug lama: semua request dibatalkan setelah 15 detik -> upload 2-50 MB gagal
// dengan pesan "Server terlalu lama merespons" dan file tidak pernah masuk.
import fs from 'node:fs';

const berkas = new URL('../assets/app.js', import.meta.url);
const uji = new URL('../assets/.probe-upload.mjs', import.meta.url);
fs.writeFileSync(uji, `${fs.readFileSync(berkas, 'utf8')}\nglobalThis.__api = api;\n`);

const el = new Proxy(function () {}, { get: () => el, set: () => true, apply: () => el, has: () => true });
for (const nama of ['document', 'window', 'location', 'localStorage', 'sessionStorage', 'navigator', 'lucide', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt', 'history', 'screen', 'requestAnimationFrame', 'cancelAnimationFrame', 'FileReader', 'Image', 'XMLHttpRequest', 'ClipboardItem']) globalThis[nama] = el;
globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => ({}) });
process.on('unhandledRejection', () => {});

let batas = [];
const setTimeoutAsli = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...sisa) => { batas.push(ms); return 0; };
globalThis.clearTimeout = () => {};
void setTimeoutAsli;

let gagal = 0;
const cek = (keterangan, syarat) => { if (syarat) console.log(`  ok  ${keterangan}`); else { console.error(`  GAGAL  ${keterangan}`); gagal += 1; } };

try {
  await import(uji);
  const api = globalThis.__api;
  if (typeof api !== 'function') throw new Error('api() tidak ada di lingkup modul assets/app.js');

  batas = [];
  await api('/api/setup').catch(() => {});
  cek('JSON request dibatasi 15000 ms', batas.includes(15000));

  batas = [];
  await api('/api/files', { method: 'POST', body: new FormData() }).catch(() => {});
  cek('upload FormData tidak dibatasi 15000 ms', !batas.includes(15000));
  cek('upload FormData dibatasi 1800000 ms', batas.includes(30 * 60 * 1000));

  console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
  process.exitCode = gagal ? 1 : 0;
} finally {
  fs.rmSync(uji, { force: true });
}
