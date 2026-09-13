// Sampah: daftar item terhapus, pemulihan, dan penghapusan permanen.
import { api, app, esc, formatBytes, hideLoading, icon, notify, refreshIcons, showLoading } from '../core.js';
import { formatDateTime, state } from '../state.js';
import { ke } from '../router.js';

export async function renderTrash() {
  const data = await api('/api/trash');
  const items = [...data.folders.map((folder) => `<article class="trash-row"><div class="file-icon">${icon('folder',22)}</div><div class="trash-info"><div class="file-name">${esc(folder.name)}</div><div class="file-meta">Folder · dihapus ${formatDateTime(folder.deleted_at)}</div></div><div class="trash-actions"><button class="icon-btn trash-restore" data-kind="folder" data-id="${folder.id}" data-name="${esc(folder.name)}" title="Pulihkan folder">${icon('rotate-ccw',14)}</button><button class="icon-btn danger trash-purge" data-kind="folder" data-id="${folder.id}" data-name="${esc(folder.name)}" title="Hapus permanen">${icon('trash-2',14)}</button></div></article>`), ...data.files.map((file) => `<article class="trash-row"><div class="file-icon">${icon('file',22)}</div><div class="trash-info"><div class="file-name">${esc(file.name)}</div><div class="file-meta">${formatBytes(file.size)} · ${esc(file.provider)} · dihapus ${formatDateTime(file.deleted_at)}</div></div><div class="trash-actions"><button class="icon-btn trash-restore" data-kind="file" data-id="${file.id}" data-name="${esc(file.name)}" title="Pulihkan file">${icon('rotate-ccw',14)}</button><button class="icon-btn danger trash-purge" data-kind="file" data-id="${file.id}" data-name="${esc(file.name)}" title="Hapus permanen">${icon('trash-2',14)}</button></div></article>`)].join('');
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand">my<span>drive</span></div><div><p class="workspace-label">Workspace</p><nav class="nav"><button id="trash-back">${icon('arrow-left')} Semua file</button><button class="active">${icon('trash-2')} Sampah</button></nav></div><div class="sidebar-bottom"><p class="workspace-label">Cara kerja Sampah</p><div class="provider-mini">Item di Sampah tetap tersimpan di provider storage dan masih terhitung sebagai pemakaian sampai dihapus permanen.</div><button class="side-link" id="logout" style="margin-top:18px;width:100%">${icon('log-out')} Keluar</button></div></aside><main class="main"><header class="topbar"><div><div class="eyebrow">Personal workspace / Sampah</div></div><div class="user-menu"><div style="text-align:right"><strong>${esc(state.user.username)}</strong><small>${state.user.role === 'owner' ? 'Owner' : 'Member'}</small></div><div class="avatar">${esc(state.user.username[0]?.toUpperCase())}</div></div></header><h1 class="greeting">Sampah</h1><p class="subtle">Item di Sampah bisa dipulihkan ke MyDrive. Setelah ${data.retentionDays} hari item dibersihkan otomatis dari provider storage.</p><div class="action-row"><button class="secondary" id="trash-back-2">${icon('arrow-left')} Kembali ke file</button>${data.counts.all ? `<button class="primary" id="empty-trash">${icon('trash-2')} Kosongkan sampah</button>` : ''}</div><section class="panel files-panel"><div class="panel-heading"><h2>Item di Sampah</h2><span class="eyebrow">${data.counts.all} item</span></div><div class="trash-list">${items || '<p class="subtle" style="padding:25px 0">Sampah kosong.</p>'}</div></section></main></div>`;
  refreshIcons();
  bindTrashView();
}
export function bindTrashView() {
  document.querySelector('#logout').onclick = async () => { await api('/api/logout', { method:'POST' }); state.user = null; ke('login'); };
  const back = () => { state.folderId = null; ke('dashboard'); };
  document.querySelector('#trash-back').onclick = back;
  document.querySelector('#trash-back-2').onclick = back;
  document.querySelector('#empty-trash')?.addEventListener('click', emptyTrash);
  document.querySelectorAll('.trash-restore').forEach((button) => button.onclick = () => restoreTrashItem(button.dataset.kind, button.dataset.id, button.dataset.name));
  document.querySelectorAll('.trash-purge').forEach((button) => button.onclick = () => purgeTrashItem(button.dataset.kind, button.dataset.id, button.dataset.name));
}
export async function restoreTrashItem(kind, itemId, name) {
  try {
    const result = await api(kind === 'folder' ? `/api/folders/${itemId}/restore` : `/api/files/${itemId}/restore`, { method:'POST' });
    notify(result?.movedToRoot ? `"${name}" dipulihkan ke MyDrive (folder asalnya sudah tidak ada).` : `"${name}" dipulihkan.`);
    await ke('trash');
  } catch (error) { notify(error.message); }
}
export async function purgeTrashItem(kind, itemId, name) {
  if (!confirm(`Hapus ${kind === 'folder' ? 'folder' : 'file'} "${name}" permanen? Isinya juga dihapus dari provider storage dan tidak bisa dikembalikan.`)) return;
  showLoading('Menghapus permanen...');
  try {
    const result = await api(kind === 'folder' ? `/api/folders/${itemId}/permanent` : `/api/files/${itemId}/permanent`, { method:'DELETE' });
    notify(result?.warning || `"${name}" sudah dihapus permanen.`);
    await ke('trash');
  } catch (error) { notify(error.message); }
  finally { hideLoading(); }
}
export async function emptyTrash() {
  if (!confirm('Kosongkan Sampah? Semua item di dalamnya dihapus permanen dari provider storage.')) return;
  showLoading('Mengosongkan sampah...');
  try {
    const result = await api('/api/trash', { method:'DELETE' });
    notify(result?.warning || `Sampah dikosongkan (${result?.deletedFiles || 0} file dihapus permanen).`);
    await ke('trash');
  } catch (error) { notify(error.message); }
  finally { hideLoading(); }
}
