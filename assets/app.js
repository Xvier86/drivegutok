// Titik masuk aplikasi: menyusun rute layar, memasang listener global, lalu start.
import { api, animateView, hideLoading, notify, pasangDrawer, showLoading } from './js/core.js';
import { ke, rute } from './js/router.js';
import { applyRoleVisibility, state } from './js/state.js';
import { renderLogin } from './js/views/login.js';
import { bindAkun, renderAkun } from './js/views/akun.js';
import { bindCdnUpload, bindDashboard, bindFileFolderActions, bindMediaPreview, bindProviderPicker, bindUploadOptions, renderDashboard } from './js/views/files.js';
import { renderAdmin } from './js/views/admin.js';
import { renderTrash } from './js/views/trash.js';

rute.dashboard = renderDashboard;
rute.admin = renderAdmin;
rute.trash = renderTrash;
rute.akun = renderAkun;
rute.login = renderLogin;

// Google mengembalikan browser ke /?google=ok setelah Owner menyambungkan akun Drive-nya. Kueri itu
// dibaca sekali lalu dibersihkan, supaya muat ulang berikutnya tidak menampilkan notifikasi yang
// sama. location hanya dibaca kalau benar-benar string — di uji DOM tiruan location adalah Proxy.
const hasilGoogle = () => { if (typeof location?.search !== 'string') return ''; const cocok = /[?&]google=([^&]*)/.exec(location.search); if (!cocok) return ''; history.replaceState(null, '', location.pathname); return decodeURIComponent(cocok[1]); };
export async function start() { hideLoading(); try { const me = await api('/api/me'); state.user = me.user; const google = hasilGoogle(); if (google) { await ke('admin'); notify(google === 'ok' ? 'Akun Google tersambung. Tekan Aktifkan kalau providernya belum menyala.' : `Login Google gagal: ${google}`); return; } await ke('dashboard'); } catch (error) { hideLoading(); await ke('login', error.message === 'Unauthorized' ? '' : error.message); } finally { hideLoading(); } }

document.addEventListener('submit', (event) => { if (event.target.id === 'setup-form') showLoading('Menyiapkan workspace...'); if (event.target.id === 'login-form') showLoading('Memeriksa kredensial...'); });
// Keluar dan chip akun ditangani sekali di sini (delegasi), bukan per layar: keduanya ada di sidebar
// dan header semua layar, sehingga ikatan per view mudah tertinggal saat layar baru ditambah.
document.addEventListener('click', async (event) => {
  if (event.target.closest('#logout')) {
    showLoading('Keluar dari Gutok Drive...');
    try { await api('/api/logout', { method: 'POST' }); state.user = null; await ke('login'); }
    catch (error) { notify(error.message); hideLoading(); }
    return;
  }
  if (event.target.closest('.user-menu')) await ke('akun');
});

// Dipanggil sekali per render (bukan tiap perubahan DOM). bindAkun() mengembalikan lebih awal kalau
// layar aktif bukan Pengaturan akun, jadi urutan pemanggilan tidak perlu dijaga.
const pasangUlang = () => { bindDashboard(); bindMediaPreview(); bindFileFolderActions(); bindCdnUpload(); bindProviderPicker(); bindUploadOptions(); bindAkun(); pasangDrawer(); applyRoleVisibility(); animateView(); };
document.addEventListener('layar-siap', pasangUlang);

start();
