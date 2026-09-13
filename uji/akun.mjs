// Uji pengaturan akun: PATCH /api/account/email dan PATCH /api/account/password.
//
// Kenapa diuji di server: form di assets/js/views/akun.js memang meminta password saat ini, tetapi itu
// hanya UI — siapa pun bisa mengirim PATCH langsung dengan cookie sesi yang bocor. Kalau server
// menerima perubahan tanpa password saat ini, satu cookie yang dicuri cukup untuk memindahkan akun ke
// email penyerang (lalu pakai "lupa password"). Jadi yang diuji di sini: email/password TIDAK berubah
// tanpa password saat ini, validasi panjang/konfirmasi, email ganda ditolak, password lama tidak bisa
// dipakai lagi, dan sesi lain diakhiri saat password diganti.
// Jalankan dari mana pun: node uji/akun.mjs
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-akun-'));
const gagal = [];
const cek = (nama, syarat, detail = '') => {
  console.log(`${syarat ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ` -> ${detail}` : ''}`);
  if (!syarat) gagal.push(nama);
};

fs.copyFileSync(path.join(root, 'server.js'), path.join(kerja, 'server.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(kerja, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));
const portApp = 4000 + Math.floor(Math.random() * 300);

const anak = spawn('node', ['server.js'], {
  cwd: kerja,
  env: { ...process.env, PORT: String(portApp), NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'kunci-uji' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logAnak = '';
anak.stdout.on('data', (data) => { logAnak += data; });
anak.stderr.on('data', (data) => { logAnak += data; });

let sudahKeluar = false;
const bersihkan = () => {
  if (sudahKeluar) return;
  sudahKeluar = true;
  anak.kill('SIGKILL');
  fs.rmSync(kerja, { recursive: true, force: true });
};
const paksa = setTimeout(() => {
  console.error('!! Uji melebihi 60 detik. Log server:');
  console.error(logAnak.trim());
  bersihkan();
  process.exit(1);
}, 60000);

const dasar = `http://127.0.0.1:${portApp}`;
const api = (jalur, opsi = {}) => fetch(`${dasar}${jalur}`, opsi);
const kirimJson = (jalur, body, cookie = '', metode = 'POST') => api(jalur, { method: metode, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const masuk = async (identity, password) => {
  const respons = await kirimJson('/api/login', { identity, password });
  return { status: respons.status, cookie: (respons.headers.get('set-cookie') || '').split(';')[0] };
};
const sha256 = (nilai) => crypto.createHash('sha256').update(nilai).digest('hex');

try {
  let siap = false;
  for (let coba = 0; coba < 150 && !siap; coba += 1) {
    try { siap = (await api('/api/setup')).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  cek('server siap', siap);
  if (!siap) throw new Error('server tidak siap');

  await kirimJson('/api/setup', { email: 'owner@contoh.invalid', username: 'owner', password: 'rahasia123' });
  const sesiOwner = await masuk('owner', 'rahasia123');
  const cookieOwner = sesiOwner.cookie;
  const buatMember = await kirimJson('/api/admin/users', { email: 'member@contoh.invalid', username: 'member', password: 'rahasia123' }, cookieOwner);
  cek('owner login dan member dibuat', Boolean(cookieOwner) && buatMember.status === 201, `member=${buatMember.status}`);

  const db = new Database(path.join(kerja, 'data', 'mydrive.sqlite'));
  const akun = () => db.prepare("SELECT email, password_hash FROM users WHERE username = 'owner'").get();
  const emailDiDb = () => akun().email;

  // Gerbang utama: tanpa sesi dan dengan password saat ini yang salah, tidak ada yang berubah.
  const tanpaSesi = await kirimJson('/api/account/email', { email: 'penyerang@contoh.invalid', currentPassword: 'rahasia123' }, '', 'PATCH');
  cek('tanpa sesi email ditolak 401', tanpaSesi.status === 401, `status=${tanpaSesi.status}`);
  const tanpaSesiSandi = await kirimJson('/api/account/password', { currentPassword: 'rahasia123', newPassword: 'rahasia456', confirmPassword: 'rahasia456' }, '', 'PATCH');
  cek('tanpa sesi ganti sandi ditolak 401', tanpaSesiSandi.status === 401, `status=${tanpaSesiSandi.status}`);

  const sandiSalah = await kirimJson('/api/account/email', { email: 'penyerang@contoh.invalid', currentPassword: 'salah-sekali' }, cookieOwner, 'PATCH');
  cek('password saat ini salah -> email ditolak 401', sandiSalah.status === 401, `status=${sandiSalah.status}`);
  cek('email tidak berubah setelah percobaan gagal', emailDiDb() === 'owner@contoh.invalid', `email=${emailDiDb()}`);
  const sandiGantiSalah = await kirimJson('/api/account/password', { currentPassword: 'salah-sekali', newPassword: 'rahasia456', confirmPassword: 'rahasia456' }, cookieOwner, 'PATCH');
  cek('password saat ini salah -> ganti sandi ditolak 401', sandiGantiSalah.status === 401, `status=${sandiGantiSalah.status}`);
  cek('hash password tidak berubah setelah percobaan gagal', akun().password_hash === sha256('rahasia123'));

  // Validasi isi.
  const emailBuruk = await kirimJson('/api/account/email', { email: 'bukan-email', currentPassword: 'rahasia123' }, cookieOwner, 'PATCH');
  cek('email tidak valid ditolak 400', emailBuruk.status === 400, `status=${emailBuruk.status}`);
  const emailGanda = await kirimJson('/api/account/email', { email: 'member@contoh.invalid', currentPassword: 'rahasia123' }, cookieOwner, 'PATCH');
  cek('email milik akun lain ditolak 409', emailGanda.status === 409, `status=${emailGanda.status}`);

  // Jalur sukses email: langsung aktif, tanpa verifikasi (server tidak punya pengiriman email).
  const emailBaru = await kirimJson('/api/account/email', { email: 'Owner@Baru.invalid', currentPassword: 'rahasia123' }, cookieOwner, 'PATCH');
  const dataEmail = await emailBaru.json().catch(() => null);
  cek('email baru diterima 200', emailBaru.status === 200, `status=${emailBaru.status} ${dataEmail?.error || ''}`);
  cek('server menyatakan tidak perlu verifikasi email', dataEmail?.verificationRequired === false);
  cek('email baru dinormalkan (huruf kecil) di database', emailDiDb() === 'owner@baru.invalid', `email=${emailDiDb()}`);
  const masukEmailBaru = await masuk('owner@baru.invalid', 'rahasia123');
  cek('login dengan email baru berhasil', masukEmailBaru.status === 200, `status=${masukEmailBaru.status}`);
  const masukEmailLama = await masuk('owner@contoh.invalid', 'rahasia123');
  cek('login dengan email lama ditolak', masukEmailLama.status === 401, `status=${masukEmailLama.status}`);

  // Password: panjang minimal dan konfirmasi diperiksa, dan tidak ada yang berubah saat validasi gagal.
  const pendek = await kirimJson('/api/account/password', { currentPassword: 'rahasia123', newPassword: 'pendek', confirmPassword: 'pendek' }, cookieOwner, 'PATCH');
  cek('password baru < 8 karakter ditolak 400', pendek.status === 400, `status=${pendek.status}`);
  const takSama = await kirimJson('/api/account/password', { currentPassword: 'rahasia123', newPassword: 'rahasia456', confirmPassword: 'rahasia457' }, cookieOwner, 'PATCH');
  cek('konfirmasi tidak sama ditolak 400', takSama.status === 400, `status=${takSama.status}`);
  cek('password lama masih berlaku setelah validasi gagal', (await masuk('owner@baru.invalid', 'rahasia123')).status === 200);

  // Sesi kedua (perangkat lain) harus mati saat password diganti; sesi yang dipakai mengganti tetap hidup.
  const sesiKedua = await masuk('owner@baru.invalid', 'rahasia123');
  const ganti = await kirimJson('/api/account/password', { currentPassword: 'rahasia123', newPassword: 'rahasia456', confirmPassword: 'rahasia456' }, cookieOwner, 'PATCH');
  const dataGanti = await ganti.json().catch(() => null);
  cek('ganti sandi berhasil 200', ganti.status === 200, `status=${ganti.status} ${dataGanti?.error || ''}`);
  cek('hash disimpan sebagai sha256 hex, bukan plaintext', akun().password_hash === sha256('rahasia456'), `hash=${akun().password_hash.slice(0, 16)}…`);
  const sesiLain = await api('/api/me', { headers: { cookie: sesiKedua.cookie } });
  cek('sesi lain diakhiri setelah ganti sandi', sesiLain.status === 401, `status=${sesiLain.status}`);
  const sesiSekarang = await api('/api/me', { headers: { cookie: cookieOwner } });
  cek('sesi yang dipakai mengganti sandi tetap hidup', sesiSekarang.status === 200, `status=${sesiSekarang.status}`);
  // Jumlah sesi lain dihitung, bukan ditebak: uji ini sudah membuat beberapa sesi di atas, jadi yang
  // diperiksa "semua sesi lain diakhiri" (>= 1) — perilaku tepatnya diperiksa oleh sesiKedua di atas.
  const sesiSebelum = db.prepare("SELECT COUNT(*) AS jumlah FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'owner')").get().jumlah;
  cek('tidak ada sesi lain tersisa sesudah ganti sandi', dataGanti?.otherSessionsEnded >= 1 && sesiSebelum === 1, `otherSessionsEnded=${dataGanti?.otherSessionsEnded} sisa=${sesiSebelum}`);
  cek('login dengan password lama ditolak', (await masuk('owner@baru.invalid', 'rahasia123')).status === 401);
  cek('login dengan password baru berhasil', (await masuk('owner@baru.invalid', 'rahasia456')).status === 200);

  // Jejak audit: perubahan identitas akun harus terlihat di Owner control (audit_logs).
  const aksi = db.prepare("SELECT action FROM audit_logs WHERE actor_id = (SELECT id FROM users WHERE username = 'owner')").all().map((baris) => baris.action);
  cek('audit mencatat update_email dan update_password', aksi.includes('update_email') && aksi.includes('update_password'), `aksi=${[...new Set(aksi)].join(',')}`);
  db.close();
} catch (error) {
  cek('uji selesai tanpa error', false, error.message);
  console.error(logAnak.trim());
}

clearTimeout(paksa);
bersihkan();
console.log(gagal.length ? `GAGAL: ${gagal.length} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal.length ? 1 : 0;
