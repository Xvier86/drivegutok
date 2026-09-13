// Keadaan aplikasi dan helper yang bergantung pada state.
import { app, formatBytes } from './core.js';

export let state = { user: null, folderId: null, dashboard: null };
export function applyRoleVisibility() { const shell = app.querySelector('.app-shell'); if (!shell) return; const owner = state.user?.role === 'owner'; shell.classList.toggle('member-view', !owner); if (owner) return; app.querySelectorAll('.file-card:not(.folder)').forEach((card, index) => { const file = state.dashboard?.files?.[index]; const meta = card.querySelector('.file-meta'); if (file && meta) meta.textContent = formatBytes(file.size); }); }
export const isCdnMime = (mimeType) => /^(image|video)\//.test(String(mimeType || ''));
export const formatDateTime = (value) => value ? new Date(value).toLocaleString('id-ID', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
export function folderAndDescendants(folderId, folders) {
  const children = new Map();
  folders.forEach((folder) => { const key = folder.parent_id || ''; if (!children.has(key)) children.set(key, []); children.get(key).push(folder.id); });
  const result = [];
  const queue = [folderId];
  while (queue.length) { const current = queue.shift(); if (result.includes(current)) continue; result.push(current); queue.push(...(children.get(current) || [])); }
  return result;
}
