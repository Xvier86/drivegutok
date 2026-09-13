// Uji jalur galat login Mega (end-to-end lewat server sungguhan, provider Mega palsu = kredensial salah).
//
// Kenapa perlu: megajs TIDAK mengirim event 'error' saat login gagal — kegagalannya hanya menolak
// promise `storage.ready`. Server dulu menunggu event 'ready'/'error', jadi kredensial salah berarti
// menggantung sampai batas waktu dan kartu provider menampilkan "Mega tidak merespons dalam 8 detik"
// (menyesatkan; akunnya yang salah, bukan jaringannya) sekaligus meninggalkan rejection tanpa catch
// di log. Uji ini menjaga: pesan galat asli Mega muncul di /api/admin/overview, bukan pesan timeout,
// dan tidak ada unhandledRejection di log server.
//
// Uji ini memanggil API Mega sungguhan (hanya untuk login yang gagal), jadi TIDAK ikut `npm run uji`.
// Jalankan manual: npm run uji:mega — dilewati dengan catatan kalau API Mega tidak bisa dihubungi.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gagal = [];
const cek = (nama, syarat, detail = '') => {
  console.log(`${syarat ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ` -> ${detail}` : ''}`);
  if (!syarat) gagal.push(nama);
};

// Prasyarat: API Mega bisa dihubungi. Kalau tidak (jaringan kantor/VPS memblokir Mega), uji dilewati.
try {
  await fetch('https://g.api.mega.co.nz/cs', { method: 'POST', body: '[{"a":"us0","user":"uji@contoh.invalid"}]', signal: AbortSignal.timeout(8000) });
} catch (error) {
  console.log(`LEWAT: API Mega tidak bisa dihubungi dari sini (${error.message}). Uji jalur galat Mega dilewati.`);
  process.exit(0);
}

const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-mega-galat-'));
fs.copyFileSync(path.join(root, 'server.js'), path.join(kerja, 'server.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(kerja, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));
const portApp = 4400 + Math.floor(Math.random() * 200);
const anak = spawn('node', ['server.js'], {
  cwd: kerja,
  env: { ...process.env, PORT: String(portApp), NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'kunci-uji' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logAnak = '';
anak.stdout.on('data', (data) => { logAnak += data; });
anak.stderr.on('data', (data) => { logAnak += data; });
const bersihkan = () => { anak.kill('SIGKILL'); fs.rmSync(kerja, { recursive: true, force: true }); };
const paksa = setTimeout(() => { console.error('!! Uji melebihi 90 detik.'); console.error(logAnak.trim()); bersihkan(); process.exit(1); }, 90000);

const dasar = `http://127.0.0.1:${portApp}`;
const api = (jalur, opsi = {}) => fetch(`${dasar}${jalur}`, opsi);
const kirimJson = async (jalur, body, cookie = '', metode = 'POST') => {
  const respons = await api(jalur, { method: metode, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { status: respons.status, data: await respons.json().catch(() => null), cookie: (respons.headers.get('set-cookie') || '').split(';')[0] };
};

try {
  let siap = false;
  for (let i = 0; i < 60; i += 1) {
    try { if ((await api('/api/setup')).ok) { siap = true; break; } } catch { /* belum listen */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  cek('server siap menerima permintaan', siap);
  await kirimJson('/api/setup', { email: 'owner@contoh.invalid', username: 'owner', password: 'rahasia-uji' });
  const masuk = await kirimJson('/api/login', { identity: 'owner', password: 'rahasia-uji' });
  const cookie = masuk.cookie;

  const buat = await kirimJson('/api/admin/providers', { name: 'Mega uji', kind: 'mega', capacityBytes: 0, config: { email: 'uji-tidak-ada@example.com', password: 'salah-sekali' } }, cookie);
  await kirimJson(`/api/admin/providers/${buat.data.id}`, { enabled: true }, cookie, 'PATCH');

  let provider = null;
  for (let i = 0; i < 200; i += 1) {
    const data = await (await api('/api/admin/overview', { headers: { cookie } })).json();
    provider = data.providers?.find((item) => item.id === buat.data.id);
    if (provider?.capacityError) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  cek('kegagalan login Mega muncul sebagai capacityError', Boolean(provider?.capacityError), provider?.capacityError || 'belum ada');
  cek('pesannya bukan pesan timeout yang menyesatkan', Boolean(provider?.capacityError) && !/tidak merespons/.test(provider.capacityError), provider?.capacityError || '');
  cek('log server tidak memuat unhandledRejection', !/unhandledRejection/.test(logAnak), 'cari "unhandledRejection"');
} catch (error) {
  cek('uji selesai tanpa error', false, error.message);
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
