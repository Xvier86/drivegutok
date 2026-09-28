// Form tambah provider dari kartu pintasan dashboard.
//
// Dipisah dari views/files.js karena alasan praktis: kartu pintasan ada di dashboard (dimuat semua
// peran), sedangkan kode ini hanya dipakai Owner. Diimpor dinamis dari files.js, sehingga member tidak
// pernah mengunduhnya.
//
// Bedanya dari openModal('provider') di Owner control: jenis provider sudah ditentukan oleh kartu
// yang diklik, jadi memilih jenis tidak lagi jadi langkah yang bisa salah — dan kolom yang tidak
// relevan tidak pernah ditampilkan.
import { api, closeDialog, notify, openDialog } from '../core.js';
import { ke } from '../router.js';
import { KOLOM_PROVIDER_JENIS } from './files.js';

const NAMA = { telegram: 'Telegram Channel', mega: 'Mega Drive', gdrive: 'Google Drive (service account)' };
const SARAN = { telegram: 'Telegram utama', mega: 'Mega utama', gdrive: 'Google Drive service account' };

export function openModalProvider(kind) {
  const jenis = KOLOM_PROVIDER_JENIS[kind] ? kind : 'mega';
  document.body.insertAdjacentHTML('beforeend', `<dialog class="modal" id="modal-provider"><h2>Tambah ${NAMA[jenis]}</h2><form id="provider-form">
    <div class="field"><label for="field-name">Nama storage</label><input id="field-name" name="name" value="${SARAN[jenis]}" required autofocus></div>
    <div class="field"><label for="field-capacityGb">Kapasitas (GB)</label><input id="field-capacityGb" name="capacityGb" type="number" min="0" step="1" value="100" required></div>
    ${KOLOM_PROVIDER_JENIS[jenis]}
    <p class="subtle">Kalau ingin Google Drive dengan login akun (satu klik, tanpa Client ID), pakai kartu "Tambah Google Drive" di dashboard.</p>
    <div class="modal-actions"><button type="button" class="secondary" id="close-provider">Batal</button><button class="primary">Tambah storage</button></div>
  </form></dialog>`);
  openDialog('modal-provider');
  document.querySelector('#close-provider').onclick = () => closeDialog('modal-provider');
  document.querySelector('#provider-form').onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    try {
      await api('/api/admin/providers', { method: 'POST', body: JSON.stringify({
        name: values.name,
        kind: jenis,
        capacityBytes: Number(values.capacityGb) * 1024 * 1024 * 1024,
        config: { botToken: values.botToken, chatId: values.chatId, email: values.email, password: values.password, serviceAccountJson: values.serviceAccountJson, folderId: values.folderId },
      }) });
      closeDialog('modal-provider');
      notify('Storage berhasil ditambahkan.');
      await ke('admin');
    } catch (error) { notify(error.message); }
  };
}
