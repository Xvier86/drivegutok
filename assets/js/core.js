// Inti: referensi DOM, helper tampilan, pembungkus fetch, dan notifikasi.
// Ikon dibangun sebagai SVG inline oleh ikon.js — tidak ada skrip pihak ketiga di browser.
export { icon } from './ikon.js';
export const app = document.querySelector('#app');
export const toast = document.querySelector('#toast');
export const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
export const formatBytes = (bytes = 0) => bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export const formatCapacity = (provider) => provider.capacity_bytes > 0 ? `${formatBytes(provider.used_bytes)} terpakai dari ${formatBytes(provider.capacity_bytes)}` : `${formatBytes(provider.used_bytes)} terpakai · kapasitas tidak disediakan provider`;
export const notify = (message) => { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); };
export function showLoading(message = 'Memproses...') { if (document.querySelector('#loading-overlay')) return; document.body.insertAdjacentHTML('beforeend', `<div class="loading-overlay" id="loading-overlay"><div class="loading-card"><span class="loading-spinner"></span><strong>${esc(message)}</strong><span class="loading-dots">Mohon tunggu</span></div></div>`); }
export function hideLoading() { document.querySelector('#loading-overlay')?.remove(); }
export async function api(path, options = {}) { const headers = options.body instanceof FormData ? { ...(options.headers || {}) } : { 'content-type':'application/json', ...(options.headers || {}) }; const batasMs = options.body instanceof FormData ? 30 * 60 * 1000 : 15000; const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), batasMs); let response; try { response = await fetch(path, { headers, ...options, signal: controller.signal }); } catch (error) { if (error.name === 'AbortError') throw new Error('Server terlalu lama merespons. Periksa log PM2 dan konfigurasi Nginx.'); throw new Error('Server tidak dapat dihubungi. Pastikan npm start berjalan pada port yang benar.'); } finally { clearTimeout(timeout); } const contentType = response.headers.get('content-type') || ''; // Balasan non-JSON (mis. halaman 524 dari Cloudflare saat unggahan besar diputus) dulu disetor utuh ke toast:
  // ratusan karakter HTML yang tidak terbaca. Sekarang hanya status + 120 karakter pertama.
  const potongan = contentType.includes('application/json') ? null : (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const data = response.status === 204 ? null : potongan === null ? await response.json() : { error: `Server menjawab ${response.status}: ${potongan || 'tanpa keterangan'}` };
  if (!response.ok) throw new Error(data?.error || `Server error (${response.status}).`); return data; }
export function animateView() { app.classList.remove('view-enter'); void app.offsetWidth; app.classList.add('view-enter'); }
