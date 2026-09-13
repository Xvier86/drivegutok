// Keadaan aplikasi dan helper yang bergantung pada state.
import { app, formatBytes } from './core.js';

// `tab` = tab daftar yang sedang dipilih di layar file: 'file' (berkas biasa) atau 'cdn' (berkas yang
// punya link CDN). Disimpan di state supaya pilihan tidak hilang saat pindah folder/muat ulang.
export let state = { user: null, folderId: null, dashboard: null, tab: 'file' };
export function applyRoleVisibility() { const shell = app.querySelector('.app-shell'); if (!shell) return; const owner = state.user?.role === 'owner'; shell.classList.toggle('member-view', !owner); if (owner) return; app.querySelectorAll('.file-card:not(.folder)').forEach((card) => { const file = (state.dashboard?.files || []).find((item) => item.id === card.dataset.fileId); const meta = card.querySelector('.file-meta'); if (file && meta) meta.textContent = formatBytes(file.size); }); }
export const isCdnMime = (mimeType) => /^(image|video)\//.test(String(mimeType || ''));
// Ikon kartu mengikuti jenis berkas. Tanpa peta ini foto/video/PDF/audio memakai ikon 'file' yang
// sama, dan nama yang tidak ada di ikon.js hanya menghasilkan SVG kosong tanpa error di browser.
export const ikonMime = (mimeType = '') => /^image\//.test(mimeType) ? 'image' : /^video\//.test(mimeType) ? 'video' : /^audio\//.test(mimeType) ? 'music' : mimeType === 'application/pdf' ? 'file-text' : 'file';
export const formatDateTime = (value) => value ? new Date(value).toLocaleString('id-ID', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
export function folderAndDescendants(folderId, folders) {
  const children = new Map();
  folders.forEach((folder) => { const key = folder.parent_id || ''; if (!children.has(key)) children.set(key, []); children.get(key).push(folder.id); });
  const result = [];
  const queue = [folderId];
  while (queue.length) { const current = queue.shift(); if (result.includes(current)) continue; result.push(current); queue.push(...(children.get(current) || [])); }
  return result;
}
