// Penjelajah berkas semua user untuk Owner: satu tempat untuk melihat apa yang diunggah tiap
// member, tanpa membuka dashboard mereka satu per satu. Server hanya mengizinkan Owner
// (`/api/admin/files`), dan setiap pembacaan namespace user lain dicatat ke audit log.
//
// Aturan tampilan: Owner TIDAK diberi tombol hapus/ubah di sini. Berkas itu milik orang lain, dan
// satu klik salah akan menghapus data member; yang tersedia hanya menelusuri folder + mengunduh
// (unduhan tetap lewat rute khusus Owner yang juga mencatat audit).
import { api, app, esc, formatBytes, icon, notify } from '../core.js';
import { chipAkun } from './akun.js';
import { ikonMime, formatDateTime } from '../state.js';
import { ke } from '../router.js';

export async function renderBerkasUser(userId = '', folderId = '') {
  const kueri = new URLSearchParams({ userId });
  if (folderId) kueri.set('folderId', folderId);
  const data = await api(`/api/admin/files?${kueri}`);
  const krumb = (data.path || []).map((folder, index) => index === (data.path || []).length - 1
    ? `<span aria-current="page">${esc(folder.name)}</span>`
    : `<button class="ghost pb-crumb" data-folder="${esc(folder.id)}">${esc(folder.name)}</button>`).join(`<span class="pb-pemisah">/</span>`);
  const barisFolder = (folder) => `<article class="file-card folder" data-folder-id="${esc(folder.id)}">
      <div class="file-icon">${icon('folder', 22)}</div>
      <div class="file-info"><div class="file-name">${esc(folder.name)}</div><div class="file-meta">Folder</div></div>
    </article>`;
  const barisFile = (berkas) => `<article class="file-card" data-file-id="${esc(berkas.id)}">
      <div class="file-icon">${icon(ikonMime(berkas.mime_type), 22)}</div>
      <div class="file-info">
        <div class="file-name">${esc(berkas.name)}</div>
        <div class="file-meta">${formatBytes(berkas.size)} · diunggah ${formatDateTime(berkas.uploaded_at)}</div>
      </div>
      <div class="card-actions"><a class="ghost" href="/api/admin/files/${esc(berkas.id)}/download" download>${icon('download', 14)} Unduh</a></div>
    </article>`;
  const kosong = `<p class="empty-state">${data.folders.length || data.files.length ? 'Tidak ada berkas di folder ini.' : `${esc(data.user.username)} belum mengunggah berkas apa pun.`}</p>`;

  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><img src="/logo.jpg" alt="" class="brand-logo" width="26" height="26">Gutok<span>Drive</span></div><div><p class="workspace-label">Kendali</p><nav class="nav" aria-label="Berkas user"><button id="pb-kembali-user">${icon('arrow-left')} Semua user</button><button id="pb-kembali-kendali">${icon('settings-2')} Kendali workspace</button><button class="active" aria-current="page">${icon('folder-search')} Berkas user</button></nav></div><div class="sidebar-bottom"><p class="workspace-label">Ringkasan</p><div class="sidebar-stats"><div class="stat"><span class="stat-nama">File</span><span class="stat-angka">${data.stats.files}</span></div><div class="stat"><span class="stat-nama">Ukuran</span><span class="stat-angka">${formatBytes(data.stats.bytes)}</span></div><div class="stat"><span class="stat-nama">Folder</span><span class="stat-angka">${data.folders.length}</span></div><div class="stat"><span class="stat-nama">Sampah</span><span class="stat-angka">${data.trashCount}</span></div></div></div></aside><main class="main"><header class="topbar"><nav class="breadcrumb pb-crumb-nav" aria-label="Lokasi folder"><button class="ghost pb-crumb" data-folder="">${esc(data.user.username)}</button>${krumb ? `<span class="pb-pemisah">/</span>${krumb}` : ''}</nav>${chipAkun()}</header><div class="view-head"><div><h1 class="view-title" tabindex="-1">${esc(data.user.username)}</h1><p class="subtle">${esc(data.user.email)} · ${data.stats.files} berkas · ${formatBytes(data.stats.bytes)}</p></div></div><section class="panel"><div class="panel-heading"><h2>Isi penyimpanan</h2><span class="eyebrow">Hanya lihat — mengubah atau menghapus berkas milik user lain tidak disediakan</span></div><div class="grid file-list">${data.folders.map(barisFolder).join('')}${data.files.map(barisFile).join('')}${kosong}</div></section></main></div>`;

  document.querySelector('#pb-kembali-user').onclick = () => ke('admin');
  document.querySelector('#pb-kembali-kendali').onclick = () => ke('admin');
  document.querySelectorAll('.pb-crumb').forEach((tombol) => tombol.onclick = () => ke('adminBerkas', userId, tombol.dataset.folder || ''));
  document.querySelectorAll('.file-card.folder[data-folder-id]').forEach((kartu) => kartu.onclick = () => ke('adminBerkas', userId, kartu.dataset.folderId));
  return data.user.username;
}

export async function bukaBerkasUser(userId, username) {
  try { await ke('adminBerkas', userId); }
  catch (error) { notify(`Tidak bisa membuka berkas ${username || 'user ini'}: ${error.message}`); }
}
