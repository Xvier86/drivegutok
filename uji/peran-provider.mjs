// Uji peran: pilihan provider manual (`providerId`) hanya berlaku untuk Owner.
//
// Kenapa perlu diuji di server, bukan cuma di tampilan: dropdown "Provider upload" memang hanya
// dirender untuk Owner (bindProviderPicker di assets/js/views/files.js), tapi menyembunyikan elemen
// tidak menghentikan siapa pun yang mengirim multipart langsung ke /api/files atau /api/files/cdn.
// Kalau server percaya begitu saja pada body permintaan, member bisa memaksa unggahannya masuk ke
// provider pilihannya (mis. mendorong pemakaian kuota satu akun storage, atau menghindari provider
// yang disiapkan owner). Jalankan dari mana pun: node uji/peran-provider.mjs
import Database from 'better-sqlite3';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-peran-provider-'));
const gagal = [];
const cek = (nama, syarat, detail = '') => {
  console.log(`${syarat ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ` -> ${detail}` : ''}`);
  if (!syarat) gagal.push(nama);
};

fs.copyFileSync(path.join(root, 'server.js'), path.join(kerja, 'server.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(kerja, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));

// Telegram palsu yang BENAR-BENAR menerima unggahan: supaya unggahan selesai dan kolom `provider`
// baris database bisa dibandingkan. (Provider palsu yang diam seperti di server-lambat.mjs hanya
// menghasilkan 502, jadi tidak bisa dipakai untuk memeriksa tujuan provider.)
const telegramPalsu = http.createServer((req, res) => {
  if (req.url.includes('/getChat')) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result: { id: 123, type: 'channel', title: 'uji' } }));
  if (req.url.includes('/sendDocument')) {
    req.resume();
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result: { message_id: 7, document: { file_id: 'FILEID-UJI' } } })));
    return;
  }
  req.resume();
  return res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
});
await new Promise((resolve) => telegramPalsu.listen(0, '127.0.0.1', resolve));
const portTelegram = telegramPalsu.address().port;
const portApp = 3800 + Math.floor(Math.random() * 200);

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
const kirimJson = (jalur, body, cookie = '') => api(jalur, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

try {
  let siap = false;
  for (let coba = 0; coba < 150 && !siap; coba += 1) {
    try { siap = (await api('/api/setup')).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  cek('server siap', siap);
  if (!siap) throw new Error('server tidak siap');

  await kirimJson('/api/setup', { email: 'owner@contoh.invalid', username: 'owner', password: 'rahasia123' });
  const masukOwner = await kirimJson('/api/login', { identity: 'owner', password: 'rahasia123' });
  const cookieOwner = (masukOwner.headers.get('set-cookie') || '').split(';')[0];
  const buatMember = await kirimJson('/api/admin/users', { email: 'member@contoh.invalid', username: 'member', password: 'rahasia123' }, cookieOwner);
  const member = await buatMember.json();
  const masukMember = await kirimJson('/api/login', { identity: 'member', password: 'rahasia123' });
  const cookieMember = (masukMember.headers.get('set-cookie') || '').split(';')[0];
  cek('owner + member aktif dan bisa login', Boolean(cookieOwner) && member.role === 'user' && Boolean(cookieMember), `role member=${member.role}`);

  // Dua provider Telegram: yang paling sedikit terpakai (0) adalah pilihan otomatis server.
  const buatProvider = (name) => kirimJson('/api/admin/providers', { name, kind: 'telegram', capacityBytes: 1024 * 1024, config: { botToken: 'uji', chatId: '123' } }, cookieOwner);
  const otomatis = await (await buatProvider('Telegram otomatis')).json();
  const pilihan = await (await buatProvider('Telegram pilihan')).json();
  const db = new Database(path.join(kerja, 'data', 'mydrive.sqlite'));
  db.prepare('UPDATE providers SET enabled = 1, used_bytes = 0 WHERE id = ?').run(otomatis.id);
  db.prepare('UPDATE providers SET enabled = 1, used_bytes = 500000 WHERE id = ?').run(pilihan.id);
  cek('dua provider remote aktif', Boolean(otomatis.id) && Boolean(pilihan.id), `${otomatis.id} / ${pilihan.id}`);

  const unggah = async (cookie, nama, providerId, tipe = 'application/octet-stream', jalur = '/api/files') => {
    const form = new FormData();
    if (providerId !== null) form.set('providerId', providerId);
    form.set('name', nama);
    form.set('mimeType', tipe);
    form.set('file', new Blob([Buffer.alloc(16, 5)], { type: tipe }), nama);
    const respons = await api(jalur, { method: 'POST', headers: { cookie }, body: form });
    return { status: respons.status, data: await respons.json().catch(() => null) };
  };
  const providerDiDb = (nama) => db.prepare('SELECT provider FROM files WHERE name = ?').get(nama)?.provider || null;

  // Inti uji: member mengirim providerId pilihan lewat request langsung.
  const memberPilih = await unggah(cookieMember, 'member-pilih.bin', pilihan.id);
  cek('unggahan member dengan providerId tetap diterima (fallback otomatis)', memberPilih.status === 201, `status=${memberPilih.status} ${memberPilih.data?.error || ''}`);
  cek('member tidak bisa memaksa provider pilihannya', providerDiDb('member-pilih.bin') === otomatis.id, `dipakai=${providerDiDb('member-pilih.bin')}`);
  cek('jawaban server juga melaporkan provider otomatis', memberPilih.data?.provider === otomatis.id, `provider=${memberPilih.data?.provider}`);

  // providerId karangan pun tidak boleh menjatuhkan permintaan member: diabaikan, bukan 409.
  const memberKarangan = await unggah(cookieMember, 'member-karangan.bin', 'provider-tidak-ada');
  cek('providerId tidak dikenal dari member diabaikan, unggahan tetap jalan', memberKarangan.status === 201 && providerDiDb('member-karangan.bin') === otomatis.id, `status=${memberKarangan.status} provider=${providerDiDb('member-karangan.bin')}`);

  // Jalur CDN memakai gerbang yang sama; satu endpoint yang terlewat sudah cukup untuk bocor.
  const memberCdn = await unggah(cookieMember, 'member-cdn.png', pilihan.id, 'image/png', '/api/files/cdn');
  cek('unggahan CDN member juga memakai provider otomatis', memberCdn.status === 201 && providerDiDb('member-cdn.png') === otomatis.id, `status=${memberCdn.status} provider=${providerDiDb('member-cdn.png')}`);

  // Tanpa providerId (member maupun owner) tetap otomatis — perilaku lama tidak berubah.
  const memberBiasa = await unggah(cookieMember, 'member-biasa.bin', null);
  cek('member tanpa providerId memakai provider otomatis', memberBiasa.status === 201 && providerDiDb('member-biasa.bin') === otomatis.id, `provider=${providerDiDb('member-biasa.bin')}`);

  // Kontrol: untuk owner, pilihan manual harus benar-benar dihormati. Tanpa pemeriksaan ini, sebuah
  // "perbaikan" yang selalu mengabaikan providerId akan lolos dan mematikan fitur pemilihan.
  const ownerPilih = await unggah(cookieOwner, 'owner-pilih.bin', pilihan.id);
  cek('owner tetap bisa memilih provider manual', ownerPilih.status === 201 && providerDiDb('owner-pilih.bin') === pilihan.id, `status=${ownerPilih.status} provider=${providerDiDb('owner-pilih.bin')}`);
  const ownerPilihCdn = await unggah(cookieOwner, 'owner-cdn.png', pilihan.id, 'image/png', '/api/files/cdn');
  cek('owner tetap bisa memilih provider manual di jalur CDN', ownerPilihCdn.status === 201 && providerDiDb('owner-cdn.png') === pilihan.id, `status=${ownerPilihCdn.status} provider=${providerDiDb('owner-cdn.png')}`);
  db.close();
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
