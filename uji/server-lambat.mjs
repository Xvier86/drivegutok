// Uji regresi tiga keluhan nyata di VPS (tanpa menyentuh data asli):
//   1. "Owner control loading lama"  -> GET /api/admin/overview dulu menunggu kuota provider
//      (token Google / login Mega) sampai PROVIDER_TIMEOUT_MS.
//   2. "Sampah tidak bisa dibuka"     -> GET /api/trash dulu menunggu pembersihan otomatis yang
//      menghapus file ke provider tanpa batas waktu, jadi request menggantung selamanya.
//   3. "audio/video tidak terbaca"    -> server mengabaikan header Range: pemutar hanya dapat
//      respons 200 penuh, Safari menolak memutar media tanpa 206, dan menggeser posisi putar gagal.
//   4. "berkas ada di Telegram tapi tidak ada di dashboard" -> setelah badan multipart selesai
//      dikirim, permintaan ke provider menunggu jawaban tanpa batas waktu; permintaan menggantung
//      (Cloudflare memutusnya di 100 detik) dan baris database tidak pernah dibuat.
// Jalankan dari mana pun: node uji/server-lambat.mjs
//
// Cara kerja: server.js disalin ke folder sementara (node_modules di-symlink), provider Google
// palsu diarahkan ke server TCP "blackhole" yang menerima koneksi tapi tidak pernah menjawab.
// Dengan begitu jalur jaringan provider pasti menggantung, dan kedua endpoint harus tetap
// menjawab cepat dari data yang sudah ada. Provider Telegram palsu di bawah melayani getFile dan
// mengirim berkas dengan dukungan Range, supaya penerusan 206 ikut diuji.
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-server-lambat-'));
const gagal = [];
const cek = (nama, syarat, detail = '') => {
  console.log(`${syarat ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ` -> ${detail}` : ''}`);
  if (!syarat) gagal.push(nama);
};

fs.copyFileSync(path.join(root, 'server.js'), path.join(kerja, 'server.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(kerja, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));

// Server blackhole: koneksi diterima, tidak pernah dibalas -> fetch provider menggantung.
const blackhole = net.createServer(() => {});
await new Promise((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
const portBlackhole = blackhole.address().port;
// Telegram palsu: melayani getFile + berkas dengan dukungan Range. Isi berkas ASCII supaya potongan
// byte bisa dibandingkan langsung. server.js membaca TELEGRAM_API_BASE, jadi tidak perlu tambalan.
const isiMedia = Buffer.from('ABCDEFGHIJKLMNOP');
const telegramPalsu = http.createServer((req, res) => {
  // getChat harus menjawab supaya jalur unggah benar-benar berjalan sampai kirimMultipart().
  if (req.url.includes('/getChat')) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result: { id: 123, type: 'channel', title: 'uji' } }));
  // sendDocument menerima seluruh badan request lalu diam selamanya: inilah keadaan "berkas sudah
  // sampai di Telegram, jawabannya tidak pernah datang" yang dulu menggantung tanpa batas.
  if (req.url.includes('/sendDocument')) { req.resume(); return; }
  if (req.url.includes('/getFile')) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result: { file_path: 'docs/uji.bin' } }));
  const rentang = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (!rentang) return res.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': String(isiMedia.length) }).end(isiMedia);
  const mulai = Number(rentang[1]);
  const akhir = rentang[2] ? Number(rentang[2]) : isiMedia.length - 1;
  const potongan = isiMedia.subarray(mulai, akhir + 1);
  return res.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${mulai}-${akhir}/${isiMedia.length}`, 'content-length': String(potongan.length) }).end(potongan);
});
await new Promise((resolve) => telegramPalsu.listen(0, '127.0.0.1', resolve));
const portTelegram = telegramPalsu.address().port;
const portApp = 3400 + Math.floor(Math.random() * 200);

// Kunci RSA asli supaya getGoogleAccessToken() benar-benar sampai ke permintaan jaringan
// (kunci palsu akan gagal lebih dulu di crypto.sign sehingga uji tidak menguji apa pun).
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccountJson = JSON.stringify({
  client_email: 'uji@contoh.invalid',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  token_uri: `http://127.0.0.1:${portBlackhole}/token`,
});

const anak = spawn('node', ['server.js'], {
  cwd: kerja,
  env: { ...process.env, PORT: String(portApp), NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'kunci-uji', TRASH_RETENTION_DAYS: '30', TELEGRAM_API_BASE: `http://127.0.0.1:${portTelegram}`, UPLOAD_IDLE_TIMEOUT_MS: '800' },
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
  blackhole.close();
  telegramPalsu.close();
  fs.rmSync(kerja, { recursive: true, force: true });
};
// Batas uji bisa diperpendek saat sengaja menjalankan kode lama (UJI_TIMEOUT_MS=12000).
const batasUji = Number(process.env.UJI_TIMEOUT_MS || 60000);
const paksa = setTimeout(() => {
  console.error(`!! Uji melebihi ${Math.round(batasUji / 1000)} detik (permintaan menggantung). Log server:`);
  console.error(logAnak.trim());
  bersihkan();
  process.exit(1);
}, batasUji);
const dasar = `http://127.0.0.1:${portApp}`;
const api = (jalur, opsi = {}) => fetch(`${dasar}${jalur}`, opsi);

// Tunggu server siap (maks 15 detik).
let siap = false;
for (let coba = 0; coba < 150 && !siap; coba += 1) {
  try { siap = (await api('/api/setup')).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
if (!siap) { console.error('!! server tidak siap. Log:'); console.error(logAnak.trim()); cek('server siap', false); }

let ownerId = null;
let cookie = '';
if (siap) {
  const buatOwner = await api('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@contoh.invalid', username: 'owner', password: 'rahasia123' }) });
  ownerId = (await buatOwner.json()).user?.id || null;
  const masuk = await api('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: 'owner', password: 'rahasia123' }) });
  cookie = (masuk.headers.get('set-cookie') || '').split(';')[0];
  cek('owner dibuat + login', buatOwner.status === 201 && Boolean(cookie), `setup=${buatOwner.status}`);
}

// Provider Google palsu lewat API (server yang mengenkripsi config), lalu diaktifkan langsung di
// SQLite supaya tidak memicu verifikasi koneksi saat PATCH.
const buatProvider = await api('/api/admin/providers', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ name: 'Google lambat', kind: 'gdrive', capacityBytes: 1024 * 1024, config: { folderId: 'folder-uji', serviceAccountJson } }),
});
const providerId = (await buatProvider.json()).id;
cek('provider uji dibuat', buatProvider.status === 201 && Boolean(providerId), `status=${buatProvider.status}`);

// Provider Telegram palsu: satu-satunya provider yang menyimpan berkas di luar (dan yang dipakai
// untuk menguji penerusan Range).
const buatTelegram = await api('/api/admin/providers', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ name: 'Telegram uji', kind: 'telegram', capacityBytes: 1024 * 1024, config: { botToken: 'uji', chatId: '123' } }),
});
const telegramId = (await buatTelegram.json()).id;
cek('provider telegram uji dibuat', buatTelegram.status === 201 && Boolean(telegramId), `status=${buatTelegram.status}`);

const db = new Database(path.join(kerja, 'data', 'mydrive.sqlite'));
db.prepare('UPDATE providers SET enabled = 1 WHERE id = ?').run(providerId);
db.prepare('UPDATE providers SET enabled = 1 WHERE id = ?').run(telegramId);
// File yang sudah lewat masa simpan (40 hari) dan providernya menggantung: inilah yang dulu
// membuat GET /api/trash tidak pernah selesai.
const lama = new Date(Date.now() - 40 * 86400000).toISOString();
db.prepare(`INSERT INTO files (id, owner_id, folder_id, name, mime_type, size, provider, remote_file_id, uploaded_by, uploaded_at, deleted_at, cdn_slug, cdn_enabled, encrypted, retention_type, retention_value, expires_at)
  VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 'forever', NULL, NULL)`)
  .run('file-lama', ownerId, 'lama.txt', 'text/plain', 123, providerId, 'gdrive:abc123', ownerId, lama, lama);
// Berkas di Telegram palsu: inilah yang diuji lewat header Range.
db.prepare(`INSERT INTO files (id, owner_id, folder_id, name, mime_type, size, provider, remote_file_id, uploaded_by, uploaded_at, deleted_at, cdn_slug, cdn_enabled, encrypted, retention_type, retention_value, expires_at)
  VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, 'forever', NULL, NULL)`)
  .run('file-media', ownerId, 'video-uji.mp4', 'video/mp4', isiMedia.length, telegramId, 'telegram:123:45:FILEID', ownerId, new Date().toISOString());
db.close();

const ukur = async (jalur) => {
  const mulai = Date.now();
  const respons = await api(jalur, { headers: { cookie } });
  return { status: respons.status, ms: Date.now() - mulai, data: await respons.json().catch(() => null) };
};

try {
  const sampah = await ukur('/api/trash');
  cek('GET /api/trash menjawab cepat walau provider menggantung', sampah.status === 200 && sampah.ms < 2000, `status=${sampah.status} ${sampah.ms}ms`);
  cek('GET /api/trash tetap berisi item sampah', sampah.data?.files?.length === 1 && sampah.data?.retentionDays === 30, `files=${sampah.data?.files?.length} retentionDays=${sampah.data?.retentionDays}`);

  const overview = await ukur('/api/admin/overview');
  const provider = overview.data?.providers?.find((item) => item.id === providerId);
  cek('GET /api/admin/overview menjawab cepat walau provider menggantung', overview.status === 200 && overview.ms < 2000, `status=${overview.status} ${overview.ms}ms`);
  cek('GET /api/admin/overview tetap memuat provider + user + log', Boolean(provider) && overview.data?.users?.length === 1 && Array.isArray(overview.data?.logs), `capacitySource=${provider?.capacitySource}`);

  // Penerusan Range: tanpa ini pemutar audio/video hanya dapat respons penuh (Safari menolaknya).
  const unduh = await api('/api/files/file-media/download', { headers: { cookie } });
  cek('download tanpa Range: 200 + isi penuh', unduh.status === 200 && (await unduh.text()) === isiMedia.toString('utf8'), `status=${unduh.status}`);
  const rentang = await api('/api/files/file-media/download', { headers: { cookie, range: 'bytes=4-7' } });
  const potongan = await rentang.text();
  cek('permintaan Range dijawab 206 + Content-Range', rentang.status === 206 && rentang.headers.get('content-range') === `bytes 4-7/${isiMedia.length}`, `status=${rentang.status} content-range=${rentang.headers.get('content-range')}`);
  cek('Accept-Ranges diteruskan dari provider', rentang.headers.get('accept-ranges') === 'bytes', `accept-ranges=${rentang.headers.get('accept-ranges')}`);
  cek('isi potongan sesuai rentang', potongan === 'EFGH', `isi=${potongan}`);

  // Keluhan VPS: "audio/video 6,6 MB terupload ke Telegram tapi tidak terbaca di dashboard" —
  // berkas ada di channel, log PM2 bersih, dan baris database tidak ada. Penyebabnya: setelah
  // badan multipart selesai dikirim, kirimMultipart() menunggu jawaban provider tanpa batas waktu,
  // jadi permintaan menggantung (Cloudflare memutusnya di 100 detik) dan baris database tidak
  // pernah dibuat. Provider Telegram di uji ini menerima badan request lalu diam; UPLOAD_IDLE_TIMEOUT_MS=800
  // supaya keadaannya bisa direproduksi dalam satu detik.
  const form = new FormData();
  form.set('providerId', String(telegramId));
  form.set('name', 'putus.din');
  form.set('mimeType', 'audio/mpeg');
  form.set('file', new Blob([Buffer.alloc(64 * 1024, 7)], { type: 'audio/mpeg' }), 'putus.mp3');
  const mulaiUnggah = Date.now();
  const unggah = await api('/api/files', { method: 'POST', headers: { cookie }, body: form });
  const jawabUnggah = await unggah.json().catch(() => null);
  const msUnggah = Date.now() - mulaiUnggah;
  cek('unggahan ke provider yang diam dijawab 502, tidak menggantung', unggah.status === 502 && msUnggah < 5000, `status=${unggah.status} ${msUnggah}ms`);
  cek('pesan galat menyebut provider tidak menjawab', /tidak menjawab/.test(jawabUnggah?.error || ''), jawabUnggah?.error || '');
  await new Promise((r) => setTimeout(r, 300));
  cek('kegagalan unggah tercatat di log server', /\[upload\] telegram gagal/.test(logAnak), 'mencari "[upload] telegram gagal"');
  const dbHitung = new Database(path.join(kerja, 'data', 'mydrive.sqlite'));
  const barisFile = dbHitung.prepare('SELECT COUNT(*) AS jumlah FROM files').get().jumlah;
  dbHitung.close();
  // Berkas yatim di channel Telegram memang tidak bisa dipulihkan (file_id hanya ada di jawaban
  // yang hilang), jadi yang dijaga di sini: kegagalan terlihat, tidak menggantung, dan tidak
  // meninggalkan berkas sementara di data/tmp.
  cek('baris database tidak dibuat untuk unggahan yang gagal', barisFile === 2, `baris=${barisFile}`);
  const sisaTmp = fs.readdirSync(path.join(kerja, 'data', 'tmp')).length;
  cek('berkas sementara data/tmp tetap dibersihkan', sisaTmp === 0, `sisa=${sisaTmp}`);
} catch (error) {
  cek('permintaan selesai tanpa error', false, error.message);
}

clearTimeout(paksa);
bersihkan();
if (gagal.length) {
  console.error(`\n${gagal.length} uji gagal: ${gagal.join(', ')}`);
  if (logAnak.trim()) console.error(logAnak.trim());
  process.exit(1);
}
console.log('\nSemua uji lulus.');
process.exit(0);
