// Layar utama: daftar file, folder, unggah, berbagi, dan CDN.
import { api, app, esc, formatBytes, hideLoading, icon, notify, showLoading } from '../core.js';
import { formatDateTime, folderAndDescendants, ikonMime, isCdnMime, state } from '../state.js';
import { ke } from '../router.js';
import { chipAkun } from './akun.js';

const SEGMEN_METER = 28; // jumlah segmen meter penyimpanan; cukup halus di sidebar 264px
let storageDimainkan = false; // animasi masuk meter hanya sekali per page-load, bukan tiap render ulang

export async function renderDashboard() { const data = await api(`/api/dashboard?${state.folderId ? `folderId=${state.folderId}` : ''}`); state.dashboard = data; state.folderId = data.folderId || null;
  const totalTerpakai = data.providers.reduce((total, provider) => total + Number(provider.used_bytes || 0), 0);
  const totalKapasitas = data.providers.reduce((total, provider) => total + Number(provider.capacity_bytes || 0), 0);
  // Widget penyimpanan: satu angka akumulasi semua provider, tanpa nama/status/baris per provider
  // (rinciannya hanya di Owner control). Markup sudah memuat keadaan akhir — angka, segmen menyala,
  // dan persen — jadi kalau animasi dilewati atau JS mati, yang terlihat tetap nilai yang benar,
  // bukan meter kosong. Angka dan segmen dipakai apa adanya dari /api/dashboard.
  const persenStorage = totalKapasitas ? Math.min(100, totalTerpakai / totalKapasitas * 100) : 0;
  const segmenNyala = totalKapasitas ? (totalTerpakai > 0 ? Math.max(1, Math.round(persenStorage / 100 * SEGMEN_METER)) : 0) : 0;
  const labelPersen = totalKapasitas ? (persenStorage < 1 && totalTerpakai > 0 ? '<1%' : `${Math.round(persenStorage)}%`) : '—';
  const teksTotal = totalKapasitas ? formatBytes(totalKapasitas) : 'tidak dilaporkan';
  // ponytail: 28 segmen sudah cukup di sidebar 264px; naikkan SEGMEN_METER kalau meter pindah ke panel lebar.
  const segmenMeter = Array.from({ length: SEGMEN_METER }, (_, i) => `<span class="segmen${i < segmenNyala ? ' on' : ''}" style="--i:${i}"></span>`).join('');
  // Pemisahan berkas biasa dan berkas CDN memakai kolom yang sudah ada: `cdn_enabled` menandai berkas
  // yang punya link publik /cdn/<slug>. Satu permintaan dashboard saja, lalu tab hanya menyembunyikan
  // baris lewat CSS (atribut data-tab di panel), jadi pindah tab tidak memanggil server.
  // ponytail: kalau nanti satu folder bisa memuat ribuan berkas, pindahkan penyaringan ke
  // /api/dashboard?cdn=1 supaya browser tidak merender baris yang langsung disembunyikan.
  const berkasBiasa = data.files.filter((file) => !file.cdn_enabled);
  const berkasCdn = data.files.filter((file) => file.cdn_enabled);
  const tab = state.tab === 'cdn' ? 'cdn' : 'file';
  const namaProvider = (providerId) => data.providers.find((provider) => provider.id === providerId)?.name || providerId;
  const tombolTab = (nama, label, jumlah) => `<button class="tab${tab === nama ? ' active' : ''}" id="tab-${nama}" data-tab="${nama}" role="tab" aria-selected="${tab === nama}">${label}<span class="eyebrow">${jumlah}</span></button>`;
  const crumb = `<span class="crumb" data-folder="">Penyimpanan</span>${(data.path || []).map((entry, index, list) => `<span>/</span><span class="crumb${index === list.length - 1 ? ' current' : ''}" data-folder="${entry.id}">${esc(entry.name)}</span>`).join('')}`;

  const aksiFile = (file) => `<button class="icon-btn file-view" data-file-id="${file.id}" title="Lihat file">${icon('eye',14)}</button><button class="icon-btn file-rename" data-file-id="${file.id}" data-file-name="${esc(file.name)}" title="Ganti nama file">${icon('pencil',14)}</button><button class="icon-btn file-move" data-file-id="${file.id}" data-file-name="${esc(file.name)}" title="Pindahkan file">${icon('corner-up-right',14)}</button>${isCdnMime(file.mime_type) && !file.encrypted ? `<button class="icon-btn file-cdn${file.cdn_enabled ? ' on' : ''}" data-file-id="${file.id}" data-file-name="${esc(file.name)}" data-cdn-enabled="${file.cdn_enabled ? '1' : '0'}" data-cdn-slug="${file.cdn_slug || ''}" title="${file.cdn_enabled ? 'Kelola link CDN (aktif)' : 'Aktifkan link CDN'}">${icon('radio-tower',14)}</button>` : ''}<button class="icon-btn file-share" data-file-id="${file.id}" data-file-name="${esc(file.name)}" data-cdn="${file.cdn_slug || ''}" title="Bagikan file / ambil link CDN">${icon('share-2',14)}</button><button class="icon-btn danger file-delete" data-file-id="${file.id}" data-file-name="${esc(file.name)}" title="Pindahkan file ke Sampah">${icon('trash-2',14)}</button>`;
  const barisFolder = (folder) => `<article class="file-card folder" data-open-folder="${folder.id}"><div class="file-icon">${icon('folder',22)}</div><div class="file-info"><div class="file-name">${esc(folder.name)}</div><div class="file-meta">Folder · ${formatDateTime(folder.created_at)}</div></div><div class="card-actions"><button class="icon-btn folder-rename" data-folder-id="${folder.id}" data-folder-name="${esc(folder.name)}" title="Ganti nama folder">${icon('pencil',14)}</button><button class="icon-btn folder-move" data-folder-id="${folder.id}" data-folder-name="${esc(folder.name)}" title="Pindahkan folder">${icon('corner-up-right',14)}</button><button class="icon-btn danger folder-delete" data-folder-id="${folder.id}" data-folder-name="${esc(folder.name)}" title="Pindahkan folder ke Sampah">${icon('trash-2',14)}</button></div></article>`;
  const barisFile = (file) => `<article class="file-card${file.cdn_enabled ? ' is-cdn' : ''}" data-file-id="${file.id}"><div class="file-icon">${icon(ikonMime(file.mime_type),22)}</div><div class="file-info"><div class="file-name" title="${esc(file.name)}">${esc(file.name)}${file.cdn_enabled ? ' <span class="eyebrow">CDN</span>' : ''}</div><div class="file-meta">${formatBytes(file.size)} · ${esc(namaProvider(file.provider))} · ${formatDateTime(file.uploaded_at)}</div></div><div class="card-actions">${aksiFile(file)}</div></article>`;
  const kosong = `${data.folders.length || berkasBiasa.length ? '' : '<p class="subtle empty-state empty-file">Belum ada file di sini. Pakai tombol Upload file atau seret file ke area di bawah.</p>'}${berkasCdn.length ? '' : '<p class="subtle empty-state empty-cdn">Belum ada berkas CDN. Pakai tombol Upload CDN untuk gambar atau video yang mau dipakai di kode atau website.</p>'}`;
  // FAB dirender DI LUAR .app-shell: containment dari `container-type` membuat `position: fixed` di
  // dalamnya ikut menggulir, jadi tombol Unggah akan hilang dari sudut layar begitu halaman digulir.
  // Di luar shell, `fixed` tetap menempel di viewport.

  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><img src="/logo.jpg" alt="" class="brand-logo" width="26" height="26">Gutok<span>Drive</span></div><div><p class="workspace-label">Workspace</p><nav class="nav"><button class="active">${icon('layout-grid')} Semua file</button><button id="new-folder">${icon('folder-plus')} Folder baru</button><button id="trash-view">${icon('trash-2')} Sampah${data.trashCount ? ` (${data.trashCount})` : ''}</button>${state.user.role === 'owner' ? `<button id="admin-view">${icon('settings-2')} Kendali workspace</button>` : ''}</nav></div><div class="sidebar-bottom"><section class="panel storage-card" id="storage-card"><div class="storage-head"><span class="storage-label">Penyimpanan</span><span class="storage-pct" id="storage-pct">${labelPersen}</span></div><p class="storage-readout"><span class="storage-isi" id="storage-isi" data-bytes="${totalTerpakai}">${formatBytes(totalTerpakai)}</span><span class="storage-dari">dari <span class="storage-total">${teksTotal}</span></span></p><div class="storage-meter" id="storage-meter" role="img" aria-label="Terpakai ${formatBytes(totalTerpakai)} dari ${teksTotal}${totalKapasitas ? ` (${labelPersen})` : ''}">${segmenMeter}</div></section><button class="side-link btn-block mt-md" id="logout">${icon('log-out')} Keluar</button></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">${crumb}</div><div class="topbar-kanan" id="topbar-kanan">${chipAkun()}</div></header><div class="view-head"><div><h1 class="view-title">${state.folderId ? esc(data.path?.at(-1)?.name || 'Folder') : 'Penyimpanan'}</h1><p class="subtle">${data.folders.length} folder · ${berkasBiasa.length} file · ${berkasCdn.length} berkas CDN</p></div><div class="tabs" role="tablist">${tombolTab('file', 'File', berkasBiasa.length)}${tombolTab('cdn', 'CDN', berkasCdn.length)}</div></div><div class="action-row"><button class="secondary" id="folder-trigger">${icon('folder-plus')} Folder baru</button><input id="file-input" type="file" multiple hidden></div><section class="panel files-panel" data-tab="${tab}"><div class="panel-heading"><h2>${tab === 'cdn' ? 'Berkas CDN' : 'Isi folder'}</h2><span class="eyebrow">${data.folders.length + data.files.length} item · ${formatBytes(data.stats.bytes)}</span></div><div class="grid file-list">${data.folders.map(barisFolder).join('')}${data.files.map(barisFile).join('')}${kosong}</div><div class="dropzone" id="dropzone">${icon('move-down',18)}<br>Tarik dan lepas file di sini</div></section></main></div><button class="fab" id="upload-trigger" title="Upload file" aria-label="Upload file">${icon('upload-cloud',24)}</button>`; }
// Ikatan tombol dipasang satu kali saja: app.js memanggil bindDashboard() setelah setiap render
// (peristiwa 'layar-siap' -> pasangUlang). Dulu fungsi di atas juga memanggilnya sendiri, jadi
// #admin-view/#admin-card/#trash-view punya dua listener — satu klik = dua kali /api/admin/overview
// (terlihat di browser tiruan jsdom: endpoint itu terpanggil dua kali).
export function bindDashboard() { if (!document.querySelector('#upload-trigger')) return; document.querySelectorAll('[data-open-folder]').forEach((item) => item.onclick = (event) => { if (event.target.closest('.card-actions')) return; state.folderId = item.dataset.openFolder; ke('dashboard'); }); document.querySelectorAll('[data-folder]').forEach((item) => item.onclick = () => { state.folderId = item.dataset.folder || null; ke('dashboard'); }); document.querySelector('#new-folder').onclick = () => openModal('folder'); document.querySelector('#folder-trigger').onclick = () => openModal('folder'); document.querySelector('#upload-trigger').onclick = () => openUploadModal('file'); document.querySelector('#dropzone').ondragover = (event) => { event.preventDefault(); event.currentTarget.classList.add('drag'); }; document.querySelector('#dropzone').ondragleave = (event) => event.currentTarget.classList.remove('drag'); document.querySelector('#dropzone').ondrop = (event) => { event.preventDefault(); event.currentTarget.classList.remove('drag'); openUploadModal('file', event.dataTransfer.files); }; document.querySelector('#admin-view')?.addEventListener('click', async () => { try { await ke('admin'); } catch (error) { notify(error.message); } }); document.querySelectorAll('.tab').forEach((tab) => tab.onclick = () => { state.tab = tab.dataset.tab === 'cdn' ? 'cdn' : 'file'; document.querySelector('.files-panel')?.setAttribute('data-tab', state.tab); document.querySelectorAll('.tab').forEach((lain) => lain.classList.toggle('active', lain === tab)); }); document.querySelector('#trash-view')?.addEventListener('click', async () => { try { await ke('trash'); } catch (error) { notify(error.message); } }); animateStorage(); }

// Animasi masuk widget penyimpanan: angka menghitung naik dari 0, segmen menyala berurutan dari
// kiri, lalu persentase menyusul. Dipanggil dari bindDashboard() (peristiwa 'layar-siap'), tetapi
// flag modul membuatnya jalan sekali per page-load: render ulang setelah pindah folder tidak
// mengulang animasi — markup baru sudah berisi nilai final. reduced-motion: tidak ada animasi sama
// sekali (segmen langsung menyala penuh dan angka tidak dihitung naik), sesuai keadaan markup.
function animateStorage() {
  const meter = document.querySelector('#storage-meter');
  const angka = document.querySelector('#storage-isi');
  if (!meter || !angka || storageDimainkan) return;
  storageDimainkan = true;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  const target = Number(angka.dataset.bytes || 0);
  const nyala = meter.querySelectorAll('.segmen.on').length;
  const kartu = document.querySelector('#storage-card');
  kartu?.style.setProperty('--delay-pct', `${nyala * 26 + 240}ms`);
  meter.classList.add('is-anim');
  kartu?.classList.add('is-anim');
  const mulai = performance.now();
  const hitungNaik = (kini) => {
    const maju = Math.min(1, (kini - mulai) / 900);
    angka.textContent = formatBytes(target * maju);
    if (maju < 1) window.requestAnimationFrame?.(hitungNaik);
  };
  window.requestAnimationFrame?.(hitungNaik);
}

export function bindMediaPreview() { document.querySelectorAll('.file-card:not(.folder)').forEach((card) => { card.onclick = (clickEvent) => { if (clickEvent.target.closest('.card-actions')) return; const file = (state.dashboard?.files || []).find((item) => item.id === card.dataset.fileId); if (!file) return; const url = file.cdn_enabled && file.cdn_slug ? `/cdn/${file.cdn_slug}` : `/api/files/${file.id}/download`; const type = file.mime_type.toLowerCase(); const isImage = type.startsWith('image/'); const isVideo = type.startsWith('video/'); const isAudio = type.startsWith('audio/'); const isPdf = type === 'application/pdf'; const isText = type.startsWith('text/') || /json|javascript|xml/.test(type); /* Pemutar yang dipasang untuk berkas yang tidak didukung codec/container (mkv, avi, opus) hanya tampil mati tanpa pesan. canPlayType() menjawab sebelum pemutar dipasang. */ const putar = (mime) => document.createElement('video').canPlayType(mime) !== ''; const takDidukung = `<div class="media-empty">Browser ini tidak bisa memutar format <b>${esc(type)}</b> langsung. Pakai tombol download, atau ubah ke MP4 (video) / MP3 (audio).</div>`; const media = isImage ? `<img class="media-preview" src="${url}" alt="${esc(file.name)}">` : isVideo && putar(type) ? `<video class="media-preview" src="${url}" controls preload="metadata"></video>` : isAudio && putar(type) ? `<audio class="media-audio" src="${url}" controls></audio>` : isVideo || isAudio ? takDidukung : isPdf || isText ? `<iframe class="media-frame" src="${url}" title="${esc(file.name)}"></iframe>` : `<div class="media-empty">Format ini tidak bisa dirender langsung oleh browser. Gunakan tombol download untuk membukanya.</div>`; document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="media-modal"><section class="modal"><h2>${esc(file.name)}</h2>${media}<div class="preview-actions"><a class="primary" href="${url}" target="_blank" rel="noopener">${icon('external-link')} Buka / download</a><button class="secondary" id="close-media">Tutup</button></div></section></div>`); document.querySelector('#close-media').onclick = () => document.querySelector('#media-modal').remove(); }; }); }
export async function renameFile(fileId, currentName) { const name = prompt('Nama baru untuk file:', currentName); if (!name || !name.trim() || name.trim() === currentName) return; try { await api(`/api/files/${fileId}`, { method:'PATCH', body:JSON.stringify({ name:name.trim() }) }); notify('Nama file diperbarui.'); await ke('dashboard'); } catch (error) { notify(error.message); } }
// Baris keluar dulu (animasi `rowKeluar`, ~300ms), baru DELETE dikirim. Batas waktu 400ms dipasang
// supaya baris tidak menggantung kalau animationend tidak pernah datang (mis. os reduced-motion).
const tungguAnimasi = (baris, batasMs = 400) => new Promise((lanjut) => { const timer = setTimeout(lanjut, batasMs); baris.addEventListener('animationend', () => { clearTimeout(timer); lanjut(); }, { once: true }); });
// Urutan yang penting: animasi → DELETE → hilangkan baris. Kalau API gagal, kelas `removing`
// dicabut sehingga baris kembali terlihat (dan bisa diklik lagi), bukan dibiarkan setengah hilang.
export async function deleteFile(fileId, name) { if (!confirm(`Pindahkan "${name}" ke Sampah? Kamu masih bisa memulihkannya dari menu Sampah.`)) return; const baris = document.querySelector(`.file-card[data-file-id="${fileId}"]`); if (baris) { baris.classList.add('removing'); await tungguAnimasi(baris); } try { await api(`/api/files/${fileId}`, { method:'DELETE' }); notify('Dipindahkan ke Sampah. Buka menu Sampah untuk memulihkannya.'); await ke('dashboard'); } catch (error) { baris?.classList.remove('removing'); notify(error.message); } }
export async function renameFolder(folderId, currentName) { const name = prompt('Nama baru untuk folder:', currentName); if (!name || !name.trim() || name.trim() === currentName) return; try { await api(`/api/folders/${folderId}`, { method:'PATCH', body:JSON.stringify({ name:name.trim() }) }); notify('Nama folder diperbarui.'); await ke('dashboard'); } catch (error) { notify(error.message); } }
export async function deleteFolder(folderId, name) { if (!confirm(`Pindahkan folder "${name}" beserta seluruh isinya ke Sampah? Isinya masih bisa dipulihkan dari menu Sampah.`)) return; try { await api(`/api/folders/${folderId}`, { method:'DELETE' }); notify('Folder dipindahkan ke Sampah. Buka menu Sampah untuk memulihkannya.'); await ke('dashboard'); } catch (error) { notify(error.message); } }
export function bindFileFolderActions() { document.querySelectorAll('.file-view').forEach((button) => button.onclick = (event) => { event.stopPropagation(); button.closest('.file-card')?.click(); }); document.querySelectorAll('.file-rename').forEach((button) => button.onclick = (event) => { event.stopPropagation(); renameFile(button.dataset.fileId, button.dataset.fileName); }); document.querySelectorAll('.file-share').forEach((button) => button.onclick = (event) => { event.stopPropagation(); shareFile(button.dataset.fileId, button.dataset.fileName, button.dataset.cdn); }); document.querySelectorAll('.file-delete').forEach((button) => button.onclick = (event) => { event.stopPropagation(); deleteFile(button.dataset.fileId, button.dataset.fileName || 'ini'); }); document.querySelectorAll('.folder-rename').forEach((button) => button.onclick = (event) => { event.stopPropagation(); renameFolder(button.dataset.folderId, button.dataset.folderName); }); document.querySelectorAll('.folder-delete').forEach((button) => button.onclick = (event) => { event.stopPropagation(); deleteFolder(button.dataset.folderId, button.dataset.folderName || 'ini'); }); document.querySelectorAll('.file-move').forEach((button) => button.onclick = (event) => { event.stopPropagation(); moveFile(button.dataset.fileId, button.dataset.fileName || 'file ini'); }); document.querySelectorAll('.folder-move').forEach((button) => button.onclick = (event) => { event.stopPropagation(); moveFolder(button.dataset.folderId, button.dataset.folderName || 'folder ini'); }); document.querySelectorAll('.file-cdn').forEach((button) => button.onclick = (event) => { event.stopPropagation(); openCdnModal(button.dataset.fileId, button.dataset.fileName || 'file ini', button.dataset.cdnEnabled === '1', button.dataset.cdnSlug || ''); }); }
export async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch { const helper = document.createElement('textarea'); helper.value = text; document.body.appendChild(helper); helper.select(); const ok = document.execCommand('copy'); helper.remove(); return ok; } }
export async function shareFile(fileId, name, cdnSlug) { const password = prompt(`Password opsional untuk link share "${name}" (kosongkan kalau tanpa password):`, ''); if (password === null) return; const days = prompt('Berapa hari link share berlaku? Kosongkan untuk selamanya.', '7'); if (days === null) return; showLoading('Membuat link share...'); try { const body = {}; if (password.trim()) body.password = password.trim(); const dayCount = Number(days); if (days.trim() && Number.isFinite(dayCount) && dayCount > 0) body.expiresAt = new Date(Date.now() + dayCount * 86400000).toISOString(); const result = await api(`/api/files/${fileId}/share`, { method:'POST', body:JSON.stringify(body) }); const shareUrl = `${result.url}${password.trim() ? `?password=${encodeURIComponent(password.trim())}` : ''}`; const cdnUrl = cdnSlug ? `${location.origin}/cdn/${cdnSlug}` : ''; document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="share-modal"><section class="modal"><h2>Link bagikan siap</h2><p class="subtle">${esc(name)}</p><div class="field"><label>Link share</label><input id="share-link" readonly value="${esc(shareUrl)}"></div>${cdnUrl ? `<div class="field"><label>Link CDN (bisa langsung dipakai di kode)</label><input id="share-cdn" readonly value="${esc(cdnUrl)}"></div>` : ''}<p class="subtle">${result.expiresAt ? `Berlaku sampai ${new Date(result.expiresAt).toLocaleString('id-ID')}.` : 'Berlaku selamanya sampai file dihapus.'}</p><div class="preview-actions"><button class="primary" id="copy-share">${icon('copy')} Salin link</button><button class="secondary" id="close-share">Tutup</button></div></section></div>`); document.querySelector('#copy-share').onclick = async () => { const parts = [document.querySelector('#share-link').value]; const cdnField = document.querySelector('#share-cdn'); if (cdnField) parts.push(cdnField.value); notify(await copyText(parts.join('\n')) ? 'Link disalin ke clipboard.' : 'Tidak bisa menyalin otomatis, salin manual dari kolom di atas.'); }; document.querySelector('#close-share').onclick = () => document.querySelector('#share-modal').remove(); } catch (error) { notify(error.message); } finally { hideLoading(); } }
// Penjaga #dropzone bukan hiasan: `.action-row` pertama juga ada di header Owner control, jadi tanpa
// penjaga ini tombol "Upload CDN (5 MB)" (dan modalnya) muncul di halaman Owner control.
export function bindCdnUpload() { if (document.querySelector('#cdn-trigger') || !document.querySelector('#dropzone')) return; const actionRow = document.querySelector('.action-row'); if (!actionRow) return; actionRow.insertAdjacentHTML('beforeend', `<button class="secondary" id="cdn-trigger">${icon('radio-tower')} Upload CDN <small>(5 MB)</small></button>`); document.querySelector('#cdn-trigger').onclick = () => openUploadModal('cdn'); }
export function bindProviderPicker() { if (state.user?.role !== 'owner' || document.querySelector('#upload-provider') || !document.querySelector('#dropzone')) return; const actionRow = document.querySelector('.action-row'); const providers = state.dashboard?.providers?.filter((provider) => provider.enabled) || []; if (!actionRow || !providers.length) return; actionRow.insertAdjacentHTML('beforeend', `<label class="provider-picker"><span>Provider upload</span><select id="upload-provider"><option value="">Otomatis</option>${providers.map((provider) => `<option value="${provider.id}">${esc(provider.name)}</option>`).join('')}</select></label>`); }
// Uptime disisipkan sebagai anak PERTAMA grup kanan (#topbar-kanan), bukan di ujung .topbar: dengan
// `justify-content: space-between`, yang menempel ke tepi kanan adalah elemen terakhir — jadi chip
// akun tetap di ujung kanan, bukan tergeser ke tengah baris oleh status server.
// Isinya animasi tiga batang (lihat .server-status di components.css), bukan teks "Uptime X jam ·
// Y digunakan" — angka yang selalu berubah itu basi begitu halaman dibuka dan hanya menambah baris
// teks di header. Nilainya tetap terbaca pembaca layar lewat aria-label.
export function bindUploadOptions() { const kanan = document.querySelector('#topbar-kanan'); if (kanan && document.querySelector('#dropzone') && !document.querySelector('#server-status')) kanan.insertAdjacentHTML('afterbegin', `<div class="server-status" id="server-status" role="img" aria-label="Uptime ${Math.floor((state.dashboard.uptimeSeconds || 0) / 3600)} jam, ${formatBytes(state.dashboard.stats.bytes)} digunakan"><i></i><i></i><i></i></div>`); }
export function openUploadModal(kind = 'file', initialFiles = null) { const isCdn = kind === 'cdn'; document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="upload-modal"><section class="modal"><h2>${isCdn ? 'Upload CDN' : 'Tambah file'}</h2><form id="upload-form"><div class="field"><label>File ${isCdn ? '(gambar/video, maksimal 5 MB)' : ''}</label><input id="modal-file-input" type="file" ${isCdn ? 'accept="image/*,video/*"' : ''} multiple ${initialFiles?.length ? '' : 'required'}></div><div class="field"><label>Masa simpan</label><select id="modal-retention-type"><option value="forever">Selamanya</option><option value="days">Hari</option><option value="months">Bulan</option></select></div><input id="modal-retention-value" type="number" min="1" placeholder="Jumlah hari/bulan" hidden>${!isCdn && state.user?.role === 'owner' ? '<label class="encrypt-option"><input id="modal-encrypt" type="checkbox"> Enkripsi file</label>' : ''}<div class="modal-actions"><button type="button" class="secondary" id="close-upload-modal">Batal</button><button class="primary">${isCdn ? 'Upload CDN' : 'Upload file'}</button></div></form></section></div>`); const retentionType = document.querySelector('#modal-retention-type'); retentionType.onchange = () => { document.querySelector('#modal-retention-value').hidden = retentionType.value === 'forever'; }; document.querySelector('#close-upload-modal').onclick = () => document.querySelector('#upload-modal').remove(); document.querySelector('#upload-form').onsubmit = async (event) => { event.preventDefault(); const files = initialFiles || document.querySelector('#modal-file-input').files; const retention = retentionType.value; const value = document.querySelector('#modal-retention-value').value; const encrypted = document.querySelector('#modal-encrypt')?.checked ? 'true' : 'false'; document.querySelector('#upload-modal').remove(); await (isCdn ? uploadCdnFiles(files, retention, value) : uploadFiles(files, retention, value, encrypted)); }; }
// Unggahan lewat XMLHttpRequest, bukan api()/fetch: hanya XHR yang memberi xhr.upload.onprogress,
// dan tanpa itu bilah + kecepatan tidak bisa ditampilkan. Batas waktu 30 menit sama dengan api()
// untuk FormData (dijaga uji/upload.mjs), dan pesan galat non-JSON dibuat sekelas api() supaya
// halaman 524 Cloudflare muncul sebagai status + cuplikan, bukan dump HTML.
function unggahXhr(body, saatProgres) {
  return new Promise((selesai, gagal) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.timeout = 30 * 60 * 1000;
    if (saatProgres) xhr.upload.onprogress = saatProgres;
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) selesai(data);
      else if (data?.error) gagal(new Error(data.error));
      else { const potongan = String(xhr.responseText || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); gagal(new Error(`Server menjawab ${xhr.status}: ${potongan || 'tanpa keterangan'}`)); }
    };
    xhr.onerror = () => gagal(new Error('Server tidak dapat dihubungi. Pastikan npm start berjalan pada port yang benar.'));
    xhr.ontimeout = () => gagal(new Error('Server terlalu lama merespons. Periksa log PM2 dan konfigurasi Nginx.'));
    xhr.send(body);
  });
}
let nomorUnggah = 0;
// Baris sementara selama unggah. Tombol hapus tetap ada di markup tetapi disembunyikan CSS, bukan
// dihilangkan: membatalkan unggahan butuh abort controller, urusan terpisah dari hapus berkas.
const barisUnggah = (file) => `<article class="file-card is-uploading" data-upload="${nomorUnggah += 1}"><div class="file-icon">${icon('upload-cloud',22)}</div><div class="file-info"><div class="file-name">${esc(file.name)}</div><div class="upl-meta"><span class="upl-bar"><i class="upl-fill"></i></span><span class="upl-angka">menghitung…</span><span class="upl-persen">0%</span></div></div><div class="card-actions"><button class="icon-btn danger file-delete" title="Tunggu unggahan selesai" tabindex="-1">${icon('trash-2',14)}</button></div><span class="badge-selesai">Selesai</span></article>`;
// Kecepatan = delta byte / delta waktu antar-event, bukan rata-rata sejak awal: rata-rata terus naik
// walau jaringan melambat, jadi angka macet justru terlihat "sehat". Angka diperbarui tiap ~250ms
// saja supaya tidak bergetar.
function pasangProgres(baris, file) {
  const isi = baris.querySelector('.upl-fill'); const angka = baris.querySelector('.upl-angka'); const persen = baris.querySelector('.upl-persen');
  let byteLalu = 0; let waktuLalu = performance.now();
  return (event) => {
    const kini = performance.now(); const detik = (kini - waktuLalu) / 1000;
    if (detik >= 0.25) { angka.textContent = `${(Math.max(0, event.loaded - byteLalu) / detik / 1048576).toFixed(1)} MB/s`; byteLalu = event.loaded; waktuLalu = kini; }
    const maju = event.lengthComputable ? Math.min(100, file.size ? event.loaded / file.size * 100 : 100) : null;
    if (maju === null) persen.textContent = formatBytes(event.loaded);
    else { persen.textContent = `${Math.round(maju)}%`; if (isi) isi.style.width = `${maju}%`; }
  };
}
// Tanpa lapisan pemuatan: bilah per baris sudah jadi umpan baliknya, dan overlay hanya akan menutupi
// bilah itu sendiri. showLoading/hideLoading tetap dipakai jalur Upload CDN di bawah.
export async function uploadFiles(files, retentionType = 'forever', retentionValue = '', encrypt = 'false') {
  const providerId = document.querySelector('#upload-provider')?.value || '';
  const daftar = document.querySelector('.file-list');
  let adaBaris = false;
  for (const file of files) {
    const body = new FormData();
    body.append('file', file);
    if (providerId) body.append('providerId', providerId);
    if (state.folderId) body.append('folderId', state.folderId);
    body.append('retentionType', retentionType);
    if (retentionValue) body.append('retentionValue', retentionValue);
    body.append('encrypt', encrypt);
    daftar?.insertAdjacentHTML('beforeend', barisUnggah(file));
    const baris = daftar?.lastElementChild || null;
    if (baris) adaBaris = true;
    try { await unggahXhr(body, baris ? pasangProgres(baris, file) : null); baris?.classList.replace('is-uploading', 'is-selesai'); }
    catch (error) { baris?.remove(); notify(error.message); }
  }
  // Badge "Selesai" tampil ~1,8 detik, lalu render ulang menggantinya dengan baris file biasa —
  // sekaligus memperbarui angka penyimpanan di sidebar.
  if (adaBaris) await new Promise((lanjut) => setTimeout(lanjut, 1800));
  await ke('dashboard');
}
export async function uploadCdnFiles(files, retentionType = 'forever', retentionValue = '') { showLoading('Upload CDN sedang berjalan...'); try { const providerId = document.querySelector('#upload-provider')?.value || ''; for (const file of files) { if (file.size > 5 * 1024 * 1024) { notify(`${file.name} melebihi batas 5 MB.`); continue; } try { const body = new FormData(); body.append('file', file); if (providerId) body.append('providerId', providerId); if (state.folderId) body.append('folderId', state.folderId); body.append('retentionType', retentionType); if (retentionValue) body.append('retentionValue', retentionValue); const result = await api('/api/files/cdn', { method:'POST', body }); notify(`CDN siap: ${result.cdnUrl}`); } catch (error) { notify(error.message); } } await ke('dashboard'); } finally { hideLoading(); } }
export function openModal(type) { const isInvite = type === 'invite'; const isProvider = type === 'provider'; const title = isInvite ? 'Invite member' : isProvider ? 'Tambah storage remote' : 'Folder baru'; const fields = isInvite ? '<div class="field"><label>Email</label><input name="email" type="email" required></div><div class="field"><label>Username</label><input name="username" required></div><div class="field"><label>Password sementara</label><input name="password" type="password" minlength="8" required></div>' : isProvider ? '<div class="field"><label>Nama storage</label><input name="name" placeholder="Google Drive utama" required autofocus></div><div class="field"><label>Jenis provider</label><select name="kind" required><option value="telegram">Telegram Channel</option><option value="mega">Mega Drive</option><option value="gdrive">Google Drive</option></select></div><div class="field"><label>Kapasitas (GB)</label><input name="capacityGb" type="number" min="0" step="1" value="100" required></div><div class="field"><label>Telegram bot token</label><input name="botToken" type="password" autocomplete="off"></div><div class="field"><label>Telegram chat ID / channel ID</label><input name="chatId" autocomplete="off"></div><div class="field"><label>Mega email</label><input name="email" type="email" autocomplete="off"></div><div class="field"><label>Mega password</label><input name="password" type="password" autocomplete="off"></div><div class="field"><label>Google service account JSON</label><textarea name="serviceAccountJson" rows="6" autocomplete="off" placeholder="Tempel isi JSON service account"></textarea></div><div class="field"><label>Google Drive folder ID atau URL folder</label><input name="folderId" autocomplete="off"></div><p class="subtle">Isi hanya field sesuai jenis provider. Data konfigurasi disimpan untuk koneksi provider.</p>' : '<div class="field"><label>Nama folder</label><input name="name" required autofocus></div>'; document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="modal"><section class="modal"><h2>${title}</h2><form id="modal-form">${fields}<div class="modal-actions"><button type="button" class="secondary" id="close-modal">Batal</button><button class="primary">${isInvite ? 'Kirim invite' : isProvider ? 'Tambah storage' : 'Buat folder'}</button></div></form></section></div>`); document.querySelector('#close-modal').onclick = () => document.querySelector('#modal').remove(); document.querySelector('#modal-form').onsubmit = async (event) => { event.preventDefault(); try { const values = Object.fromEntries(new FormData(event.target)); const body = isProvider ? { name: values.name, kind: values.kind, capacityBytes: Number(values.capacityGb) * 1024 * 1024 * 1024, config: { botToken: values.botToken, chatId: values.chatId, email: values.email, password: values.password, serviceAccountJson: values.serviceAccountJson, folderId: values.folderId } } : { ...values, parentId: state.folderId }; await api(isInvite ? '/api/admin/users' : isProvider ? '/api/admin/providers' : '/api/folders',{method:'POST',body:JSON.stringify(body)}); document.querySelector('#modal').remove(); notify(isInvite ? 'Member berhasil diundang.' : isProvider ? 'Storage berhasil ditambahkan.' : 'Folder berhasil dibuat.'); if (isProvider || isInvite) await ke('admin'); else await ke('dashboard'); } catch (error) { notify(error.message); } }; }
export async function openMoveModal(kind, itemId, name) {
  const isFolder = kind === 'folder';
  const currentParentId = state.folderId || null;
  showLoading('Menyiapkan daftar folder...');
  try {
    const data = await api('/api/folders');
    const blocked = new Set(isFolder ? folderAndDescendants(itemId, data.folders) : []);
    const options = data.folders.filter((folder) => !blocked.has(folder.id)).map((folder) => `<option value="${folder.id}">${'&nbsp;&nbsp;&nbsp;'.repeat(folder.depth)}${esc(folder.name)}</option>`).join('');
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="move-modal"><section class="modal"><h2>Pindahkan ${isFolder ? 'folder' : 'file'}</h2><p class="subtle">${esc(name)}</p><form id="move-form"><div class="field"><label>Folder tujuan</label><select id="move-target"><option value="">Penyimpanan (root)</option>${options}</select></div><div class="modal-actions"><button type="button" class="secondary" id="close-move-modal">Batal</button><button class="primary">Pindahkan</button></div></form></section></div>`);
    document.querySelector('#close-move-modal').onclick = () => document.querySelector('#move-modal').remove();
    document.querySelector('#move-form').onsubmit = async (event) => {
      event.preventDefault();
      const target = document.querySelector('#move-target').value || null;
      document.querySelector('#move-modal').remove();
      if (target === currentParentId) { notify('Folder tujuan sama dengan lokasi sekarang.'); return; }
      try {
        await api(isFolder ? `/api/folders/${itemId}` : `/api/files/${itemId}`, { method:'PATCH', body:JSON.stringify(isFolder ? { parentId:target } : { folderId:target }) });
        notify(isFolder ? 'Folder dipindahkan.' : 'File dipindahkan.');
        await ke('dashboard');
      } catch (error) { notify(error.message); }
    };
  } catch (error) { notify(error.message); }
  finally { hideLoading(); }
}
export function moveFile(fileId, name) { return openMoveModal('file', fileId, name); }
export function moveFolder(folderId, name) { return openMoveModal('folder', folderId, name); }
export function openCdnModal(fileId, name, enabled, slug) {
  const url = slug ? `${location.origin}/cdn/${slug}` : '';
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="cdn-modal"><section class="modal"><h2>Link CDN</h2><p class="subtle">${esc(name)}</p><p class="subtle">${enabled ? 'Status: aktif — link di bawah bisa langsung dipakai di kode atau website.' : 'Status: nonaktif — aktifkan dulu kalau mau dipakai di kode atau website.'}</p>${url ? `<div class="field"><label>Link CDN</label><input id="cdn-link" readonly value="${esc(url)}"></div>` : ''}<div class="preview-actions">${url ? `<button class="secondary" id="copy-cdn">${icon('copy')} Salin link</button>` : ''}<button class="primary" id="toggle-cdn">${enabled ? 'Matikan CDN' : 'Aktifkan CDN'}</button><button class="secondary" id="close-cdn">Tutup</button></div></section></div>`);
  document.querySelector('#close-cdn').onclick = () => document.querySelector('#cdn-modal').remove();
  document.querySelector('#copy-cdn')?.addEventListener('click', async () => notify(await copyText(url) ? 'Link CDN disalin.' : 'Tidak bisa menyalin otomatis, salin manual dari kolom di atas.'));
  document.querySelector('#toggle-cdn').onclick = async () => { document.querySelector('#cdn-modal').remove(); await toggleCdn(fileId, !enabled); };
}
export async function toggleCdn(fileId, enabled) {
  try {
    const result = await api(`/api/files/${fileId}`, { method:'PATCH', body:JSON.stringify({ cdnEnabled:enabled }) });
    if (enabled && result?.cdnUrl) { await copyText(`${location.origin}${result.cdnUrl}`); notify(`CDN aktif: ${location.origin}${result.cdnUrl}`); }
    else notify(enabled ? 'CDN diaktifkan.' : 'CDN dimatikan. Link lamanya sudah tidak bisa diakses.');
    await ke('dashboard');
  } catch (error) { notify(error.message); }
}
