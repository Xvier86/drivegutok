// Pengaturan akun: ubah email dan ganti sandi.
//
// Layar ini hanya menyentuh identitas akun sendiri, jadi tidak butuh peran khusus — member dan owner
// memakai halaman yang sama. Yang dijaga ada di server: kedua endpoint PATCH menuntut password saat
// ini, sebab sesi 7 hari yang bocor tidak boleh cukup untuk mengambil alih akun (lihat catatan di
// server.js pada /api/account/email).
import { api, app, esc, hideLoading, icon, notify, showLoading } from '../core.js';
import { state } from '../state.js';
import { ke } from '../router.js';

// Chip akun di header. Dipakai layar ini sendiri (dan layar lain lewat .user-menu) sebagai satu-satunya
// jalan masuk ke halaman ini, karena itu elemennya <button>, bukan <div>: harus bisa dijangkau Tab.
export const chipAkun = () => `<button class="user-menu" id="akun-view" title="Pengaturan akun"><span class="text-right"><strong>${esc(state.user?.username)}</strong><small>${state.user?.role === 'owner' ? 'Owner' : 'Member'}</small></span><span class="avatar">${esc(state.user?.username?.[0]?.toUpperCase())}</span></button>`;

export function renderAkun() {
  // Tidak ada permintaan ke server di sini: state.user sudah dimuat app.js lewat /api/me, dan setelah
  // email diganti handler di bawah memperbarui state.user lalu merender ulang layar ini.
  const email = state.user?.email || '';
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><img src="/logo.jpg" alt="" class="brand-logo" width="26" height="26">Gutok<span>Drive</span></div><div><p class="workspace-label">Akun</p><nav class="nav"><button id="akun-back">${icon('arrow-left')} Semua file</button><button class="active">${icon('user-round')} Pengaturan akun</button></nav></div><div class="sidebar-bottom"><p class="workspace-label">Masuk sebagai</p><div class="provider-mini">${esc(email)}</div><div class="provider-mini">${state.user?.role === 'owner' ? 'Owner' : 'Member'}</div><button class="side-link btn-block mt-md" id="logout">${icon('log-out')} Keluar</button></div></aside><main class="main"><header class="topbar"><div><p class="eyebrow">Personal workspace / Akun</p><h1 class="view-title">Pengaturan akun</h1></div>${chipAkun()}</header><p class="subtle">Ubah alamat email dan sandi akunmu. Kedua formulir meminta password saat ini lebih dulu, supaya sesi yang bocor tidak cukup untuk mengambil alih akun.</p><div class="akun-forms"><section class="panel"><div class="panel-heading"><h2>Alamat email</h2><span class="eyebrow">${email ? `aktif: ${esc(email)}` : 'belum ada'}</span></div><form id="form-akun-email"><div class="field"><label for="akun-email-baru">Email baru</label><input id="akun-email-baru" name="email" type="email" required autocomplete="email" value="${esc(email)}"></div><div class="field"><label for="akun-email-password">Password saat ini</label><input id="akun-email-password" name="currentPassword" type="password" required autocomplete="current-password"></div><p class="subtle">Email baru langsung aktif setelah disimpan: aplikasi ini tidak mengirim email verifikasi.</p><div class="action-row mt-md"><button class="primary">Simpan email</button></div></form></section><section class="panel"><div class="panel-heading"><h2>Sandi</h2><span class="eyebrow">minimal 8 karakter</span></div><form id="form-akun-sandi"><div class="field"><label for="akun-password-lama">Password saat ini</label><input id="akun-password-lama" name="currentPassword" type="password" required autocomplete="current-password"></div><div class="field"><label for="akun-password-baru">Password baru</label><input id="akun-password-baru" name="newPassword" type="password" minlength="8" required autocomplete="new-password"></div><div class="field"><label for="akun-password-ulang">Konfirmasi password baru</label><input id="akun-password-ulang" name="confirmPassword" type="password" minlength="8" required autocomplete="new-password"></div><p class="subtle">Setelah sandi diganti, sesi di perangkat lain langsung berakhir. Perangkat ini tetap masuk.</p><div class="action-row mt-md"><button class="primary">Simpan sandi</button></div></form></section></div></main></div>`;
}

export function bindAkun() {
  const formEmail = document.querySelector('#form-akun-email');
  const formSandi = document.querySelector('#form-akun-sandi');
  if (!formEmail || !formSandi) return; // layar lain: jangan sentuh apa pun
  document.querySelector('#akun-back').onclick = () => ke('dashboard');
  formEmail.onsubmit = async (event) => {
    event.preventDefault();
    showLoading('Menyimpan email...');
    try {
      const data = await api('/api/account/email', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      state.user = { ...state.user, email: data.user.email };
      // Server yang menentukan apakah alamat baru butuh verifikasi (`verificationRequired`); teks toast
      // mengikuti nilai itu supaya penjelasannya tidak pernah bertentangan dengan alur server.
      notify(data.verificationRequired ? `Email diperbarui ke ${data.user.email}. Cek kotak masuk untuk memverifikasi alamat baru.` : `Email diperbarui ke ${data.user.email}. Langsung aktif, tanpa email verifikasi.`);
      await ke('akun');
    } catch (error) { notify(error.message); }
    finally { hideLoading(); }
  };
  formSandi.onsubmit = async (event) => {
    event.preventDefault();
    showLoading('Menyimpan sandi...');
    try {
      const data = await api('/api/account/password', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      event.target.reset();
      notify(data.otherSessionsEnded ? `Sandi diperbarui. ${data.otherSessionsEnded} sesi lain diakhiri.` : 'Sandi diperbarui.');
    } catch (error) { notify(error.message); }
    finally { hideLoading(); }
  };
}
