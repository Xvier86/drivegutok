// Uji lingkup assets/app.js lewat evaluasi modul + probe `typeof`.
// Kurung } yang hilang pernah membuat renderTrash/bindTrashView/emptyTrash
// tersarang di dalam fungsi lain, sehingga klik Sampah error "renderTrash is not defined"
// padahal `node --check` tetap lolos (kurung seimbang karena ada } nyasar di akhir berkas).
import fs from 'node:fs';

const WAJIB = ['start', 'renderDashboard', 'bindDashboard', 'renderAdmin', 'bindTrashView', 'renderTrash', 'emptyTrash', 'toggleCdn'];
const src = fs.readFileSync(new URL('./assets/app.js', import.meta.url), 'utf8');
const temp = `/tmp/uji-lingkup-app-${process.pid}.mjs`;
fs.writeFileSync(temp, `${src}\nglobalThis.__cek = { ${WAJIB.map((nama) => `'${nama}': typeof ${nama}`).join(', ')} };\n`);

const el = new Proxy(function () {}, { get: () => el, set: () => true, apply: () => el, has: () => true });
for (const nama of ['document', 'window', 'location', 'localStorage', 'sessionStorage', 'navigator', 'lucide', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt', 'history', 'screen', 'requestAnimationFrame', 'cancelAnimationFrame', 'FileReader', 'Image', 'XMLHttpRequest', 'ClipboardItem']) globalThis[nama] = el;
globalThis.fetch = async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '', headers: new Map() });
process.on('unhandledRejection', () => {});

try {
  await import(temp);
  const kurang = WAJIB.filter((nama) => globalThis.__cek?.[nama] !== 'function');
  if (kurang.length) {
    console.error(`GAGAL: ${kurang.join(', ')} tidak ada di lingkup modul (kurung } hilang?).`);
    process.exitCode = 1;
  } else {
    console.log('Semua uji lulus.');
  }
} finally {
  fs.rmSync(temp, { force: true });
}
