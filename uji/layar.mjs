// Uji asap layar: panggil setiap render* dengan data tiruan.
// Tujuannya menangkap kesalahan lingkup/impor pada kode yang sudah dipindah ke modul
// (misalnya formatBytes dipakai di trash.js tapi belum diimpor) tanpa perlu browser.
import process from 'node:process';
import { readFileSync } from 'node:fs';

// DOM tiruan serba bisa. #app menangkap innerHTML supaya isi tiap layar bisa diperiksa:
// kesalahan template (kelas hilang, ikon salah) tidak terlihat dari pemanggilan fungsi saja.
const el = new Proxy(function () {}, { get: () => el, set: () => true, apply: () => el, has: () => true, construct: () => el });
for (const nama of ['window', 'location', 'localStorage', 'sessionStorage', 'navigator', 'lucide', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt', 'history', 'screen', 'requestAnimationFrame', 'cancelAnimationFrame', 'FileReader', 'Image', 'XMLHttpRequest']) globalThis[nama] = el;
let layar = '';
const app = new Proxy({}, { get: (_t, kunci) => (kunci === 'innerHTML' ? layar : el), set: (_t, kunci, nilai) => { if (kunci === 'innerHTML') layar = nilai; return true; } });
globalThis.document = new Proxy(el, { get: (_t, kunci) => (kunci === 'querySelector' ? (pemilih) => (pemilih === '#app' ? app : el) : el) });
process.on('unhandledRejection', () => {});

const provider = { id: 'p1', name: 'Google Drive', kind: 'gdrive', enabled: 1, used_bytes: 1024, capacity_bytes: 2048, configured: true, missing: [] };
// Provider Telegram: tidak ada endpoint kuota di Bot API, jadi satu-satunya angka yang benar adalah
// byte yang terkirim — badge-nya harus berbeda dari "kuota tak dilaporkan" milik provider manual.
const providerTelegram = { id: 'p2', name: 'Telegram Channel', kind: 'telegram', enabled: 1, used_bytes: 4096, capacity_bytes: 0, capacitySource: 'telegram', capacityError: null, configured: true, missing: [] };
const file = { id: 'f1', name: 'laporan.pdf', mime_type: 'application/pdf', size: 2048, provider: 'p1', cdn_enabled: 0, cdn_slug: null, encrypted: 0, uploaded_at: '2026-09-13T00:00:00Z', deleted_at: '2026-09-13T00:00:00Z' };
// Satu berkas per jenis media: setiap cabang ikonMime() ikut dijalankan saat render, jadi nama ikon
// yang hilang atau impor yang tertinggal muncul sebagai kegagalan render, bukan kartu tanpa ikon.
// Satu di antaranya punya link CDN (cdn_enabled = 1) supaya baris tab "CDN" dan kelas .is-cdn
// benar-benar dirender di uji — pemisahan berkas CDN dan berkas biasa tidak lolos begitu saja.
const media = (id, name, mime_type, tambahan = {}) => ({ id, name, mime_type, size: 2048, provider: 'p1', cdn_enabled: 0, cdn_slug: null, encrypted: 0, uploaded_at: '2026-09-13T00:00:00Z', deleted_at: null, ...tambahan });
const mediaUji = [media('f2', 'foto.jpg', 'image/jpeg'), media('f3', 'lagu.mp3', 'audio/mpeg'), media('f4', 'klip.mp4', 'video/mp4'), media('f5', 'banner.png', 'image/png', { cdn_enabled: 1, cdn_slug: 'cdn-banner' })];
const folder = { id: 'd1', name: 'Dokumen', parent_id: null, depth: 0, deleted_at: '2026-09-13T00:00:00Z' };
const jawaban = {
  '/api/dashboard': { user: { id: 'u1', username: 'vier', role: 'owner' }, folderId: null, folders: [folder], files: [file, ...mediaUji], providers: [provider], stats: { bytes: 2048, files: 1 }, trashCount: 1, uptimeSeconds: 3600 },
  '/api/admin/overview': { providers: [provider, providerTelegram], files: { count: 5, bytes: 2048 }, users: [{ id: 'u1', username: 'vier', email: 'a@b.c', role: 'owner', status: 'active', created_at: '2026-09-13T00:00:00Z' }, { id: 'u2', username: 'tamu', email: 't@b.c', role: 'user', status: 'suspended', created_at: '2026-09-13T00:00:00Z' }],   // Tiga entri: dua di hari yang sama + satu di hari lain, supaya pengelompokan tanggal timeline
  // benar-benar diuji (dua entri pertama hanya beda satu menit, jadi zona waktu mana pun tetap
  // menaruhnya di hari yang sama).
  logs: [
    { action: 'upload', target_type: 'file', username: 'vier', created_at: '2026-09-13T09:15:00Z' },
    { action: 'invite', target_type: 'user', username: 'vier', created_at: '2026-09-13T09:14:00Z' },
    { action: 'update_email', target_type: 'user', username: 'vier', created_at: '2026-09-11T12:00:00Z' },
  ] },
  '/api/trash': { files: [file], folders: [folder], counts: { all: 2, files: 1, folders: 1 } },
};
globalThis.fetch = async (url) => ({ ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => jawaban[String(url).split('?')[0]] || {} });

const { rute } = await import('../assets/js/router.js');
const { state } = await import('../assets/js/state.js');
const files = await import('../assets/js/views/files.js');
const admin = await import('../assets/js/views/admin.js');
const trash = await import('../assets/js/views/trash.js');
const akun = await import('../assets/js/views/akun.js');
const login = await import('../assets/js/views/login.js');

state.user = { id: 'u1', username: 'vier', email: 'vier@contoh.invalid', role: 'owner' };
Object.assign(rute, { dashboard: files.renderDashboard, admin: admin.renderAdmin, trash: trash.renderTrash, akun: akun.renderAkun, login: login.renderLogin });

// Kelas penanda yang wajib ada di markup tiap layar. Dashboard memakai daftar baris ala Drive
// (tab pemisah File/CDN + widget penyimpanan ringkas di sidebar). Owner control memakai daftar
// baris berhairline (provider & member), badge satu fakta per elemen, dan timeline aktivitas.
// Widget penyimpanan sengaja TIDAK merinci per provider: daftar di bawah memeriksa meter
// tersegmentasi, bukan baris provider.
const WAJIB = {
  renderDashboard: ['storage-card', 'storage-head', 'storage-label', 'Penyimpanan', 'storage-isi', 'data-bytes', 'storage-dari', 'storage-total', 'storage-pct', 'storage-meter', 'segmen', '--i:', 'file-list', 'tabs', 'is-cdn', 'data-tab="file"', 'tab-file', 'tab-cdn', 'class="fab"', 'upload-trigger'],
  renderAdmin: ['provider-list', 'member-list', 'member-row', 'member-access', 'data-member', 'badge', 'ghost', 'timeline', 'tl-hari', 'tl-item', 'tl-titik', 'tl-jam', 'terkirim ke Telegram'],
  // Pengaturan akun: dua formulir, masing-masing dengan kolom password saat ini (tanpa itu halaman ini
  // hanya jadi teater — servernya sendiri yang menjaga, lihat uji/akun.mjs).
  renderAkun: ['form-akun-email', 'form-akun-sandi', 'akun-forms', 'akun-view', 'Pengaturan akun', 'name="currentPassword"', 'name="newPassword"', 'name="confirmPassword"', 'minlength="8"', 'vier@contoh.invalid'],
};
// Jejak markup lama yang harus hilang: nama/status provider per baris dan bilah individualnya.
const JEJAK_PROVIDER = ['storage-item', 'storage-row', 'storage-list', 'storage-bar', 'storage-seg', 'class="progress', 'provider-mini', 'provider-label'];

let gagal = 0;
const tangkapan = {};
// Bug lama: renderAdmin memasang `onclick = ke('dashboard')` tanpa dibungkus fungsi, jadi navigasi
// ke layar file ikut berjalan SAAT render — halaman Owner control langsung terlempar balik ke
// "Semua file". rute.dashboard diganti penghitung supaya pemanggilan diam-diam itu terlihat.
let pindahDasbor = 0;
const dasborAsli = rute.dashboard;
rute.dashboard = async () => { pindahDasbor += 1; };
for (const [nama, panggil] of [['renderDashboard', files.renderDashboard], ['bindDashboard', files.bindDashboard], ['renderTrash', trash.renderTrash], ['renderAdmin', admin.renderAdmin], ['renderAkun', akun.renderAkun], ['bindAkun', akun.bindAkun], ['renderLogin', login.renderLogin]]) {
  try { await panggil(); tangkapan[nama] = layar; console.log(`  ok  ${nama}`); } catch (error) { console.error(`  GAGAL  ${nama}: ${error.message}`); gagal += 1; }
}
rute.dashboard = dasborAsli;
if (pindahDasbor) { console.error(`  GAGAL  renderAdmin langsung kembali ke "Semua file" (${pindahDasbor}x)`); gagal += 1; }
else console.log('  ok  renderAdmin tidak langsung kembali ke "Semua file"');
for (const [nama, penanda] of Object.entries(WAJIB)) {
  const hilang = penanda.filter((kelas) => !tangkapan[nama]?.includes(kelas));
  if (hilang.length) { console.error(`  GAGAL  ${nama} kehilangan penanda: ${hilang.join(', ')}`); gagal += 1; }
  else console.log(`  ok  markup ${nama} lengkap`);
}
// Redesain Owner control: grid kartu provider/member diganti daftar baris berhairline, fakta jadi
// badge terpisah (tanpa kalimat meta digabung "·"), label ALL CAPS dihapus, dan aktivitas jadi
// timeline yang mengelompokkan tanggal. Semuanya diperiksa dari markup yang benar-benar dirender.
const adminMarkup = tangkapan.renderAdmin;
const jejakLama = ['provider-grid', 'member-grid', 'class="eyebrow"', 'Owner control', ' · '].filter((jejak) => adminMarkup.includes(jejak));
if (jejakLama.length) { console.error(`  GAGAL  Owner control masih memakai markup lama: ${jejakLama.join(' | ')}`); gagal += 1; }
else console.log('  ok  Owner control: tanpa grid kartu, tanpa label ALL CAPS, tanpa meta "·"');
const jumlahProvider = jawaban['/api/admin/overview'].providers.length;
const jumlahDot = (adminMarkup.match(/class="dot /g) || []).length;
const jumlahBarisMember = (adminMarkup.match(/class="member-row"/g) || []).length;
if (jumlahDot === jumlahProvider && jumlahBarisMember === jawaban['/api/admin/overview'].users.length) console.log('  ok  satu dot status per provider dan satu baris per member');
else { console.error(`  GAGAL  dot provider ${jumlahDot}/${jumlahProvider}, baris member ${jumlahBarisMember}`); gagal += 1; }
// Satu gaya tombol untuk semua aksi sekunder: dua tombol provider + satu tombol member (owner tidak).
// Dua tombol per provider (konfigurasi + aktif/nonaktif) dan satu tombol per member non-owner.
const jumlahMemberBiasa = jawaban['/api/admin/overview'].users.filter((user) => user.role !== 'owner').length;
const jumlahGhost = (adminMarkup.match(/class="ghost /g) || []).length;
if (jumlahGhost === jumlahProvider * 2 + jumlahMemberBiasa && !/class="secondary (provider|member)/.test(adminMarkup)) console.log(`  ok  aksi provider/member seragam satu gaya .ghost (${jumlahGhost})`);
else { console.error(`  GAGAL  aksi Owner control masih campur gaya tombol (ghost: ${jumlahGhost}, harus ${jumlahProvider * 2 + jumlahMemberBiasa})`); gagal += 1; }
// Telegram tidak melaporkan kuota: badge-nya menyebut byte yang terkirim, dan provider sehat tidak
// boleh punya badge galat (dulu selalu merah "Kuota error" justru karena kuotanya tidak ada).
const badgeGalat = (adminMarkup.match(/class="badge error"/g) || []).length;
if (adminMarkup.includes('4 KB terkirim ke Telegram') && !adminMarkup.includes('kuota tak dilaporkan') && badgeGalat === 0) console.log('  ok  provider Telegram memakai badge "terkirim", tanpa galat kuota');
else { console.error(`  GAGAL  badge provider Telegram salah (terkirim=${adminMarkup.includes('terkirim ke Telegram')} kuota-tak-dilaporkan=${adminMarkup.includes('kuota tak dilaporkan')} badge-error=${badgeGalat})`); gagal += 1; }
// Timeline: 3 entri / 2 hari → 2 header tanggal dan 3 baris jam, dan baris jam tidak mengulang tahun.
const kepalaHari = (adminMarkup.match(/class="tl-hari"/g) || []).length;
const barisJam = (adminMarkup.match(/class="tl-jam"/g) || []).length;
if (kepalaHari === 2 && barisJam === 3) console.log('  ok  aktivitas: 2 header tanggal untuk 3 entri (tanggal tidak diulang per baris)');
else { console.error(`  GAGAL  timeline ${kepalaHari} header hari / ${barisJam} baris jam (harus 2 / 3)`); gagal += 1; }
if (!/class="tl-jam">[^<]*\d{4}/.test(adminMarkup)) console.log('  ok  baris aktivitas cuma jam, tahun tidak diulang');
else { console.error('  GAGAL  baris aktivitas masih memuat tanggal lengkap'); gagal += 1; }
// Widget penyimpanan hanya boleh menampilkan meter: tidak ada jejak nama, status, atau bilah per
// provider. Kalau salah satu kelas lama kembali muncul, rincian per provider diam-diam hidup lagi.
const sisaProvider = JEJAK_PROVIDER.filter((jejak) => tangkapan.renderDashboard.includes(jejak));
if (sisaProvider.length) { console.error(`  GAGAL  dashboard masih merender rincian per provider: ${sisaProvider.join(', ')}`); gagal += 1; }
else console.log('  ok  dashboard tanpa rincian per provider');
// Jumlah segmen meter ikut diperiksa supaya meter tidak menyusut tanpa disadari (mis. 5 segmen
// seperti versi lama yang satu segmen per provider).
const jumlahSegmen = (tangkapan.renderDashboard.match(/class="segmen/g) || []).length;
if (jumlahSegmen === 28) console.log('  ok  meter penyimpanan 28 segmen');
else { console.error(`  GAGAL  meter penyimpanan ${jumlahSegmen} segmen (harus 28)`); gagal += 1; }
// Tombol Unggah pindah dari toolbar ke tombol mengapung: satu aksi utama yang selalu terjangkau,
// dan toolbar cukup menyisakan Folder baru + Upload CDN (yang disisipkan bindCdnUpload saat runtime).
const dasbor = tangkapan.renderDashboard;
if (/<button class="fab" id="upload-trigger"/.test(dasbor) && !/class="primary" id="upload-trigger"/.test(dasbor)) console.log('  ok  tombol Unggah jadi FAB, bukan tombol toolbar');
else { console.error('  GAGAL  tombol Unggah belum dipindah ke FAB'); gagal += 1; }
// FAB wajib DI LUAR .app-shell: .app-shell adalah query container, dan containment-nya membuat
// `position: fixed` di dalamnya ikut menggulir — tombolnya hilang dari sudut layar saat digulir.
if (/<\/main><\/div><button class="fab"/.test(dasbor)) console.log('  ok  FAB dirender di luar .app-shell');
else { console.error('  GAGAL  FAB berada di dalam .app-shell (fixed ikut menggulir)'); gagal += 1; }
// Label akar penyimpanan tidak boleh lagi memakai nama lama "MyDrive": breadcrumb, <h1>, dan tujuan
// pindah memakai "Penyimpanan". Breadcrumb diperiksa dari markup yang benar-benar dirender; <h1> dan
// opsi modal diperiksa dari sumber files.js karena keduanya bergantung state.folderId (h1) dan baru
// disisipkan saat modal pindah dibuka (opsi), jadi tidak ada di cuplikan renderDashboard.
const sumberFiles = readFileSync(new URL('../assets/js/views/files.js', import.meta.url), 'utf8');
const sumberTrash = readFileSync(new URL('../assets/js/views/trash.js', import.meta.url), 'utf8');
const LABEL_AKAR = [
  [dasbor.includes('<span class="crumb" data-folder="">Penyimpanan</span>'), 'breadcrumb akar'],
  [sumberFiles.includes(": 'Penyimpanan'}</h1>"), 'judul halaman akar'],
  [sumberFiles.includes('<option value="">Penyimpanan (root)</option>'), 'tujuan pindah (root)'],
];
const labelHilang = LABEL_AKAR.filter(([ada]) => !ada).map(([, nama]) => nama);
if (labelHilang.length) { console.error(`  GAGAL  label akar "Penyimpanan" hilang: ${labelHilang.join(', ')}`); gagal += 1; }
else console.log('  ok  label akar "Penyimpanan" di breadcrumb, judul, dan tujuan pindah');
if (/MyDrive/.test(dasbor) || /MyDrive/.test(sumberFiles) || /MyDrive/.test(sumberTrash)) { console.error('  GAGAL  teks "MyDrive" masih tampil ke user'); gagal += 1; }
else console.log('  ok  tidak ada teks "MyDrive" yang tampil ke user');
console.log(gagal ? `GAGAL: ${gagal} layar.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
