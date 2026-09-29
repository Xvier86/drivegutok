// Owner control: ringkasan sistem, anggota, dan provider storage.
import { api, app, closeDialog, esc, formatBytes, hideLoading, icon, notify, openDialog, showLoading } from '../core.js';
import { formatDateTime } from '../state.js';
import { ke } from '../router.js';
import { openModal } from './files.js';
import { chipAkun } from './akun.js';

export function openProviderConfigModal(providerId, kind, authMode) {
  // Redirect URI Google harus SAMA PERSIS dengan yang didaftarkan Owner di Google Cloud Console,
  // jadi nilainya ditampilkan untuk disalin, bukan ditebak. location hanya dibaca kalau benar-benar
  // string: di uji DOM tiruan location adalah Proxy, bukan object Location.
  const redirectGoogle = typeof location?.origin === 'string' ? `${location.origin}/api/admin/providers/${providerId}/google/callback` : `/api/admin/providers/${providerId}/google/callback`;
  const fields = kind === 'telegram' ? '<div class="field"><label for="field-botToken">Telegram bot token</label><input id="field-botToken" name="botToken" type="password" required autocomplete="off"></div><div class="field"><label for="field-chatId">Channel ID atau owner ID</label><input id="field-chatId" name="chatId" placeholder="-100... atau 5699294528" autocomplete="off"></div><p class="subtle">Bot harus menjadi admin channel, atau user harus sudah menekan Start pada bot.</p>' : kind === 'mega' ? '<div class="field"><label for="field-email">Mega email</label><input id="field-email" name="email" type="email" required autocomplete="off"></div><div class="field"><label for="field-password">Mega password</label><input id="field-password" name="password" type="password" required autocomplete="off"></div>' : `<div class="field"><label for="gdrive-auth">Cara akses</label><select name="authMode" id="gdrive-auth"><option value="oauth">Login akun Google</option><option value="service">Service account (JSON)</option></select></div><div id="gdrive-oauth"><p class="subtle">Klien OAuth Google HARUS bertipe <strong>Web application</strong>. Klien <em>Desktop</em> tidak punya kolom Authorized redirect URIs, jadi login akun selalu ditolak <code>redirect_uri_mismatch</code> dan tidak bisa diperbaiki dari sini. Daftarkan redirect URI: <code id="gdrive-redirect-uri"></code></p><div class="field"><label for="field-clientId">Google OAuth Client ID</label><input id="field-clientId" name="clientId" placeholder="Client ID dari Google Cloud Console, mis. 1234567890-abc.apps.googleusercontent.com" autocomplete="off"></div><a class="subtle" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Buka Google Cloud Console (buat Client ID)</a><div class="field"><label for="field-clientSecret">Google OAuth Client secret</label><input id="field-clientSecret" name="clientSecret" type="password" placeholder="kosongkan kalau sudah tersimpan" autocomplete="off"></div><div class="field"><label for="field-refreshToken">Refresh token akun Google</label><input id="field-refreshToken" name="refreshToken" type="password" placeholder="terisi sendiri setelah login" autocomplete="off"></div><div class="field"><label for="field-folderId">Folder tujuan — opsional</label><input id="field-folderId" name="folderId" placeholder="kosongkan = folder utama (My Drive) akun ini" autocomplete="off"></div><button type="button" class="secondary" id="google-login">Login dengan Google</button><p class="subtle" id="gdrive-oauth-hint">Isi Client ID dan Client secret lebih dulu, lalu klik <strong>Login dengan Google</strong> — akun ini langsung tersambung, penyimpanannya terbaca, dan providernya dinyalakan otomatis. Folder boleh dikosongkan. Daftarkan redirect URI ini di Google Cloud Console (aplikasi Web): <code>${redirectGoogle}</code></p><p class="subtle" id="gdrive-oauth-alasan" hidden></p></div><div id="gdrive-service"><div class="field"><label for="field-serviceAccountJson">Google service account JSON</label><textarea id="field-serviceAccountJson" name="serviceAccountJson" rows="8" placeholder="Tempel isi JSON service account"></textarea></div><div class="field"><label for="field-folderIdService">Folder Shared Drive</label><input id="field-folderIdService" name="folderId" placeholder="https://drive.google.com/drive/folders/..." autocomplete="off"></div><p class="subtle">Service account WAJIB memakai folder di Shared Drive (service account tidak punya kuota My Drive sendiri). URL folder dinormalisasi otomatis; beri akses Content manager.</p></div>`; document.body.insertAdjacentHTML('beforeend', `<dialog class="modal" id="modal"><h2>Konfigurasi ${esc(kind)}</h2><form id="provider-config-form">${fields}<div class="modal-actions"><button type="button" class="secondary" id="close-modal">Batal</button><button class="primary">Simpan konfigurasi</button></div></form></dialog>`); openDialog('modal');   // Dua cara akses Google Drive saling meniadakan: kelompok kolom yang tidak dipakai dinonaktifkan
  // supaya tidak ikut terkirim (kolom disabled tidak masuk FormData) dan tidak menahan tombol Simpan
  // lewat validasi. Kolom rahasia sengaja tidak `required`: nilai kosong berarti "biarkan seperti
  // semula" di server, jadi refresh token yang tidak bisa ditampilkan ulang tidak pernah terhapus.
  const pilihAkses = document.querySelector('#gdrive-auth');
  if (pilihAkses) {
    pilihAkses.value = authMode === 'oauth' ? 'oauth' : 'service';
    const aturAkses = () => {
      const oauth = pilihAkses.value === 'oauth';
      document.querySelector('#gdrive-service').hidden = oauth;
      document.querySelector('#gdrive-oauth').hidden = !oauth;
      document.querySelector('#gdrive-service').querySelectorAll('input, textarea').forEach((kolom) => { kolom.disabled = oauth; });
      document.querySelector('#gdrive-oauth').querySelectorAll('input').forEach((kolom) => { kolom.disabled = !oauth; });
    };
    aturAkses();
    pilihAkses.onchange = aturAkses;
  }
  const tombolGoogle = document.querySelector('#google-login');
  if (tombolGoogle) tombolGoogle.onclick = async () => {
    const form = document.querySelector('#provider-config-form');
    if (!form.reportValidity()) return;
    try {
      // Rute login membaca client ID/secret dari database, jadi simpan dulu sebelum pindah ke Google.
      await api(`/api/admin/providers/${providerId}`, { method: 'PATCH', body: JSON.stringify({ config: Object.fromEntries(new FormData(form)) }) });
      location.assign(`/api/admin/providers/${providerId}/google/login`);
    } catch (error) { notify(error.message); }
  };
  document.querySelector('#close-modal').onclick = () => closeDialog('modal'); document.querySelector('#provider-config-form').onsubmit = async (event) => { event.preventDefault(); try { await api(`/api/admin/providers/${providerId}`, { method:'PATCH', body:JSON.stringify({ config:Object.fromEntries(new FormData(event.target)) }) }); closeDialog('modal'); notify('Konfigurasi storage tersimpan. OAuth Google dibuat otomatis.'); await ke('admin'); } catch (error) { notify(error.message); } }; }
// Status visual provider: merah redup = belum siap/kuota error, amber = aktif, abu = nonaktif. Satu
// sumber saja supaya warna dot dan badge tidak pernah bertentangan.
const statusProvider = (provider) => (!provider.configured || provider.capacityError ? 'error' : provider.enabled ? 'on' : 'off');
const labelStatus = (provider) => (!provider.configured ? 'Belum siap' : provider.capacityError ? 'Kuota error' : provider.enabled ? 'Aktif' : 'Nonaktif');
// Format timeline: tanggal panjang hanya di header grup, tiap entri cukup jam.
const tanggalHari = (value) => new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
const jamSaja = (value) => new Date(value).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

export async function renderAdmin() { const data = await api('/api/admin/overview');
  const aktif = data.users.filter((user) => user.status === 'active').length;
  const aktifProvider = data.providers.filter((provider) => statusProvider(provider) === 'on').length;
  // Satu fakta per badge: status, terpakai, kuota, kelengkapan kredensial, dan setiap kolom yang
  // belum diisi tampil sendiri — tidak ada lagi satu kalimat panjang yang digabung "·".
  // Telegram tidak melaporkan kuota channel, jadi badge-nya menyebut byte yang benar-benar terkirim
  // ke Telegram — bukan "kuota tak dilaporkan" yang di provider lain berarti kapasitas manual kosong.
  const badgePakai = (provider) => provider.kind === 'telegram' ? `<span class="badge">${formatBytes(provider.used_bytes)} terkirim ke Telegram</span>` : `<span class="badge">${formatBytes(provider.used_bytes)} terpakai</span>`;
  // Bot API Telegram tak punya endpoint kuota, jadi yang tampil adalah kapasitas manual yang diisi
  // Owner saat menambah provider — bukan badge yang hilang. Kapasitas 0 tetap "tak dilaporkan".
  const badgeKuota = (provider) => provider.capacity_bytes > 0 ? `<span class="badge">dari ${formatBytes(provider.capacity_bytes)}</span>` : provider.kind === 'telegram' ? '' : '<span class="badge warn">kuota tak dilaporkan</span>';
  // Google yang tidak melaporkan kuota bukan angka nol yang perlu disembunyikan: sebut alasannya
  // supaya Owner tidak menyimpulkan "penyimpanan Google belum terbaca" padahal jawabannya memang
  // tidak tersedia dari API (service account tanpa kuota sendiri; kuota Shared Drive dipool).
  const badgeCatatan = (provider) => provider.capacityNote ? `<span class="badge">${esc(provider.capacityNote)}</span>` : '';
  const badgeProvider = (provider) => [`<span class="badge ${statusProvider(provider)}">${esc(labelStatus(provider))}</span>`, badgePakai(provider), badgeKuota(provider), badgeCatatan(provider), ...(provider.configured ? ['<span class="badge">Kredensial lengkap</span>'] : provider.missing.map((key) => `<span class="badge warn">belum diisi: ${esc(key)}</span>`)), ...(provider.capacityError ? [`<span class="badge error">${esc(provider.capacityError)}</span>`] : [])].join('');
  const barisProvider = (provider) => `<div class="provider provider-row"><div class="provider-id"><div class="provider-name"><span class="dot ${statusProvider(provider)}"></span>${esc(provider.name)}<span class="provider-kind">${esc(provider.kind === 'gdrive' ? 'Google Drive' : provider.kind === 'telegram' ? 'Telegram' : 'Mega')}</span></div><div class="badge-row">${badgeProvider(provider)}</div>${provider.capacity_bytes > 0 ? `<meter class="provider-meter" min="0" max="${provider.capacity_bytes}" value="${Math.min(provider.used_bytes, provider.capacity_bytes)}" aria-label="Pemakaian ${esc(provider.name)}">${formatBytes(provider.used_bytes)} dari ${formatBytes(provider.capacity_bytes)}</meter>` : ''}</div><div class="action-row m-0 provider-aksi"><button class="ghost provider-config" data-provider="${provider.id}" data-kind="${provider.kind}" data-auth="${esc(provider.authMode || '')}">${provider.configured ? 'Ubah konfigurasi' : 'Konfigurasi'}</button><button class="ghost provider-toggle" data-provider="${provider.id}" data-kind="${provider.kind}" data-enabled="${provider.enabled}">${provider.enabled ? 'Nonaktifkan' : provider.configured ? 'Aktifkan' : 'Belum siap'}</button><button class="ghost danger provider-hapus" data-provider="${provider.id}" data-nama="${esc(provider.name)}" title="Hapus provider ini">${icon('trash-2',14)} Hapus</button></div></div>`;
  // Satu baris per member, bukan kotak kartu: identitas, badge peran, badge status, sejak, dan tombol
  // sejajar dalam satu list berhairline. Owner tidak diberi tombol karena server menolak mencabut
  // aksesnya (workspace bisa terkunci tanpa jalan masuk).
  const barisMember = (member) => `<div class="member-row"><div class="member-id"><span class="member-nama">${esc(member.username)}</span><span class="member-email">${esc(member.email)}</span></div><span class="badge">${member.role === 'owner' ? 'Owner' : 'User'}</span><span class="badge ${member.status === 'active' ? 'on' : 'off'}">${member.status === 'active' ? 'Akses aktif' : 'Akses dicabut'}</span><span class="badge">${member.file_count} file</span><span class="badge">${formatBytes(member.file_bytes)}</span><button class="ghost member-files" data-member="${member.id}" data-username="${esc(member.username)}">${icon('folder-search',14)} Lihat berkas</button><span class="member-sejak">sejak ${formatDateTime(member.created_at)}</span>${member.role === 'owner' ? '<span class="badge">Tidak bisa dicabut</span>' : `<button class="ghost member-access" data-member="${member.id}" data-username="${esc(member.username)}" data-status="${member.status}">${member.status === 'active' ? `${icon('user-x',14)} Cabut akses` : `${icon('user-check',14)} Pulihkan akses`}</button>`}</div>`;
  // Timeline: tanggal jadi header grup sekali per hari, baris di bawahnya cukup jam — "13 Sep 2026"
  // tidak diulang. Garis penghubung antar entri digambar CSS (.tl-item::before), bukan elemen extra.
  let hariLalu = '';
  const barisLog = (entry) => { const hari = new Date(entry.created_at).toDateString(); const kepala = hari === hariLalu ? '' : `<li class="tl-hari">${tanggalHari(entry.created_at)}</li>`; hariLalu = hari; return `${kepala}<li class="tl-item"><span class="tl-titik"></span><div class="tl-isi"><p class="tl-aksi">${esc(entry.action)}<span class="badge">${esc(entry.target_type)}</span></p><p class="tl-oleh">oleh ${esc(entry.username)}</p></div><time class="tl-jam">${jamSaja(entry.created_at)}</time></li>`; };
  // Judul "Kendali workspace" sudah menyebut halaman ini; label ALL CAPS "OWNER CONTROL" di atasnya
  // cuma pengulangan, jadi dihapus (kelompok nav sidebar tetap memberi konteks).
  // Jalur menambah penyimpanan juga disediakan di halaman ini (bukan hanya dashboard): pemilik yang
  // sudah berada di Kendali workspace tidak perlu kembali ke layar file untuk menambah akun.
  const pintasanKendali = ['gdrive', 'mega', 'telegram'].map((jenis) => {
    const nama = jenis === 'gdrive' ? 'Tambah Google Drive' : jenis === 'mega' ? 'Tambah Mega' : 'Tambah Telegram';
    const ikon = jenis === 'gdrive' ? 'cloud' : jenis === 'mega' ? 'hard-drive' : 'send';
    return `<button class="ghost tambah-cepat" data-tambah="${jenis}">${icon(ikon,16)} ${nama}</button>`;
  }).join('');
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><img src="/logo.jpg" alt="" class="brand-logo" width="26" height="26">Gutok<span>Drive</span></div><div><p class="workspace-label">Kendali</p><nav class="nav" aria-label="Kendali workspace"><button id="back-dashboard">${icon('arrow-left')} Kembali ke file</button><button class="active" aria-current="page">${icon('settings-2')} Kendali workspace</button></nav></div><div class="sidebar-bottom"><p class="workspace-label">Ringkasan</p><div class="sidebar-stats"><div class="stat"><span class="stat-nama">File</span><span class="stat-angka">${data.files.count}</span></div><div class="stat"><span class="stat-nama">Ukuran</span><span class="stat-angka">${formatBytes(data.files.bytes)}</span></div><div class="stat"><span class="stat-nama">Akun</span><span class="stat-angka">${data.users.length}</span></div><div class="stat"><span class="stat-nama">Akses aktif</span><span class="stat-angka">${aktif}</span></div></div></div></aside><main class="main"><header class="topbar"><span class="subtle">Workspace / Kendali</span>${chipAkun()}</header><div class="view-head"><div><h1 class="view-title">Kendali workspace</h1><p class="subtle">Kelola koneksi storage dan orang yang punya akses.</p></div><div class="action-row m-0"><button class="secondary" id="add-gdrive" title="Sambungkan satu akun Google: cukup klik lalu izinkan akses Drive">${icon('plus')} Tambah Google Drive</button><button class="secondary" id="add-provider">${icon('hard-drive')} Tambah storage lain</button><button class="primary" id="invite-user">${icon('user-plus')} Invite member</button></div>
      <p class="subtle" id="gdrive-hint"></p></div><div class="layout"><div class="right-column"><section class="panel"><div class="panel-heading"><h2>Provider storage</h2><div class="badge-row"><span class="badge">${data.providers.length} provider</span><span class="badge ${aktifProvider ? 'on' : 'off'}">${aktifProvider} aktif</span></div></div><div class="action-row m-0 tambah-cepat-baris">${pintasanKendali}</div><div class="provider-list animasi-daftar">${data.providers.map(barisProvider).join('') || '<p class="subtle">Belum ada provider storage.</p>'}</div></section><section class="panel"><div class="panel-heading"><h2>Member</h2><div class="badge-row"><span class="badge">${data.users.length} akun</span><span class="badge">${aktif} akses aktif</span></div></div><div class="member-list animasi-daftar">${(data.fileUsers || data.users).map(barisMember).join('')}</div></section></div><aside class="right-column"><section class="panel stats"><h3>Aktivitas terkini</h3>${data.logs.length ? `<ul class="timeline animasi-daftar">${data.logs.map(barisLog).join('')}</ul>` : '<p class="subtle">Belum ada aktivitas.</p>'}</section></aside></div></main></div>`;
  document.querySelector('#back-dashboard').onclick = () => ke('dashboard');
  document.querySelector('#invite-user').onclick = () => openModal('invite');
  document.querySelector('#add-provider').onclick = () => openModal('provider');
  // Tombol "Tambah …" di baris Kendali workspace memakai jalur yang sama dengan kartu pintasan
  // dashboard — satu perilaku, dua tempat.
  document.querySelectorAll('.tambah-cepat').forEach((tombol) => tombol.onclick = async () => {
    const jenis = tombol.dataset.tambah;
    if (jenis === 'gdrive') { showLoading('Menyiapkan akun Google...'); location.assign('/api/admin/google/tambah'); return; }
    const { openModalProvider } = await import('./admin-provider.js');
    openModalProvider(jenis);
  });
  // Satu klik: server membuat provider + memakai kredensial OAuth aplikasi, lalu mengalihkan ke
  // halaman izin Google. Tidak ada form yang perlu diisi lebih dulu.
  document.querySelector('#add-gdrive').onclick = () => { showLoading('Menyiapkan akun Google...'); location.assign('/api/admin/google/tambah'); };
  // Petunjuk alamat pendaftaran: menghapus langkah menebak di Google Cloud Console, tapi tidak
  // ditampilkan kalau server belum punya kredensial aplikasi (tombolnya memang belum bisa dipakai).
  fetch('/api/admin/overview').then((r) => r.json()).then((ov) => {
    const bawaan = ov.googleOAuthBawaan || {};
    const hint = document.querySelector('#gdrive-hint');
    const sudahSiap = ov.providers.some((p) => p.kind === 'gdrive' && p.configured);
    if (hint) {
      if (bawaan.clientId) {
        hint.textContent = `Kredensial aplikasi sudah terpasang (…${bawaan.clientId.slice(-12)}). Sekali daftar, semua akun berikutnya langsung: Google Cloud Console → APIs & Services → Credentials → OAuth client ID (aplikasi Web) → Authorized redirect URIs → tambahkan ${bawaan.redirectUri}`;
      } else if (!sudahSiap) {
        hint.textContent = 'Server belum punya kredensial OAuth aplikasi. Setel GOOGLE_OAUTH_CLIENT_ID & GOOGLE_OAUTH_CLIENT_SECRET, atau tambah provider manual lewat "Tambah storage lain".';
      }
    }
    // Modal konfigurasi manual: tampilkan alamat persis yang perlu didaftarkan di sana juga, karena
    // alamat itu wajib sama persis dan tidak boleh ditebak.
    const diModal = document.querySelector('#gdrive-redirect-uri');
    if (diModal && bawaan.redirectUri) diModal.textContent = bawaan.redirectUri;
  }).catch(() => {});
  document.querySelectorAll('.provider-config').forEach((button) => button.onclick = () => openProviderConfigModal(button.dataset.provider, button.dataset.kind, button.dataset.auth));
  document.querySelectorAll('.provider-toggle').forEach((button) => button.onclick = async () => { if (button.textContent.trim() === 'Belum siap') return openProviderConfigModal(button.dataset.provider, button.dataset.kind, button.dataset.auth); try { await api(`/api/admin/providers/${button.dataset.provider}`,{method:'PATCH',body:JSON.stringify({enabled:button.dataset.enabled !== '1'})}); ke('admin'); } catch (error) { notify(error.message); } });
  document.querySelectorAll('.provider-hapus').forEach((button) => button.onclick = async () => {
    if (!confirm(`Hapus provider "${button.dataset.nama}"? Berkas yang tersimpan di dalamnya harus sudah dipindahkan/dihapus lebih dulu.`)) return;
    showLoading('Menghapus provider...');
    try { await api(`/api/admin/providers/${button.dataset.provider}`, { method: 'DELETE' }); notify('Provider dihapus.'); await ke('admin'); }
    catch (error) { notify(error.message); hideLoading(); }
  });
  document.querySelectorAll('.member-access').forEach((button) => button.onclick = () => setMemberAccess(button));
  // Membuka penyimpanan milik user lain. Hanya Owner yang sampai ke layar ini (rute adminBerkas
  // dipanggil dari Kendali workspace), dan servernya sendiri juga menolak peran selain Owner.
  document.querySelectorAll('.member-files').forEach((button) => button.onclick = () => ke('adminBerkas', button.dataset.member, ''));
}
// Cabut/pulihkan akses member. Server menghapus sesi aktif begitu akses dicabut, jadi user yang
// sedang login langsung tidak bisa memakai API lagi (currentUser menolak status selain 'active').
async function setMemberAccess(button) {
  const aktif = button.dataset.status === 'active';
  if (!confirm(aktif ? `Cabut akses "${button.dataset.username}"? Sesi yang sedang berjalan langsung berakhir dan login berikutnya ditolak. File miliknya tetap tersimpan.` : `Pulihkan akses "${button.dataset.username}"? User bisa masuk lagi seperti biasa.`)) return;
  showLoading(aktif ? 'Mencabut akses...' : 'Memulihkan akses...');
  try {
    await api(`/api/admin/users/${button.dataset.member}`, { method:'PATCH', body:JSON.stringify({ status: aktif ? 'suspended' : 'active' }) });
    notify(aktif ? `Akses ${button.dataset.username} dicabut.` : `Akses ${button.dataset.username} dipulihkan.`);
    await ke('admin');
  } catch (error) { notify(error.message); }
  finally { hideLoading(); }
}
