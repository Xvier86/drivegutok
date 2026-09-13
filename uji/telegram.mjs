// Uji provider Telegram sebagai storage: laporan pemakaian dan penghapusan berkas di channel.
//
// Dua keluhan nyata yang dijaga di sini:
//   1. "Telegram Channel merah, Kuota error" — Telegram tidak punya endpoint kuota, dan
//      readProviderCapacity() dulu menandai keadaan itu sebagai capacityError, jadi provider yang
//      sehat selalu tampil merah. Yang dibutuhkan hanya berapa byte yang sudah terkirim.
//   2. "berkas dihapus di situs tapi masih ada di Telegram" — hapus permanen memang sudah memanggil
//      deleteMessage, tetapi Telegram Bot API menolak menghapus pesan yang lebih tua dari 48 jam;
//      penolakan itu dulu dilempar sebagai error sehingga berkas terkunci di Sampah selamanya dan
//      channel tidak pernah dibersihkan. Sekarang penolakan itu dilaporkan sebagai peringatan dan
//      berkasnya tetap bisa dihapus dari situs.
// Jalankan dari mana pun: node uji/telegram.mjs
import Database from 'better-sqlite3';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-telegram-'));
const gagal = [];
const cek = (nama, syarat, detail = '') => {
  console.log(`${syarat ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ` -> ${detail}` : ''}`);
  if (!syarat) gagal.push(nama);
};

fs.copyFileSync(path.join(root, 'server.js'), path.join(kerja, 'server.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(kerja, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));

// Telegram palsu: getChat + sendDocument selalu sukses (message_id naik 1, 2, ...), deleteMessage
// sukses KECUALI untuk message_id 2 — itu balasan asli Telegram untuk pesan berumur lebih dari 48 jam.
const dihapus = [];
let pesanBerikutnya = 0;
const telegramPalsu = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://uji');
  const balas = (data) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  if (url.pathname.endsWith('/getChat')) return balas({ ok: true, result: { id: -100, type: 'channel', title: 'uji' } });
  if (url.pathname.endsWith('/sendDocument')) {
    req.resume();
    req.on('end', () => {
      pesanBerikutnya += 1;
      balas({ ok: true, result: { message_id: pesanBerikutnya, document: { file_id: `F${pesanBerikutnya}` } } });
    });
    return;
  }
  if (url.pathname.endsWith('/deleteMessage')) {
    const messageId = Number(url.searchParams.get('message_id'));
    dihapus.push(messageId);
    if (messageId === 2) return balas({ ok: false, error_code: 400, description: "Bad Request: message can't be deleted for everyone" });
    return balas({ ok: true, result: true });
  }
  req.resume();
  return res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
});
await new Promise((resolve) => telegramPalsu.listen(0, '127.0.0.1', resolve));
const portTelegram = telegramPalsu.address().port;
const portApp = 4200 + Math.floor(Math.random() * 200);

const anak = spawn('node', ['server.js'], {
  cwd: kerja,
  env: { ...process.env, PORT: String(portApp), NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'kunci-uji', TELEGRAM_API_BASE: `http://127.0.0.1:${portTelegram}` },
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
  telegramPalsu.close();
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
const kirimJson = async (jalur, body, cookie = '', metode = 'POST') => {
  const respons = await api(jalur, { method: metode, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { status: respons.status, data: await respons.json().catch(() => null), cookie: (respons.headers.get('set-cookie') || '').split(';')[0] };
};

try {
  let siap = false;
  for (let i = 0; i < 60; i += 1) {
    try { const respons = await api('/api/setup'); if (respons.ok) { siap = true; break; } } catch { /* belum listen */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  cek('server siap menerima permintaan', siap);

  await kirimJson('/api/setup', { email: 'owner@contoh.invalid', username: 'owner', password: 'rahasia-uji' });
  const masuk = await kirimJson('/api/login', { identity: 'owner', password: 'rahasia-uji' });
  const cookie = masuk.cookie;
  cek('login owner berhasil', masuk.status === 200, `status=${masuk.status}`);

  const buat = await kirimJson('/api/admin/providers', { name: 'TG uji', kind: 'telegram', capacityBytes: 0, config: { botToken: 'token-uji', chatId: '-100123' } }, cookie);
  const telegramId = buat.data?.id;
  cek('provider Telegram bisa dibuat tanpa kuota', buat.status === 201 && buat.data?.kind === 'telegram', `status=${buat.status} ${buat.data?.error || ''}`);
  const nyala = await kirimJson(`/api/admin/providers/${telegramId}`, { enabled: true }, cookie, 'PATCH');
  cek('provider Telegram bisa diaktifkan', nyala.status === 200, `status=${nyala.status} ${nyala.data?.error || ''}`);

  const unggah = async (nama) => {
    const form = new FormData();
    form.set('providerId', telegramId);
    form.set('name', nama);
    form.set('mimeType', 'application/octet-stream');
    form.set('file', new Blob([Buffer.alloc(4096, 3)]), nama);
    const respons = await api('/api/files', { method: 'POST', headers: { cookie }, body: form });
    return { status: respons.status, data: await respons.json().catch(() => null) };
  };
  const lama = await unggah('lama.bin');
  const lebihLama = await unggah('lebih-lama.bin');
  cek('dua berkas terkirim ke channel Telegram', lama.status === 201 && lebihLama.status === 201, `${lama.status}/${lebihLama.status} ${lama.data?.error || ''}`);

  // Pemakaian = byte yang benar-benar terkirim. capacitySource berubah jadi 'telegram' setelah
  // pembacaan latar belakang selesai; sebelum itu nilainya 'tersimpan' (dari kolom used_bytes).
  let provider = null;
  for (let i = 0; i < 40; i += 1) {
    const respons = await api('/api/admin/overview', { headers: { cookie } });
    provider = (await respons.json()).providers?.find((item) => item.id === telegramId);
    if (provider?.capacitySource === 'telegram') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  cek('Telegram melaporkan byte terkirim, bukan kuota', provider?.capacitySource === 'telegram' && provider?.used_bytes === 8192 && provider?.capacity_bytes === 0, `source=${provider?.capacitySource} used=${provider?.used_bytes} capacity=${provider?.capacity_bytes}`);
  cek('Telegram tidak lagi ditandai galat kuota', !provider?.capacityError, provider?.capacityError || 'tanpa galat');

  const dasbor = await (await api('/api/dashboard', { headers: { cookie } })).json();
  const diDasbor = dasbor.providers?.find((item) => item.id === telegramId);
  cek('dashboard memakai angka terkirim yang sama', Number(diDasbor?.used_bytes) === 8192, `used=${diDasbor?.used_bytes}`);

  // Berkas pertama: hapus permanen harus benar-benar menghapus pesannya di channel.
  const hapus = await api(`/api/files/${lama.data.id}/permanent`, { method: 'DELETE', headers: { cookie } });
  cek('hapus permanen berkas Telegram sukses', hapus.status === 204, `status=${hapus.status}`);
  cek('deleteMessage dipanggil untuk pesan itu', dihapus.includes(1), `dihapus=${dihapus.join(',')}`);

  // Berkas kedua: Telegram menolak karena pesannya lebih tua dari 48 jam. Situs harus tetap bisa
  // menghapusnya (bukan 502 / terkunci di Sampah) sambil memberi tahu channel perlu dibersihkan manual.
  const ditolak = await api(`/api/files/${lebihLama.data.id}/permanent`, { method: 'DELETE', headers: { cookie } });
  const jawabDitolak = await ditolak.json().catch(() => null);
  cek('penolakan 48 jam tidak mengunci berkas di Sampah', ditolak.status === 200 && /48 jam/.test(jawabDitolak?.warning || ''), `status=${ditolak.status} warning=${jawabDitolak?.warning || ''}`);

  const dbUji = new Database(path.join(kerja, 'data', 'mydrive.sqlite'), { readonly: true });
  cek('baris kedua berkas sudah hilang dari database', dbUji.prepare('SELECT COUNT(*) AS n FROM files').get().n === 0, `n=${dbUji.prepare('SELECT COUNT(*) AS n FROM files').get().n}`);
  cek('pemakaian provider kembali nol', Number(dbUji.prepare('SELECT used_bytes AS n FROM providers WHERE id = ?').get(telegramId)?.n) === 0, 'kolom used_bytes');
  dbUji.close();
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

