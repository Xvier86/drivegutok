// Uji regresi dua keluhan nyata di VPS (tanpa menyentuh data asli):
//   1. "Owner control loading lama"  -> GET /api/admin/overview dulu menunggu kuota provider
//      (token Google / login Mega) sampai PROVIDER_TIMEOUT_MS.
//   2. "Sampah tidak bisa dibuka"     -> GET /api/trash dulu menunggu pembersihan otomatis yang
//      menghapus file ke provider tanpa batas waktu, jadi request menggantung selamanya.
// Jalankan dari root project: node uji-server-lambat.mjs
//
// Cara kerja: server.js disalin ke folder sementara (node_modules di-symlink), provider Google
// palsu diarahkan ke server TCP "blackhole" yang menerima koneksi tapi tidak pernah menjawab.
// Dengan begitu jalur jaringan provider pasti menggantung, dan kedua endpoint harus tetap
// menjawab cepat dari data yang sudah ada.
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
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
  env: { ...process.env, PORT: String(portApp), NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'kunci-uji', TRASH_RETENTION_DAYS: '30' },
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

const db = new Database(path.join(kerja, 'data', 'mydrive.sqlite'));
db.prepare('UPDATE providers SET enabled = 1 WHERE id = ?').run(providerId);
// File yang sudah lewat masa simpan (40 hari) dan providernya menggantung: inilah yang dulu
// membuat GET /api/trash tidak pernah selesai.
const lama = new Date(Date.now() - 40 * 86400000).toISOString();
db.prepare(`INSERT INTO files (id, owner_id, folder_id, name, mime_type, size, provider, remote_file_id, uploaded_by, uploaded_at, deleted_at, cdn_slug, cdn_enabled, encrypted, retention_type, retention_value, expires_at)
  VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 'forever', NULL, NULL)`)
  .run('file-lama', ownerId, 'lama.txt', 'text/plain', 123, providerId, 'gdrive:abc123', ownerId, lama, lama);
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
