// Uji asap layar: panggil setiap render* dengan data tiruan.
// Tujuannya menangkap kesalahan lingkup/impor pada kode yang sudah dipindah ke modul
// (misalnya formatBytes dipakai di trash.js tapi belum diimpor) tanpa perlu browser.
import process from 'node:process';

// DOM tiruan serba bisa. #app menangkap innerHTML supaya isi tiap layar bisa diperiksa:
// kesalahan template (kelas hilang, ikon salah) tidak terlihat dari pemanggilan fungsi saja.
const el = new Proxy(function () {}, { get: () => el, set: () => true, apply: () => el, has: () => true, construct: () => el });
for (const nama of ['window', 'location', 'localStorage', 'sessionStorage', 'navigator', 'lucide', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt', 'history', 'screen', 'requestAnimationFrame', 'cancelAnimationFrame', 'FileReader', 'Image', 'XMLHttpRequest']) globalThis[nama] = el;
let layar = '';
const app = new Proxy({}, { get: (_t, kunci) => (kunci === 'innerHTML' ? layar : el), set: (_t, kunci, nilai) => { if (kunci === 'innerHTML') layar = nilai; return true; } });
globalThis.document = new Proxy(el, { get: (_t, kunci) => (kunci === 'querySelector' ? (pemilih) => (pemilih === '#app' ? app : el) : el) });
process.on('unhandledRejection', () => {});

const provider = { id: 'p1', name: 'Google Drive', kind: 'gdrive', enabled: 1, used_bytes: 1024, capacity_bytes: 2048, configured: true, missing: [] };
const file = { id: 'f1', name: 'laporan.pdf', mime_type: 'application/pdf', size: 2048, provider: 'p1', cdn_enabled: 0, cdn_slug: null, encrypted: 0, uploaded_at: '2026-09-13T00:00:00Z', deleted_at: '2026-09-13T00:00:00Z' };
// Satu berkas per jenis media: setiap cabang ikonMime() ikut dijalankan saat render, jadi nama ikon
// yang hilang atau impor yang tertinggal muncul sebagai kegagalan render, bukan kartu tanpa ikon.
// Satu di antaranya punya link CDN (cdn_enabled = 1) supaya baris tab "CDN" dan kelas .is-cdn
// benar-benar dirender di uji — pemisahan berkas CDN dan berkas biasa tidak lolos begitu saja.
const media = (id, name, mime_type, tambahan = {}) => ({ id, name, mime_type, size: 2048, provider: 'p1', cdn_enabled: 0, cdn_slug: null, encrypted: 0, uploaded_at: '2026-09-13T00:00:00Z', deleted_at: null, ...tambahan });
const mediaUji = [media('f2', 'foto.jpg', 'image/jpeg'), media('f3', 'lagu.mp3', 'audio/mpeg'), media('f4', 'klip.mp4', 'video/mp4'), media('f5', 'banner.png', 'image/png', { cdn_enabled: 1, cdn_slug: 'cdn-banner' })];
const folder = { id: 'd1', name: 'Dokumen', parent_id: null, depth: 0, deleted_at: '2026-09-13T00:00:00Z' };
const jawaban = {
  '/api/dashboard': { user: { id: 'u1', username: 'vier', role: 'owner' }, folderId: null, folders: [folder], files: [file, ...mediaUji], providers: [provider], stats: { bytes: 2048, files: 1 }, trashCount: 1, uptimeSeconds: 3600 },
  '/api/admin/overview': { providers: [provider], files: { count: 5, bytes: 2048 }, users: [{ id: 'u1', username: 'vier', email: 'a@b.c', role: 'owner', status: 'active', created_at: '2026-09-13T00:00:00Z' }, { id: 'u2', username: 'tamu', email: 't@b.c', role: 'user', status: 'suspended', created_at: '2026-09-13T00:00:00Z' }], logs: [{ action: 'upload', target_type: 'file', username: 'vier', created_at: '2026-09-13T00:00:00Z' }] },
  '/api/trash': { files: [file], folders: [folder], counts: { all: 2, files: 1, folders: 1 } },
};
globalThis.fetch = async (url) => ({ ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => jawaban[String(url).split('?')[0]] || {} });

const { rute } = await import('../assets/js/router.js');
const { state } = await import('../assets/js/state.js');
const files = await import('../assets/js/views/files.js');
const admin = await import('../assets/js/views/admin.js');
const trash = await import('../assets/js/views/trash.js');
const login = await import('../assets/js/views/login.js');

state.user = { id: 'u1', username: 'vier', role: 'owner' };
Object.assign(rute, { dashboard: files.renderDashboard, admin: admin.renderAdmin, trash: trash.renderTrash, login: login.renderLogin });

// Kelas penanda yang wajib ada di markup tiap layar. Dashboard memakai daftar baris ala Drive
// (tab pemisah File/CDN + penyimpanan ringkas di sidebar), Owner control memakai grid kartu
// provider/member dengan tombol cabut akses.
const WAJIB = {
  renderDashboard: ['storage-card', 'storage-bar', 'storage-seg', 'storage-item', '--seg:', 'progress', 'grid', 'provider-mini', 'file-list', 'tabs', 'is-cdn', 'data-tab="file"', 'tab-file', 'tab-cdn'],
  renderAdmin: ['provider-grid', 'member-grid', 'member-access', 'data-member'],
};
let gagal = 0;
const tangkapan = {};
// Bug lama: renderAdmin memasang `onclick = ke('dashboard')` tanpa dibungkus fungsi, jadi navigasi
// ke layar file ikut berjalan SAAT render — halaman Owner control langsung terlempar balik ke
// "Semua file". rute.dashboard diganti penghitung supaya pemanggilan diam-diam itu terlihat.
let pindahDasbor = 0;
const dasborAsli = rute.dashboard;
rute.dashboard = async () => { pindahDasbor += 1; };
for (const [nama, panggil] of [['renderDashboard', files.renderDashboard], ['bindDashboard', files.bindDashboard], ['renderTrash', trash.renderTrash], ['renderAdmin', admin.renderAdmin], ['renderLogin', login.renderLogin]]) {
  try { await panggil(); tangkapan[nama] = layar; console.log(`  ok  ${nama}`); } catch (error) { console.error(`  GAGAL  ${nama}: ${error.message}`); gagal += 1; }
}
rute.dashboard = dasborAsli;
if (pindahDasbor) { console.error(`  GAGAL  renderAdmin langsung kembali ke "Semua file" (${pindahDasbor}x)`); gagal += 1; }
else console.log('  ok  renderAdmin tidak langsung kembali ke "Semua file"');
for (const [nama, penanda] of Object.entries(WAJIB)) {
  const hilang = penanda.filter((kelas) => !tangkapan[nama]?.includes(kelas));
  if (hilang.length) { console.error(`  GAGAL  ${nama} kehilangan penanda: ${hilang.join(', ')}`); gagal += 1; }
  else console.log(`  ok  markup ${nama} lengkap`);
}
console.log(gagal ? `GAGAL: ${gagal} layar.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
