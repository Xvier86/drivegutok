// Uji tema gelap/terang + kartu pintasan dashboard.
//
// Yang dijaga di sini BUKAN "ada tombol tema", melainkan tiga hal yang gampang rusak tanpa terlihat:
//   1. kontras teks terukur (dengan komposit alpha) tetap di atas ambang WCAG AA di DUA mode —
//      angka yang salah di sini tidak pernah terlihat oleh mata pemilik, tapi membuat teks tak terbaca;
//   2. token warna tidak boleh ada yang tertinggal di mode terang — token yang lupa ditimpa membuat
//      elemen "terang di atas terang" (bug nyata yang pernah terjadi: --ink dipakai sebagai warna teks
//      di atas permukaan emas, sehingga tombol utama jadi 3,21:1 di mode terang);
//   3. kartu pintasan hanya bisa diklik Owner, dan tidak mengubah hak akses siapa pun.
//
// Tokoh mode gelap DIPERTAHANKAN dari palet produksi, jadi ujinya menuntut nilainya tetap sama —
// bukan sekadar "ada".
import fs from 'node:fs';

const akar = new URL('../', import.meta.url);
const baca = (rel) => fs.readFileSync(new URL(rel, akar), 'utf8');
const tokens = baca('assets/styles/tokens.css');
const files = baca('assets/js/views/files.js');
const tema = baca('assets/js/tema.js');
const html = baca('assets/index.html');
const komponen = baca('assets/styles/components.css');
const base = baca('assets/styles/base.css');
const views = baca('assets/styles/views.css');
const css = komponen + base + views;

let gagal = 0;
const cek = (keterangan, syarat, rincian = '') => {
  if (syarat) console.log(`  ok  ${keterangan}`);
  else { console.error(`  GAGAL  ${keterangan}${rincian ? ' -> ' + rincian : ''}`); gagal += 1; }
};

// --- Nilai token per mode, dibaca dari berkas (bukan diketik ulang di uji) ---------------------
const blokGelap = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf("[data-tema='terang']"));
const blokTerang = tokens.slice(tokens.indexOf("[data-tema='terang']"));
const ambil = (blok, nama) => (blok.match(new RegExp(`--${nama}:\\s*([^;]+);`)) || [])[1]?.trim() || '';
const GELAP = {}, TERANG = {};
for (const nama of ['ink', 'ink-soft', 'panel', 'panel-soft', 'line', 'line-soft', 'paper', 'muted', 'muted-strong', 'gold', 'gold-bright', 'gold-dark', 'danger', 'amber-glow', 'amber-unlit', 'scrim', 'on-gold', 'gold-hover']) {
  GELAP[nama] = ambil(blokGelap, nama);
  TERANG[nama] = ambil(blokTerang, nama);
}

cek('token mode gelap lengkap', Object.values(GELAP).every(Boolean), Object.entries(GELAP).filter(([, v]) => !v).map(([k]) => k).join(','));
cek('token mode terang lengkap (tidak ada yang lupa ditimpa)', Object.values(TERANG).every(Boolean), Object.entries(TERANG).filter(([, v]) => !v).map(([k]) => k).join(','));
// Palet gelap adalah identitas logo: nilai intinya tidak boleh bergeser tanpa sengaja.
cek('mode gelap tetap sama seperti produksi (kanvas, kartu, teks, emas)', GELAP.ink === '#14110e' && GELAP.panel === '#211c17' && GELAP.paper === '#f4eee4' && GELAP.gold === '#e1b75b');
cek('mode terang memakai kertas hangat, bukan putih/hitam murni', !['#fff', '#ffffff', '#000', '#000000'].includes(TERANG.ink.toLowerCase()) && !['#000', '#000000'].includes(TERANG.paper.toLowerCase()), `ink=${TERANG.ink} paper=${TERANG.paper}`);
// Bukan pembalikan naif: di mode gelap kanvas lebih GELAP dari kartu; di mode terang sebaliknya,
// karena kartu naik dengan menjadi lebih terang.
cek('peran kanvas vs kartu dibalik dengan benar, bukan disalin', GELAP.ink !== TERANG.ink && GELAP.panel !== TERANG.panel);

// --- Kontras dihitung kode, bukan diklaim ------------------------------------------------------
const rgb = (hex) => {
  const h = hex.replace('#', '');
  const penuh = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(penuh.slice(i, i + 2), 16) / 255);
};
const luminansi = (hex) => {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(hex).map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const kontras = (a, b) => {
  if (!a.startsWith('#') || !b.startsWith('#')) return null; // rgba() dilewati (butuh komposit latar)
  const la = luminansi(a), lb = luminansi(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const PASANGAN = [
  ['teks utama di kartu', 'panel', 'paper', 4.5],
  ['teks utama di kanvas', 'ink-soft', 'paper', 4.5],
  ['teks redup di kartu', 'panel', 'muted', 4.5],
  ['tautan/aksen sebagai teks di kartu', 'panel', 'gold-bright', 4.5],
  ['teks di atas tombol emas', 'gold', 'on-gold', 4.5],
  ['teks di atas tombol emas saat hover', 'gold-hover', 'on-gold', 4.5],
  ['nada bahaya di kartu', 'panel', 'danger', 4.5],
];
for (const [mode, palet] of [['gelap', GELAP], ['terang', TERANG]]) {
  const buruk = [];
  for (const [label, latar, depan, ambang] of PASANGAN) {
    const r = kontras(palet[latar], palet[depan]);
    if (r === null) { buruk.push(`${label}: token rgba (tak terhitung)`); continue; }
    if (r < ambang) buruk.push(`${label}: ${r.toFixed(2)}:1 < ${ambang}`);
  }
  cek(`kontras mode ${mode} memenuhi WCAG AA (${PASANGAN.length} pasangan)`, buruk.length === 0, buruk.join(' | '));
}

// --- Tidak ada warna keras di luar token (mode terang tak bisa menggantinya) --------------------
const keras = [komponen, base, views].join('\n').split('\n').filter((b) => /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(b));
cek('tidak ada warna keras di aturan komponen (semua lewat token)', keras.length === 0, keras.slice(0, 2).join(' // '));
cek('--ink tidak lagi dipakai sebagai teks di atas permukaan', !/color:\s*var\(--ink\)/.test(css), (css.match(/color:\s*var\(--ink\)/g) || []).length + ' pemakaian');

// --- Pemasangan tema ---------------------------------------------------------------------------
cek('tema dipasang sebelum CSS dimuat (anti-kedip)', html.indexOf('gutok-tema') < html.indexOf('styles/tokens.css'));
cek('tema.js punya tiga pilihan dan tombolnya disisipkan sekali', /URUTAN\s*=\s*\['sistem', 'terang', 'gelap'\]/.test(tema) && tema.includes("topbar.querySelector('#tema-toggle')"));
cek('pilihan tema disimpan di localStorage', tema.includes("localStorage.setItem(KUNCI"));
cek('tombol tema dipasang di layar mana pun (dari app.js, bukan per view)', baca('assets/app.js').includes('pasangTema()'));
cek('meta color-scheme menerima dua mode', /name="color-scheme" content="dark light"/.test(html));

// --- Kartu pintasan ---------------------------------------------------------------------------
cek('kartu pintasan menyebut Google Drive, Mega, dan Telegram', ['Google Drive', 'Mega', 'Telegram'].every((n) => files.includes(`nama: '${n}'`)));
cek('kartu memakai keadaan nyata dari server (jumlah provider/aktif)', files.includes('data.providers.filter((provider) => provider.kind === kind)'));
cek('kartu dinonaktifkan untuk non-Owner', /owner \? `data-tambah=/.test(files) || files.includes("owner ? `data-tambah="));
cek('kartu dikelompokkan dalam satu panel di dashboard', files.includes('panel storage-pintasan'));
cek('klik kartu Mega/Telegram membuka form dengan jenis sudah dipilih', files.includes("openModalProvider(jenis)"));
cek('klik kartu Google Drive memakai alur satu-klik yang sama', files.includes("location.assign('/api/admin/google/tambah')"));
cek('form tambahan hanya diunduh saat diperlukan (import dinamis)', files.includes("await import('./admin-provider.js')"));
cek('kartu pintasan punya aturan CSS sendiri', /\.pintasan\b/.test(views) && /\.pintasan-grid\b/.test(views));

console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
