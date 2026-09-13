// Uji asap layar: panggil setiap render* dengan data tiruan.
// Tujuannya menangkap kesalahan lingkup/impor pada kode yang sudah dipindah ke modul
// (misalnya formatBytes dipakai di trash.js tapi belum diimpor) tanpa perlu browser.
import process from 'node:process';

// DOM tiruan serba bisa.
const el = new Proxy(function () {}, { get: () => el, set: () => true, apply: () => el, has: () => true, construct: () => el });
for (const nama of ['document', 'window', 'location', 'localStorage', 'sessionStorage', 'navigator', 'lucide', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt', 'history', 'screen', 'requestAnimationFrame', 'cancelAnimationFrame', 'FileReader', 'Image', 'XMLHttpRequest']) globalThis[nama] = el;
process.on('unhandledRejection', () => {});

const provider = { id: 'p1', name: 'Google Drive', kind: 'gdrive', enabled: 1, used_bytes: 1024, capacity_bytes: 2048, configured: true, missing: [] };
const file = { id: 'f1', name: 'laporan.pdf', mime_type: 'application/pdf', size: 2048, provider: 'p1', cdn_enabled: 0, cdn_slug: null, encrypted: 0, uploaded_at: '2026-09-13T00:00:00Z', deleted_at: '2026-09-13T00:00:00Z' };
const folder = { id: 'd1', name: 'Dokumen', parent_id: null, depth: 0, deleted_at: '2026-09-13T00:00:00Z' };
const jawaban = {
  '/api/dashboard': { user: { id: 'u1', username: 'vier', role: 'owner' }, folderId: null, folders: [folder], files: [file], providers: [provider], stats: { bytes: 2048, files: 1 }, trashCount: 1, uptimeSeconds: 3600 },
  '/api/admin/overview': { providers: [provider], users: [{ id: 'u1', username: 'vier', email: 'a@b.c', role: 'owner', status: 'active' }], logs: [{ action: 'upload', target_type: 'file', username: 'vier', created_at: '2026-09-13T00:00:00Z' }] },
  '/api/trash': { files: [file], folders: [folder], counts: { all: 2, files: 1, folders: 1 } },
};
globalThis.fetch = async (url) => ({ ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => jawaban[String(url).split('?')[0]] || {} });

const { rute } = await import('./assets/js/router.js');
const { state } = await import('./assets/js/state.js');
const files = await import('./assets/js/views/files.js');
const admin = await import('./assets/js/views/admin.js');
const trash = await import('./assets/js/views/trash.js');
const login = await import('./assets/js/views/login.js');

state.user = { id: 'u1', username: 'vier', role: 'owner' };
Object.assign(rute, { dashboard: files.renderDashboard, admin: admin.renderAdmin, trash: trash.renderTrash, login: login.renderLogin });

let gagal = 0;
for (const [nama, panggil] of [['renderDashboard', files.renderDashboard], ['bindDashboard', files.bindDashboard], ['renderTrash', trash.renderTrash], ['renderAdmin', admin.renderAdmin], ['renderLogin', login.renderLogin]]) {
  try { await panggil(); console.log(`  ok  ${nama}`); } catch (error) { console.error(`  GAGAL  ${nama}: ${error.message}`); gagal += 1; }
}
console.log(gagal ? `GAGAL: ${gagal} layar.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
