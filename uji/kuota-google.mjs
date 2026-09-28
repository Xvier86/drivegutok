// node uji/kuota-google.mjs — kenapa "penyimpanan Google belum terbaca" tidak pernah tertangkap:
// SELURUH uji lama memakai Google palsu yang SELALU mengembalikan storageQuota (uji/google-oauth.mjs
// baris 61, uji/pilihan-upload.mjs baris 29), padahal service account nyata TIDAK punya kuota sendiri
// dan `about.get` tidak melaporkan kuota yang dipakai organisasi (kuota Shared Drive dipool per
// organisasi, bukan per akun — developers.google.com/workspace/drive/api/guides/manage-shareddrives).
// Akibatnya jalur yang paling sering dipakai di produksi (service account) tidak pernah diuji.
//
// Yang dijaga di sini:
//   1. Service account tanpa storageQuota → jangan laporkan 0/0 seolah penuh dan jangan bikin
//      kapasitas manual yang diisi Owner hilang; beri keterangan yang jujur (capacityNote), bukan galat.
//   2. Service account DENGAN storageQuota (Shared Drive yang melaporkan) → angka asli tetap dipakai.
//   3. Login akun Google (OAuth) di folder My Drive → kuota akun pribadi terbaca (regresi).
//   4. Provider service account tanpa kuota tetap BISA dipakai mengunggah.
// Jalankan dari mana pun: node uji/kuota-google.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-kuota-google-'));
const payload = Buffer.from('uji kuota google\n');

// Mode balasan Google palsu. `null` = service account sebenarnya: about.get TANPA storageQuota.
let mode = 'sa-tanpa-kuota';
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const reply = (body, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  for await (const _ of req) { /* buang badan permintaan */ }
  if (url.pathname === '/token' || url.pathname === '/oauth2/v3/token') return reply({ access_token: 'local-token' });
  if (url.pathname === '/drive/v3/about') {
    if (mode === 'sa-tanpa-kuota') return reply({ user: { emailAddress: 'sa@contoh.invalid' } }); // kenyataan SA
    return reply({ storageQuota: { usage: '1234', limit: '9999' } });
  }
  if (url.pathname.startsWith('/drive/v3/files/')) {
    const folder = url.pathname.split('/').at(-1);
    return reply({ id: folder, mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true }, ...(folder === 'shared' ? { driveId: 'shared-drive' } : {}) });
  }
  if (url.pathname === '/upload/drive/v3/files') return reply({ id: 'google-baru', size: String(payload.length) });
  return reply({ error: { message: `Unexpected local API: ${url.pathname}` } }, 404);
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const fakeBase = `http://127.0.0.1:${fake.address().port}`;
const reserve = http.createServer();
await new Promise(r => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port;
await new Promise(r => reserve.close(r));

fs.copyFileSync(path.join(root, 'server.js'), path.join(kerja, 'server.js'));
// Modul yang diimpor server.js ikut disalin: tanpa ini server tiruan gagal start
// (ERR_MODULE_NOT_FOUND) dan seluruh ujinya merah karena sebab yang salah.
fs.copyFileSync(path.join(root, 'halaman-publik.js'), path.join(kerja, 'halaman-publik.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(kerja, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));
const child = spawn(process.execPath, ['server.js'], {
  cwd: kerja,
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'local-test-only', GOOGLE_API_BASE: fakeBase, TELEGRAM_API_BASE: fakeBase, TELEGRAM_CHAT_ID: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', c => { logs += c; });
child.stderr.on('data', c => { logs += c; });
const base = `http://127.0.0.1:${port}`;
const api = (url, options = {}) => fetch(`${base}${url}`, { ...options, signal: AbortSignal.timeout(15000) });

let checks = 0; let failures = 0;
const cek = async (nama, fn) => {
  checks++;
  try { await fn(); console.log(`OK ${nama}`); }
  catch (e) { failures++; console.error(`FAIL ${nama}: ${e.message}`); }
};
const tunggu = async (fn, batas = 6000) => {
  const akhir = Date.now() + batas;
  for (;;) {
    const nilai = await fn();
    if (nilai) return nilai;
    if (Date.now() > akhir) return null;
    await new Promise(r => setTimeout(r, 50));
  }
};
try {
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try { ready = (await api('/api/setup')).ok; } catch { await new Promise(r => setTimeout(r, 50)); }
  }
  assert.ok(ready, logs);
  const db = new Database(path.join(kerja, 'data/mydrive.sqlite'));
  for (const role of ['owner', 'user']) {
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)').run(role, `${role}@example.invalid`, role, 'unused', role, 'active', new Date().toISOString());
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(role, role, new Date(Date.now() + 600000).toISOString());
  }
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const saConfig = (folderId) => ({
    folderId, authMode: 'service',
    serviceAccountJson: { client_email: 'sa@contoh.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${fakeBase}/token` },
  });
  const seed = (id, kind, config, used, capacity) => db.prepare('INSERT INTO providers (id,name,kind,enabled,used_bytes,capacity_bytes,config_json) VALUES (?,?,?,1,?,?,?)').run(id, id, kind, used, capacity, JSON.stringify(config));
  const cookies = { owner: 'mydrive_session=owner' };
  const overview = async () => {
    const r = await api('/api/admin/overview', { headers: { cookie: cookies.owner } });
    const teks = await r.text();
    assert.equal(r.status, 200, `overview status=${r.status} ${teks}`);
    return JSON.parse(teks);
  };
  const providerDari = async (id) => (await overview()).providers.find(p => p.id === id);
  const siapKuota = async (id) => tunggu(async () => { const p = await providerDari(id); return p && p.capacitySource && !['tersimpan', 'disabled'].includes(p.capacitySource) ? p : null; });
  const unggah = async (id) => {
    const form = new FormData();
    form.append('file', new Blob([payload], { type: 'image/png' }), 'uji.png');
    return api(`/api/files?providerId=${id}`, { method: 'POST', headers: { cookie: cookies.owner }, body: form });
  };

  // 1) Kenyataan service account: about.get tidak melaporkan kuota.
  mode = 'sa-tanpa-kuota';
  db.exec('DELETE FROM files; DELETE FROM providers');
  seed('sa-shared', 'gdrive', saConfig('shared'), 500, 1000);
  const sa = await siapKuota('sa-shared');
  await cek('service account tanpa storageQuota tidak dilaporkan sebagai 0/0 penuh', async () => {
    assert.ok(sa, 'kapasitas provider tidak pernah selesai dibaca');
    assert.notEqual(sa.capacitySource, 'google-drive', `sumber kuota masih dianggap terbaca: ${JSON.stringify(sa)}`);
    assert.equal(sa.capacityError, null, `kondisi normal dilaporkan sebagai galat: ${sa.capacityError}`);
  });
  await cek('kapasitas manual Owner tidak hilang saat Google tidak melaporkan kuota', async () => {
    assert.equal(sa.capacity_bytes, 1000, `kapasitas jadi ${sa.capacity_bytes}`);
    assert.equal(sa.used_bytes, 500, `pemakaian jadi ${sa.used_bytes}`);
  });
  await cek('alasan "kuota tak dilaporkan Google" terlihat oleh Owner', async () => {
    assert.match(String(sa.capacityNote || ''), /service account|tidak melaporkan|Shared Drive/i, `capacityNote=${JSON.stringify(sa.capacityNote)}`);
  });
  await cek('provider service account tanpa kuota tetap bisa mengunggah', async () => {
    const r = await unggah('sa-shared');
    assert.equal(r.status, 201, `status=${r.status} ${await r.text()}`);
  });

  // 2) Shared Drive yang MELAPORKAN kuota: angka asli tidak boleh ditimpa angka manual.
  mode = 'dengan-kuota';
  db.exec('DELETE FROM files; DELETE FROM providers');
  seed('sa-kuota', 'gdrive', saConfig('shared'), 0, 1000);
  const adaKuota = await siapKuota('sa-kuota');
  await cek('service account yang melaporkan kuota tetap memakai angka Google', async () => {
    assert.ok(adaKuota, 'kapasitas tidak terbaca');
    assert.equal(adaKuota.capacitySource, 'google-drive', `sumber=${adaKuota.capacitySource}`);
    assert.equal(adaKuota.used_bytes, 1234, `dipakai=${adaKuota.used_bytes}`);
    assert.equal(adaKuota.capacity_bytes, 9999, `kapasitas=${adaKuota.capacity_bytes}`);
    assert.ok(!adaKuota.capacityNote, `catatan muncul padahal kuota terbaca: ${adaKuota.capacityNote}`);
  });

  // 3) Regresi: login akun Google (OAuth) di folder My Drive → kuota akun pribadi terbaca.
  db.exec('DELETE FROM files; DELETE FROM providers');
  seed('oauth-mydrive', 'gdrive', { folderId: 'mydrive', authMode: 'oauth', clientId: 'cid', clientSecret: 'csec', refreshToken: 'RT' }, 0, 0);
  const oauth = await siapKuota('oauth-mydrive');
  await cek('kuota akun Google (OAuth, folder My Drive) terbaca', async () => {
    assert.ok(oauth, 'kapasitas OAuth tidak terbaca');
    assert.equal(oauth.capacitySource, 'google-drive', `sumber=${oauth.capacitySource}`);
    assert.equal(oauth.capacity_bytes, 9999, `kapasitas=${oauth.capacity_bytes}`);
    assert.equal(oauth.used_bytes, 1234, `dipakai=${oauth.used_bytes}`);
  });
  await cek('akun Google OAuth bisa mengunggah ke folder My Drive', async () => {
    const r = await unggah('oauth-mydrive');
    assert.equal(r.status, 201, `status=${r.status} ${await r.text()}`);
  });
} catch (error) {
  failures++;
  console.error('FATAL', error.stack || error.message);
  console.error(logs.slice(-1500));
} finally {
  child.kill('SIGKILL');
  fake.close();
  fs.rmSync(kerja, { recursive: true, force: true });
}
if (failures) { console.error(`${checks - failures}/${checks} lulus, ${failures} GAGAL`); process.exit(1); }
console.log(`${checks}/${checks} uji kuota Google lulus.`);
