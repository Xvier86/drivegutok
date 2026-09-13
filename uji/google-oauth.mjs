// Uji provider Google Drive dengan login akun Google (OAuth), plus daftar provider yang benar-benar
// kosong sebelum Owner menambahkan sendiri.
//
// Tiga hal yang dijaga di sini:
//   1. Provider TIDAK lagi disemai otomatis. Database baru harus melaporkan `providers: []`, dan
//      unggahan harus ditolak dengan pesan yang jelas — bukan diam-diam menulis ke provider bawaan.
//   2. Login akun Google: provider OAuth hanya butuh client ID + client secret + refresh token, dan
//      TIDAK boleh dianggap "belum siap" karena service account JSON tidak diisi.
//   3. Access token harus dibuat dari refresh token pada setiap permintaan API (access token sekali
//      pakai hasil penukaran kode tidak boleh dipakai ulang), dan refresh token yang tersimpan tidak
//      boleh hilang ketika Owner menyimpan ulang konfigurasi tanpa mengetik ulang rahasianya.
// Jalankan dari mana pun: node uji/google-oauth.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-google-'));
const gagal = [];
const cek = (nama, syarat, detail = '') => {
  console.log(`${syarat ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ` -> ${detail}` : ''}`);
  if (!syarat) gagal.push(nama);
};

fs.copyFileSync(path.join(root, 'server.js'), path.join(kerja, 'server.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(kerja, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));

// Google palsu. Sekaligus melayani halaman persetujuan (GOOGLE_AUTH_BASE) dan API-nya
// (GOOGLE_API_BASE): refresh token uji 'RT-UJI' ditukar jadi 'AT-REFRESH' pada setiap permintaan,
// sedangkan penukaran kode otorisasi mengembalikan 'AT-CODE' yang sekali pakai.
const jejakDrive = [];
const tokenDiminta = [];
const googlePalsu = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://uji');
  const balasJson = (status, data) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  if (url.pathname === '/oauth2/v3/token') {
    let badan = '';
    req.on('data', (potongan) => { badan += potongan; });
    return req.on('end', () => {
      const parameter = new URLSearchParams(badan);
      tokenDiminta.push(`${parameter.get('grant_type')}:${parameter.get('client_id')}:${parameter.get('redirect_uri') || ''}`);
      if (parameter.get('client_id') !== 'CID-uji' || parameter.get('client_secret') !== 'CSECRET-uji') return balasJson(401, { error: 'invalid_client' });
      if (parameter.get('grant_type') === 'authorization_code') {
        if (parameter.get('code') !== 'CODE-uji') return balasJson(400, { error: 'invalid_grant' });
        return balasJson(200, { access_token: 'AT-CODE', refresh_token: 'RT-UJI', expires_in: 3600, token_type: 'Bearer' });
      }
      if (parameter.get('grant_type') === 'refresh_token') {
        if (parameter.get('refresh_token') !== 'RT-UJI') return balasJson(400, { error: 'invalid_grant' });
        return balasJson(200, { access_token: 'AT-REFRESH', expires_in: 3600, token_type: 'Bearer' });
      }
      return balasJson(400, { error: 'unsupported_grant_type' });
    });
  }
  if (url.pathname === '/o/oauth2/v2/auth') return balasJson(200, { halaman: 'persetujuan' });
  jejakDrive.push(`${req.method} ${url.pathname} ${req.headers.authorization || 'tanpa-token'}`);
  if (url.pathname === '/drive/v3/about') return balasJson(200, { storageQuota: { usage: 1234, limit: 9999 } });
  if (url.pathname === '/drive/v3/files/FOLDER-UJI') return balasJson(200, { id: 'FOLDER-UJI', name: 'uji', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } });
  if (url.pathname === '/upload/drive/v3/files') {
    let panjang = 0;
    req.on('data', (potongan) => { panjang += potongan.length; });
    return req.on('end', () => balasJson(200, { id: 'FILE-UJI', size: panjang }));
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/drive/v3/files/')) return res.writeHead(204).end();
  return balasJson(404, { error: { message: `jalur uji tidak dikenal: ${req.method} ${url.pathname}` } });
});
await new Promise((resolve) => googlePalsu.listen(0, '127.0.0.1', resolve));
const alamatGoogle = `http://127.0.0.1:${googlePalsu.address().port}`;
const portApp = 4400 + Math.floor(Math.random() * 200);

// Database lama: persis keadaan versi sebelum perubahan ini — tiga baris provider bawaan sudah ada,
// dan salah satunya (gdrive) sudah pernah diisi konfigurasi oleh Owner. Saat start, baris bawaan
// yang BELUM PERNAH DISENTUH harus dibuang, sedangkan yang sudah diisi atau sudah punya berkas harus
// bertahan — pembersihan tidak boleh menghapus provider yang benar-benar dipakai.
fs.mkdirSync(path.join(kerja, 'data'), { recursive: true });
const Database = (await import('better-sqlite3')).default;
const kunciConfig = crypto.createHash('sha256').update('kunci-uji').digest();
const enkripsiConfig = (config) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kunciConfig, iv);
  const isi = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return `enc:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${isi.toString('base64url')}`;
};
const dbLama = new Database(path.join(kerja, 'data', 'mydrive.sqlite'));
dbLama.exec("CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, used_bytes INTEGER NOT NULL DEFAULT 0, capacity_bytes INTEGER NOT NULL DEFAULT 0, config_json TEXT NOT NULL DEFAULT '{}')");
const barisLama = dbLama.prepare('INSERT INTO providers VALUES (?, ?, ?, ?, ?, ?, ?)');
barisLama.run('telegram', 'Telegram Channel', 'telegram', 0, 0, 214748364800, '{}');
barisLama.run('mega', 'Mega Drive', 'mega', 0, 0, 2147483648000, '{}');
barisLama.run('gdrive', 'Google Drive', 'gdrive', 0, 0, 1610612736000, enkripsiConfig({ folderId: 'FOLDER-UJI', serviceAccountJson: JSON.stringify({ client_email: 'uji@contoh.invalid', private_key: 'KUNCI', token_uri: `${alamatGoogle}/oauth2/v3/token` }) }));
barisLama.run('provider-lama', 'Drive lama', 'gdrive', 0, 4096, 0, '{}');
dbLama.close();

const anak = spawn('node', ['server.js'], {
  cwd: kerja,
  env: { ...process.env, PORT: String(portApp), NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'kunci-uji', GOOGLE_API_BASE: alamatGoogle, GOOGLE_AUTH_BASE: alamatGoogle },
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
  googlePalsu.close();
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
  // GET/HEAD tidak boleh membawa badan permintaan (undici menolak), jadi badan hanya dikirim saat
  // metodenya mengizinkan.
  const respons = await api(jalur, { method: metode, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(metode === 'GET' || metode === 'HEAD' ? {} : { body: JSON.stringify(body) }) });
  return { status: respons.status, data: await respons.json().catch(() => null), cookie: (respons.headers.get('set-cookie') || '').split(';')[0] };
};
const unggah = async (nama, isi, cookie) => {
  const form = new FormData();
  form.append('file', new Blob([isi], { type: 'text/plain' }), nama);
  const respons = await api('/api/files', { method: 'POST', headers: { cookie }, body: form });
  return { status: respons.status, data: await respons.json().catch(() => null) };
};
const providerDari = async (cookie, id) => (await kirimJson('/api/admin/overview', {}, cookie, 'GET')).data.providers.find((item) => item.id === id);
const tunggu = async (syarat, putaran = 40) => { for (let i = 0; i < putaran; i += 1) { const hasil = await syarat(); if (hasil) return hasil; await new Promise((resolve) => setTimeout(resolve, 250)); } return null; };

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

  // 1) Pembersihan provider bawaan: yang belum pernah disentuh hilang, yang sudah diisi konfigurasi
  // atau menyimpan berkas tetap ada. Unggahan tanpa provider aktif ditolak dengan pesan yang bisa
  // ditindaklanjuti (bukan 500, bukan diam-diam menulis ke provider bawaan).
  const awal = await kirimJson('/api/admin/overview', {}, cookie, 'GET');
  const idAwal = (awal.data?.providers || []).map((provider) => provider.id).sort();
  cek('provider bawaan yang belum disentuh dibuang, yang sudah diisi bertahan', JSON.stringify(idAwal) === JSON.stringify(['gdrive', 'provider-lama']), `providers=${JSON.stringify(idAwal)}`);
  const tanpaProvider = await unggah('kosong.txt', 'halo', cookie);
  cek('unggahan tanpa provider ditolak dengan pesan jelas', tanpaProvider.status === 409 && /Belum ada provider remote yang aktif/.test(tanpaProvider.data?.error || ''), `status=${tanpaProvider.status} ${tanpaProvider.data?.error || ''}`);

  // 2) Provider OAuth: cukup client ID + client secret; service account tidak boleh dituntut.
  const buat = await kirimJson('/api/admin/providers', { name: 'Drive uji', kind: 'gdrive', capacityBytes: 0, config: { authMode: 'oauth', clientId: 'CID-uji', clientSecret: 'CSECRET-uji', folderId: 'https://drive.google.com/drive/folders/FOLDER-UJI?usp=sharing' } }, cookie);
  const providerId = buat.data?.id;
  cek('provider Google Drive mode login akun bisa dibuat', buat.status === 201 && buat.data?.authMode === 'oauth', `status=${buat.status} authMode=${buat.data?.authMode} ${buat.data?.error || ''}`);
  cek('URL folder dinormalisasi jadi ID, service account tidak dituntut', buat.data?.missing?.includes('refreshToken') === true && !buat.data.missing.includes('serviceAccountJson'), `missing=${JSON.stringify(buat.data?.missing)}`);
  const nyalakanDini = await kirimJson(`/api/admin/providers/${providerId}`, { enabled: true }, cookie, 'PATCH');
  cek('provider belum bisa diaktifkan sebelum login Google', nyalakanDini.status === 409 && /refreshToken/.test(nyalakanDini.data?.error || ''), `status=${nyalakanDini.status} ${nyalakanDini.data?.error || ''}`);

  // 3) Rute login: dialihkan ke halaman persetujuan Google dengan redirect URI aplikasi ini.
  const login = await api(`/api/admin/providers/${providerId}/google/login`, { redirect: 'manual', headers: { cookie } });
  const urlIzin = new URL(login.headers.get('location') || 'http://kosong.invalid');
  const state = urlIzin.searchParams.get('state') || '';
  const redirectUri = `${dasar}/api/admin/providers/${providerId}/google/callback`;
  cek('login Google mengalihkan ke halaman persetujuan', login.status === 302 && urlIzin.origin === alamatGoogle && urlIzin.pathname === '/o/oauth2/v2/auth', `status=${login.status} ${urlIzin.href}`);
  cek('permintaan izin lengkap (client_id, drive, offline, consent, state)', urlIzin.searchParams.get('client_id') === 'CID-uji' && urlIzin.searchParams.get('scope') === 'https://www.googleapis.com/auth/drive' && urlIzin.searchParams.get('access_type') === 'offline' && urlIzin.searchParams.get('prompt') === 'consent' && state.length >= 16, urlIzin.search);
  cek('redirect URI menunjuk callback aplikasi', urlIzin.searchParams.get('redirect_uri') === redirectUri, urlIzin.searchParams.get('redirect_uri') || '(kosong)');

  const stateSalah = await api(`/api/admin/providers/${providerId}/google/callback?code=CODE-uji&state=state-palsu`, { redirect: 'manual' });
  cek('callback dengan state palsu ditolak', stateSalah.status === 400, `status=${stateSalah.status}`);

  const callback = await api(`/api/admin/providers/${providerId}/google/callback?code=CODE-uji&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  cek('callback menyimpan refresh token lalu kembali ke dashboard', callback.status === 302 && callback.headers.get('location') === '/?google=ok', `status=${callback.status} location=${callback.headers.get('location')}`);
  cek('penukaran kode memakai redirect URI yang sama', tokenDiminta.some((baris) => baris.startsWith(`authorization_code:CID-uji:${redirectUri}`)), tokenDiminta.join(' | '));
  const sesudahLogin = await providerDari(cookie, providerId);
  cek('provider siap setelah login Google', sesudahLogin?.configured === true && sesudahLogin.missing.length === 0, `missing=${JSON.stringify(sesudahLogin?.missing)}`);

  const nyalakan = await kirimJson(`/api/admin/providers/${providerId}`, { enabled: true }, cookie, 'PATCH');
  cek('provider Google Drive OAuth bisa diaktifkan', nyalakan.status === 200, `status=${nyalakan.status} ${nyalakan.data?.error || ''}`);



  // 4) Unggah nyata: access token HARUS dibuat dari refresh token, bukan access token sekali pakai
  // hasil penukaran kode.
  const berkas = await unggah('catatan.txt', 'isi berkas uji', cookie);
  cek('unggah ke Google Drive mode OAuth berhasil', berkas.status === 201 && String(berkas.data?.remote_file_id || '').startsWith('gdrive:FILE-UJI'), `status=${berkas.status} ${berkas.data?.error || ''}`);
  const jejakUnggah = jejakDrive.find((baris) => baris.includes('/upload/drive/v3/files')) || '';
  cek('unggahan memakai access token dari refresh token', jejakUnggah.includes('Bearer AT-REFRESH'), jejakUnggah || '(tidak ada permintaan unggah)');
  cek('access token sekali pakai tidak dipakai ulang', !jejakDrive.some((baris) => baris.includes('Bearer AT-CODE')), jejakDrive.join(' | '));

  // 5) Kuota dibaca dari API Google memakai jabat tangan refresh token yang sama.
  const kuota = await tunggu(async () => { const provider = await providerDari(cookie, providerId); return provider?.capacitySource === 'google-drive' ? provider : null; });
  cek('kuota Google Drive terbaca lewat refresh token', kuota?.capacity_bytes === 9999 && kuota?.used_bytes === 1234, `sumber=${kuota?.capacitySource} dipakai=${kuota?.used_bytes} kapasitas=${kuota?.capacity_bytes}`);

  // 6) Menyimpan konfigurasi tanpa mengetik ulang rahasia (persis yang dikirim modal, karena kolom
  // kosong tidak diisi lagi) TIDAK boleh menghapus refresh token.
  const simpanUlang = await kirimJson(`/api/admin/providers/${providerId}`, { config: { authMode: 'oauth', clientId: 'CID-uji', folderId: 'https://drive.google.com/drive/folders/FOLDER-UJI' } }, cookie, 'PATCH');
  const sesudahSimpan = await providerDari(cookie, providerId);
  cek('simpan ulang tanpa rahasia tidak menghapus refresh token', simpanUlang.status === 200 && sesudahSimpan?.configured === true, `missing=${JSON.stringify(sesudahSimpan?.missing)}`);

  // 7) Cara akses lama (service account) tetap jalan: authMode default 'service' dan kredensialnya
  // dinilai dari JSON — fitur baru tidak boleh merusak jalur yang sudah dipakai.
  const serviceAccount = JSON.stringify({ client_email: 'uji@contoh.invalid', private_key: 'KUNCI', token_uri: `${alamatGoogle}/oauth2/v3/token` });
  const buatService = await kirimJson('/api/admin/providers', { name: 'Drive service', kind: 'gdrive', capacityBytes: 0, config: { folderId: 'FOLDER-UJI', serviceAccountJson: serviceAccount } }, cookie);
  cek('provider service account tetap didukung tanpa authMode', buatService.status === 201 && buatService.data?.authMode === 'service' && buatService.data?.configured === true, `status=${buatService.status} missing=${JSON.stringify(buatService.data?.missing)}`);

  // 8) Berpindah cara akses membuang kredensial cara yang ditinggalkan: setelah pindah ke service
  // account, refresh token lama tidak boleh tersisa lalu dipakai lagi.
  const pindah = await kirimJson(`/api/admin/providers/${providerId}`, { config: { authMode: 'service', folderId: 'FOLDER-UJI', serviceAccountJson: serviceAccount } }, cookie, 'PATCH');
  const sesudahPindah = await providerDari(cookie, providerId);
  const balik = await kirimJson(`/api/admin/providers/${providerId}`, { config: { authMode: 'oauth', clientId: 'CID-uji' } }, cookie, 'PATCH');
  const sesudahBalik = await providerDari(cookie, providerId);
  cek('pindah cara akses membuang kredensial cara lama', pindah.status === 200 && sesudahPindah?.authMode === 'service' && sesudahPindah?.configured === true && balik.status === 200 && /refreshToken/.test(JSON.stringify(sesudahBalik?.missing)) && sesudahBalik?.configured === false, `authMode=${sesudahBalik?.authMode} missing=${JSON.stringify(sesudahBalik?.missing)}`);

  cek('log server tidak memuat unhandledRejection', !/unhandledRejection/.test(logAnak), 'cari "unhandledRejection"');
} catch (error) {
  cek('uji selesai tanpa error', false, error.message);
} finally {
  clearTimeout(paksa);
  bersihkan();
}
console.log(gagal.length ? `GAGAL: ${gagal.length} pemeriksaan -> ${gagal.join(', ')}` : 'Semua uji lulus.');
process.exitCode = gagal.length ? 1 : 0;

