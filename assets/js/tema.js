// Mode terang/gelap.
//
// Pilihan disimpan di localStorage dan diterapkan sebagai atribut `data-tema` di <html>. Atribut itu
// yang membalik token warna di tokens.css — jadi tidak ada satu pun aturan komponen yang perlu tahu
// soal tema. Tiga keadaan: 'gelap', 'terang', dan 'sistem' (mengikuti setelan perangkat).
//
// Nilai awal dipasang oleh skrip kecil di <head> SEBELUM CSS dimuat (lihat index.html). Tanpa itu,
// pengguna mode terang melihat kedipan gelap setiap kali halaman dimuat — dan itu justru yang paling
// terasa mengganggu. Fungsi di sini hanya menangani pergantian setelah halaman hidup.
import { icon } from './ikon.js';

const KUNCI = 'gutok-tema';
const URUTAN = ['sistem', 'terang', 'gelap'];
const LABEL = { sistem: 'Ikut sistem', terang: 'Terang', gelap: 'Gelap' };

const sistemGelap = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true);

export const pilihanTema = () => {
  try { const nilai = localStorage.getItem(KUNCI); return URUTAN.includes(nilai) ? nilai : 'sistem'; } catch { return 'sistem'; }
};
// Tema yang benar-benar tampil: 'gelap' atau 'terang'. Dipakai untuk ikon dan keterangan tombol.
export const temaEfektif = (pilihan = pilihanTema()) => (pilihan === 'sistem' ? (sistemGelap() ? 'gelap' : 'terang') : pilihan);

export function terapkanTema(pilihan) {
  const tema = temaEfektif(pilihan);
  document.documentElement.dataset.tema = tema;
  document.documentElement.style.colorScheme = tema;
  try { if (pilihan === 'sistem') localStorage.removeItem(KUNCI); else localStorage.setItem(KUNCI, pilihan); } catch {}
  // Bilah alamat peramban ikut berubah; nilainya harus sama dengan token --ink tema tersebut.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = tema === 'terang' ? '#f7f2e8' : '#14110e';
  const tombol = document.querySelector('#tema-toggle');
  if (tombol) {
    // Nama ikon dihitung lebih dulu, bukan ditulis di dalam icon(): uji gaya memeriksa string yang
    // muncul di argumen icon(), dan kata 'terang' di dalam ternary terbaca sebagai nama ikon.
    const namaIkon = tema === 'terang' ? 'moon' : 'sun';
    tombol.innerHTML = icon(namaIkon, 16);
    tombol.title = `Tema: ${LABEL[pilihan]}${pilihan === 'sistem' ? ` (${LABEL[tema].toLowerCase()})` : ''} — klik untuk ganti`;
    tombol.dataset.temaPilihan = pilihan;
    tombol.setAttribute('aria-label', tombol.title);
  }
}

// Tombol disisipkan dari sini, bukan dari lima markup layar (file, Sampah, Akun, Kendali, berkas
// user) — supaya tidak bisa lupa dipasang di salah satu layar, sama seperti pasangDrawer().
export function pasangTema() {
  const topbar = document.querySelector('#app .topbar');
  if (!topbar || topbar.querySelector('#tema-toggle')) return;
  const wadah = topbar.querySelector('.topbar-kanan') || topbar;
  wadah.insertAdjacentHTML('afterbegin', `<button class="icon-btn tema-toggle" id="tema-toggle" type="button" data-tema-pilihan="${pilihanTema()}"></button>`);
  const tombol = wadah.querySelector('#tema-toggle');
  // Urutan klik: sistem → terang → gelap → sistem. Tombol yang hanya menukar dua keadaan memaksa
  // pengguna memilih, padahal "ikut perangkat" adalah keadaan awal yang wajar dan sulit dikembalikan.
  tombol.onclick = () => {
    const berikut = URUTAN[(URUTAN.indexOf(pilihanTema()) + 1) % URUTAN.length];
    terapkanTema(berikut);
  };
  terapkanTema(pilihanTema());
  // Perangkat berganti tema (jadwal malam/matahari terbit) saat halaman terbuka: ikuti kalau
  // pengguna memilih 'sistem'.
  if (typeof matchMedia === 'function') {
    const media = matchMedia('(prefers-color-scheme: dark)');
    if (!media.__gutokTerpasang) {
      media.__gutokTerpasang = true;
      media.addEventListener('change', () => { if (pilihanTema() === 'sistem') terapkanTema('sistem'); });
    }
  }
}
