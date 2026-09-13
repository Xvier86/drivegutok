// Titik masuk aplikasi: menyusun rute layar, memasang listener global, lalu start.
import { api, app, animateView, hideLoading, showLoading } from './js/core.js';
import { rute } from './js/router.js';
import { applyRoleVisibility, state } from './js/state.js';
import { renderLogin } from './js/views/login.js';
import { bindCdnUpload, bindDashboard, bindFileFolderActions, bindMediaPreview, bindProviderPicker, bindUploadOptions, fixTemplateArtifacts, renderDashboard } from './js/views/files.js';
import { renderAdmin } from './js/views/admin.js';
import { bindTrashView, renderTrash } from './js/views/trash.js';

rute.dashboard = renderDashboard;
rute.admin = renderAdmin;
rute.trash = renderTrash;
rute.login = renderLogin;

export async function start() { hideLoading(); try { const me = await api('/api/me'); state.user = me.user; await renderDashboard(); } catch (error) { hideLoading(); await renderLogin(error.message === 'Unauthorized' ? '' : error.message); } finally { hideLoading(); } }

document.addEventListener('submit', (event) => { if (event.target.id === 'setup-form') showLoading('Menyiapkan workspace...'); if (event.target.id === 'login-form') showLoading('Memeriksa kredensial...'); });
document.addEventListener('click', (event) => { if (event.target.closest('#logout')) { showLoading('Keluar dari Gutok Drive...'); setTimeout(hideLoading, 1400); } });

const mediaObserver = new MutationObserver(() => { fixTemplateArtifacts(); bindMediaPreview(); bindFileFolderActions(); bindCdnUpload(); bindProviderPicker(); bindUploadOptions(); applyRoleVisibility(); animateView(); });
mediaObserver.observe(app, { childList: true, subtree: true });

start();
