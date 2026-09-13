// Inti: referensi DOM, helper tampilan, pembungkus fetch, dan notifikasi.
// Ikon dibangun sebagai SVG inline oleh ikon.js — tidak ada skrip pihak ketiga di browser.
import { icon } from './ikon.js';
export { icon };
export const app = document.querySelector('#app');
export const toast = document.querySelector('#toast');
export const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
export const formatBytes = (bytes = 0) => bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export const notify = (message) => { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); };
export function showLoading(message = 'Memproses...') { if (document.querySelector('#loading-overlay')) return; document.body.insertAdjacentHTML('beforeend', `<div class="loading-overlay" id="loading-overlay"><div class="loading-card"><span class="loading-spinner"></span><strong>${esc(message)}</strong><span class="loading-dots">Mohon tunggu</span></div></div>`); }
export function hideLoading() { document.querySelector('#loading-overlay')?.remove(); }
export async function api(path, options = {}) { const headers = options.body instanceof FormData ? { ...(options.headers || {}) } : { 'content-type':'application/json', ...(options.headers || {}) }; const batasMs = options.body instanceof FormData ? 30 * 60 * 1000 : 15000; const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), batasMs); let response; try { response = await fetch(path, { headers, ...options, signal: controller.signal }); } catch (error) { if (error.name === 'AbortError') throw new Error('Server terlalu lama merespons. Periksa log PM2 dan konfigurasi Nginx.'); throw new Error('Server tidak dapat dihubungi. Pastikan npm start berjalan pada port yang benar.'); } finally { clearTimeout(timeout); } const contentType = response.headers.get('content-type') || ''; // Balasan non-JSON (mis. halaman 524 dari Cloudflare saat unggahan besar diputus) dulu disetor utuh ke toast:
  // ratusan karakter HTML yang tidak terbaca. Sekarang hanya status + 120 karakter pertama.
  const potongan = contentType.includes('application/json') ? null : (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const data = response.status === 204 ? null : potongan === null ? await response.json() : { error: `Server menjawab ${response.status}: ${potongan || 'tanpa keterangan'}` };
  if (!response.ok) throw new Error(data?.error || `Server error (${response.status}).`); return data; }
export function animateView() { app.classList.remove('view-enter'); void app.offsetWidth; app.classList.add('view-enter'); }

// Sidebar off-canvas di panel sempit (<720px lebar panel, lihat @container di base.css). Tombol
// hamburger dan scrim disisipkan dari sini, bukan dari tiga markup view (file, Sampah, Owner
// control), supaya perilakunya satu dan tidak bisa lupa dipasang di salah satu layar.
// Keadaan drawer cuma satu kelas di <body> (`is-drawer`): CSS yang menggeser sidebar, menggelapkan
// scrim, dan mengunci scroll — jadi JS tidak perlu tahu soal animasi.
// Penjaga `topbar.querySelector('#drawer-toggle')` sama polanya dengan bindCdnUpload(): setiap render
// menghasilkan markup baru, jadi ikatan dipasang sekali per render, bukan menumpuk.
export function pasangDrawer() {
  const shell = app.querySelector('.app-shell');
  const topbar = shell?.querySelector('.topbar');
  const sidebar = shell?.querySelector('.sidebar');
  if (!topbar || !sidebar || topbar.querySelector('#drawer-toggle')) return;
  sidebar.id = 'sidebar'; // target aria-controls tombol hamburger
  shell.insertAdjacentHTML('beforeend', '<div class="drawer-scrim" id="drawer-scrim"></div>');
  topbar.insertAdjacentHTML('afterbegin', `<button class="icon-btn drawer-toggle" id="drawer-toggle" aria-label="Buka menu" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button>`);
  const tombol = topbar.querySelector('#drawer-toggle');
  const scrim = shell.querySelector('#drawer-scrim');
  const terbuka = () => document.body.classList.contains('is-drawer');
  const tutup = () => { document.body.classList.remove('is-drawer'); tombol.setAttribute('aria-expanded', 'false'); tombol.focus(); };
  const buka = () => { document.body.classList.add('is-drawer'); tombol.setAttribute('aria-expanded', 'true'); sidebar.querySelector('.nav button')?.focus(); };
  tombol.onclick = () => (terbuka() ? tutup() : buka());
  scrim.onclick = tutup;
  // Klik apa pun di sidebar menutup drawer: menu mengganti markup, dan drawer yang tetap terbuka di
  // layar baru hanya menyisakan scrim gelap. Esc mengembalikan fokus ke tombol. Listener dipasang di
  // shell/sidebar (keduanya dibuat ulang tiap render), bukan di document, supaya tidak menumpuk.
  sidebar.addEventListener('click', (event) => { if (event.target.closest('button')) tutup(); });
  shell.addEventListener('keydown', (event) => { if (event.key === 'Escape' && terbuka()) tutup(); });
  // Panel melebar lagi (rotasi tablet / jendela diperbesar): tutup drawer diam-diam — tanpa ini,
  // scroll halaman tetap terkunci padahal hamburger sudah tidak terlihat.
  matchMedia('(min-width: 768px)').addEventListener('change', (event) => { if (event.matches) document.body.classList.remove('is-drawer'); });
}
