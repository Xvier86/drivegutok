// node uji/keamanan.mjs; opsional CHROME_BIN=/path/to/chrome untuk bukti eksekusi SVG.
// Semua DB, storage, akun, provider, dan profil browser adalah fixture sementara.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-keamanan-'));
for (const berkas of ['server.js', 'package.json']) fs.copyFileSync(path.join(root, berkas), path.join(kerja, berkas));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));
fs.mkdirSync(path.join(kerja, 'assets'));
const payload = '<svg xmlns="http://www.w3.org/2000/svg"><script>parent.document.querySelector("#hasil").textContent="XSS";</script></svg>';
const isiFile = new Map([['svg', payload], ['html', '<script>parent.document.querySelector("#hasil").textContent="XSS";</script>'], ['png', 'fixture-png']]);
let panggilanProvider = 0;
const upstream = http.createServer(async (req, res) => {
  panggilanProvider += 1;
  const url = new URL(req.url, 'http://fixture');
  const json = (data) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  if (url.pathname.endsWith('/getFile')) return json({ ok: true, result: { file_path: url.searchParams.get('file_id') } });
  if (url.pathname.startsWith('/file/')) {
    const isi = isiFile.get(url.pathname.split('/').pop());
    return res.writeHead(isi === undefined ? 404 : 200).end(isi);
  }
  if (url.pathname.endsWith('/getChat')) return json({ ok: true, result: { id: -100 } });
  if (url.pathname.endsWith('/sendDocument')) {
    for await (const _ of req) { /* Hanya fixture lokal; tidak ada provider asli. */ }
    return json({ ok: true, result: { message_id: 1, document: { file_id: 'png' } } });
  }
  req.resume();
  res.writeHead(404).end();
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const alamatUpstream = `http://127.0.0.1:${upstream.address().port}`;
const slot = http.createServer();
await new Promise((resolve) => slot.listen(0, '127.0.0.1', resolve));
const port = slot.address().port;
await new Promise((resolve) => slot.close(resolve));
const dasar = `http://127.0.0.1:${port}`;
const anak = spawn(process.execPath, ['server.js'], {
  cwd: kerja,
  env: { PATH: process.env.PATH, PORT: String(port), PUBLIC_BASE_URL: `${dasar}/`, NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'kunci-fixture-keamanan', TELEGRAM_API_BASE: alamatUpstream, GOOGLE_API_BASE: alamatUpstream, GOOGLE_AUTH_BASE: alamatUpstream },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
for (const stream of [anak.stdout, anak.stderr]) stream.on('data', (data) => { log += data; });
let db;
let browser;
const hasil = [];
const cek = async (nama, periksa) => {
  try { await periksa(); hasil.push({ nama, ok: true }); console.log(`OK ${nama}`); }
  catch (error) { hasil.push({ nama, ok: false }); console.error(`GAGAL ${nama}: ${error.message}`); }
};
const api = (jalur, opsi = {}) => fetch(`${dasar}${jalur}`, { signal: AbortSignal.timeout(5000), ...opsi });
const kirim = (jalur, body, cookie = '', method = 'POST') => api(jalur, { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
const masuk = async (identity) => {
  const res = await kirim('/api/login', { identity, password: 'rahasia-fixture' });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
};
const paksa = setTimeout(() => { anak.kill('SIGKILL'); browser?.kill('SIGKILL'); console.error('Timeout uji keamanan'); process.exit(1); }, 60000);
try {
  let siap = false;
  for (let i = 0; i < 100; i += 1) {
    if (anak.exitCode !== null) throw new Error(log);
    try { siap = (await api('/api/setup')).ok; } catch { /* belum listen */ }
    if (siap) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(siap, log);
  const setups = await Promise.all([
    kirim('/api/setup', { email: 'owner@fixture.invalid', username: 'owner', password: 'rahasia-fixture' }),
    kirim('/api/setup', { email: 'owner2@fixture.invalid', username: 'owner2', password: 'rahasia-fixture' }),
  ]);
  assert.deepEqual(setups.map((res) => res.status).sort(), [201, 409], 'setup paralel hanya membuat satu owner');
  const setup = setups.find((res) => res.status === 201);
  const owner = (await setup.json()).user;
  const cookie = await masuk(owner.username);
  const memberRes = await kirim('/api/admin/users', { email: 'member@fixture.invalid', username: 'member', password: 'rahasia-fixture' }, cookie);
  assert.equal(memberRes.status, 201);
  const member = await memberRes.json();
  const cookieMember = await masuk('member');
  db = new Database(path.join(kerja, 'data', 'mydrive.sqlite'));
  db.prepare('INSERT INTO providers (id, name, kind, enabled, config_json) VALUES (?, ?, ?, ?, ?)').run('fixture', 'Telegram lokal', 'telegram', 1, JSON.stringify({ botToken: 'fixture', chatId: '-100' }));
  const buatFile = (id, mime, extra = {}) => {
    db.prepare('INSERT INTO files (id, owner_id, name, mime_type, size, provider, remote_file_id, uploaded_by, uploaded_at, cdn_enabled, cdn_slug, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, extra.ownerId || owner.id, `${id}.bin`, mime, 11, 'fixture', `telegram:${id}`, owner.id, new Date().toISOString(), 1, `slug-${id}`, extra.expiresAt || null);
  };
  buatFile('svg', 'image/svg+xml');
  buatFile('html', 'text/html');
  buatFile('png', 'image/png');

  await cek('SVG CDN memakai sandbox tanpa script/same-origin', async () => {
    const res = await api('/cdn/slug-svg');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), payload);
    const csp = res.headers.get('content-security-policy') || '';
    assert.match(csp, /(?:^|;)\s*sandbox\s*(?:;|$)/);
    assert.match(csp, /default-src 'none'/);
  });
  await cek('HTML privat tidak dirender inline', async () => {
    const res = await api('/api/files/html/download', { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') || '', /^attachment;/);
    await res.text();
  });
  await cek('preview PNG tetap inline + nosniff', async () => {
    const res = await api('/api/files/png/download', { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /^inline;/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await res.text(), isiFile.get('png'));
  });
  await cek('download privat menolak anonim dan member lain', async () => {
    assert.equal((await api('/api/files/png/download')).status, 401);
    assert.equal((await api('/api/files/png/download', { headers: { cookie: cookieMember } })).status, 404);
    assert.equal((await kirim('/api/files/png/share', {}, cookieMember)).status, 404);
    assert.equal((await api('/api/admin/overview', { headers: { cookie: cookieMember } })).status, 403);
  });

  await cek('retensi file berlaku pada metadata share, unduh privat/publik, CDN', async () => {
    const shareRes = await kirim('/api/files/png/share', { password: 'buka-fixture' }, cookie);
    assert.equal(shareRes.status, 200);
    const share = await shareRes.json();
    assert.equal((await api(`/api/shares/${share.token}?password=buka-fixture`)).status, 200);
    assert.equal((await api(`/api/shares/${share.token}`)).status, 401);
    const unduh = await api(`/s/${share.token}/download?password=buka-fixture`);
    assert.equal(unduh.status, 200);
    assert.equal(await unduh.text(), isiFile.get('png'));
    db.prepare('UPDATE files SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', 'png');
    try {
      const status = [];
      for (const jalur of ['/api/files/png/download', `/api/shares/${share.token}?password=buka-fixture`, `/s/${share.token}/download?password=buka-fixture`, '/cdn/slug-png']) {
        const res = await api(jalur, { headers: { cookie } });
        await res.text();
        status.push(res.status);
      }
      status.push((await kirim('/api/files/png/share', {}, cookie)).status);
      assert.deepEqual(status, [404, 404, 404, 404, 404]);
    } finally { db.prepare('UPDATE files SET expires_at = NULL WHERE id = ?').run('png'); }
  });
  await cek('cache unduhan tidak melewati password, pencabutan, atau kedaluwarsa', async () => {
    const shareRes = await kirim('/api/files/png/share', { password: 'buka-fixture' }, cookie);
    const share = await shareRes.json();
    for (const jalur of ['/api/files/png/download', `/api/shares/${share.token}?password=buka-fixture`, `/s/${share.token}/download?password=buka-fixture`, '/cdn/slug-png']) {
      const res = await api(jalur, { headers: { cookie } });
      await res.text();
      assert.equal(res.status, 200, jalur);
      assert.match(res.headers.get('cache-control') || '', /no-store|(?:no-cache|(?:max-age=0.*must-revalidate))/, jalur);
    }
  });

  const unggah = async (jalur, fields = {}, cookieUpload = cookie, mime = 'image/png') => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set('file', new Blob(['fixture-png'], { type: mime }), 'fixture.png');
    return api(jalur, { method: 'POST', headers: { cookie: cookieUpload }, body: form });
  };
  await cek('upload/CDN menolak folder asing/hilang sebelum provider dihubungi', async () => {
    const folderRes = await kirim('/api/folders', { name: 'privat-member' }, cookieMember);
    const folder = await folderRes.json();
    const sebelum = panggilanProvider;
    const status = [];
    for (const jalur of ['/api/files', '/api/files/cdn']) {
      for (const folderId of [folder.id, 'folder-tidak-ada']) {
        const res = await unggah(jalur, { folderId });
        await res.text();
        status.push(res.status);
      }
    }
    assert.deepEqual(status, [404, 404, 404, 404]);
    assert.equal(panggilanProvider, sebelum);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files WHERE folder_id IS NOT NULL').get().n, 0);
    assert.deepEqual(fs.readdirSync(path.join(kerja, 'data', 'tmp')), []);
    const folderOwner = await (await kirim('/api/folders', { name: 'milik-owner' }, cookie)).json();
    for (const jalur of ['/api/files', '/api/files/cdn']) {
      const res = await unggah(jalur, { folderId: folderOwner.id });
      assert.equal(res.status, 201);
      assert.equal((await res.json()).folder_id, folderOwner.id);
    }
  });

  await cek('link share baru dan lama mengunduh tanpa sesi', async () => {
    const res = await api('/api/files/png/share', { method: 'POST', headers: { cookie, 'content-type': 'application/json', host: 'untrusted.invalid' }, body: '{}' });
    const share = await res.json();
    assert.equal(res.status, 200);
    assert.equal(new URL(share.url).origin, dasar);
    const unduh = await fetch(share.url, { signal: AbortSignal.timeout(5000) });
    assert.equal(unduh.status, 200);
    assert.equal(await unduh.text(), isiFile.get('png'));
    assert.equal(new URL(share.url).pathname, `/s/${share.token}/download`);
    const lama = await api(`/s/${share.token}`);
    assert.equal(lama.status, 200);
    assert.equal(await lama.text(), isiFile.get('png'));
    const kunci = await (await kirim('/api/files/png/share', { password: 'buka-fixture' }, cookie)).json();
    const lamaTerkunci = await api(`/s/${kunci.token}?password=buka-fixture`);
    assert.equal(lamaTerkunci.status, 200);
    assert.equal(await lamaTerkunci.text(), isiFile.get('png'));
    assert.equal((await api(`/s/${kunci.token}`)).status, 404);
  });

  await cek('password baru memakai scrypt bersalt; SHA256 lama dimigrasi setelah login sah', async () => {
    const bacaHash = (uid) => db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid).password_hash;
    assert.match(bacaHash(owner.id), /^scrypt\$/);
    assert.match(bacaHash(member.id), /^scrypt\$/);
    assert.notEqual(bacaHash(owner.id), bacaHash(member.id), 'password sama wajib salt berbeda');
    const lama = crypto.createHash('sha256').update('rahasia-fixture').digest('hex');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(lama, member.id);
    assert.equal((await kirim('/api/login', { identity: 'member', password: 'salah' })).status, 401);
    assert.equal(bacaHash(member.id), lama);
    await masuk('member');
    assert.match(bacaHash(member.id), /^scrypt\$/);
    const ubah = await kirim('/api/account/password', { currentPassword: 'rahasia-fixture', newPassword: 'rahasia-baru', confirmPassword: 'rahasia-baru' }, cookieMember, 'PATCH');
    assert.equal(ubah.status, 200);
    assert.match(bacaHash(member.id), /^scrypt\$/);
    assert.equal((await kirim('/api/login', { identity: 'member', password: 'rahasia-baru' })).status, 200);
    assert.equal((await kirim('/api/login', { identity: 'member', password: 'rahasia-fixture' })).status, 401);
  });

  await cek('auth menolak body kosong dan tipe salah tanpa 500', async () => {
    const status = [];
    for (const body of [{ identity: 42, password: 'x' }, { identity: 'owner', password: {} }, { identity: 'owner', password: 'x'.repeat(1025) }]) status.push((await kirim('/api/login', body)).status);
    status.push((await api('/api/login', { method: 'POST' })).status);
    status.push((await kirim('/api/admin/users', { email: {}, username: 'buruk', password: 'rahasia-fixture' }, cookie)).status);
    status.push((await kirim('/api/admin/users', { email: 'x@fixture.invalid', username: '   ', password: 'rahasia-fixture' }, cookie)).status);
    status.push((await kirim('/api/account/password', { currentPassword: 'rahasia-fixture', newPassword: {}, confirmPassword: {} }, cookie, 'PATCH')).status);
    assert.deepEqual(status, Array(status.length).fill(400));
  });
  await cek('password share query berulang ditolak tanpa 500', async () => {
    const share = await (await kirim('/api/files/png/share', { password: 'buka-fixture' }, cookie)).json();
    assert.equal((await api(`/api/shares/${share.token}?password=a&password=b`)).status, 400);
    assert.equal((await api(`/s/${share.token}/download?password=a&password=b`)).status, 400);
  });

  await cek('upload/CDN menolak retensi invalid; temp tidak bocor', async () => {
    const sebelum = panggilanProvider;
    const status = [];
    for (const jalur of ['/api/files', '/api/files/cdn']) {
      for (const retentionValue of ['-1', '1.5', '100000000000000', 'bukan-angka']) {
        const res = await unggah(jalur, { retentionType: 'days', retentionValue });
        await res.text();
        status.push(res.status);
      }
    }
    assert.deepEqual(status, Array(status.length).fill(400));
    assert.equal(panggilanProvider, sebelum);
    assert.deepEqual(fs.readdirSync(path.join(kerja, 'data', 'tmp')), []);
  });

  await cek('verifikasi email async tidak menerima password yang sudah diganti', async () => {
    const old = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(owner.id).password_hash;
    const email = db.prepare('SELECT email FROM users WHERE id = ?').get(owner.id).email;
    const pending = kirim('/api/account/email', { email: 'penyerang@fixture.invalid', currentPassword: 'rahasia-fixture' }, cookie, 'PATCH');
    await new Promise((resolve) => setTimeout(resolve, 30));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(crypto.createHash('sha256').update('diganti').digest('hex'), owner.id);
    try {
      assert.equal((await pending).status, 401);
      assert.equal(db.prepare('SELECT email FROM users WHERE id = ?').get(owner.id).email, email);
    } finally { db.prepare('UPDATE users SET password_hash = ?, email = ? WHERE id = ?').run(old, email, owner.id); }
  });

  // Akun sasaran terpisah; SHA256 fixture membuat percobaan salah murah tanpa migrasi.
  db.prepare('INSERT INTO users (id, email, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('limit-target', 'limit@fixture.invalid', 'limit-target', crypto.createHash('sha256').update('rahasia-fixture').digest('hex'), 'user', 'active', new Date().toISOString());
  await cek('login brute force dibatasi; X-Forwarded-For tidak melewati batas', async () => {
    const responses = [];
    for (let i = 0; i < 35; i += 1) {
      responses.push(await api('/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${i}` }, body: JSON.stringify({ identity: 'limit-target', password: 'salah' }) }));
    }
    assert.ok(responses.some((res) => res.status === 429), 'tidak ada 429');
    assert.equal(responses.at(-1).status, 429);
    assert.ok(Number(responses.at(-1).headers.get('retry-after')) > 0);
  });

  await cek('limiter menutup variasi huruf besar dan trailing slash', async () => {
    const responses = [];
    for (let i = 0; i < 35; i += 1) {
      const route = i % 2 ? '/API/Login/' : '/api/LOGIN';
      responses.push(await kirim(route, { identity: 'limit-target', password: 'salah' }));
    }
    assert.ok(responses.every((res) => res.status === 429));
  });

  await cek('proxy: kuota login milik akun sasaran, bukan seluruh IP proxy', async () => {
    assert.equal((await kirim('/api/login', { identity: ' LIMIT@FIXTURE.INVALID ', password: 'rahasia-fixture' })).status, 429, 'email/username berbagi kuota akun');
    await masuk(owner.username);
  });
  await cek('proxy: request anonim/tidak valid tidak menghabiskan kuota akun', async () => {
    const body = { email: owner.email, currentPassword: 'salah', newPassword: 'rahasia-baru', confirmPassword: 'rahasia-baru' };
    for (let i = 0; i < 35; i += 1) {
      for (const route of ['/api/account/email', '/api/account/password']) {
        assert.equal((await kirim(route, body, '', 'PATCH')).status, 401, route);
        assert.equal((await kirim(route, body, cookie, 'POST')).status, 404, route);
        assert.equal((await kirim(`${route}/unknown`, body, cookie, 'PATCH')).status, 404, route);
      }
      assert.equal((await kirim('/api/login', { identity: owner.username, password: {} })).status, 400);
      assert.equal((await kirim('/api/login', { identity: owner.username, password: 'salah' }, '', 'PATCH')).status, 404);
      assert.equal((await kirim('/api/setup', {})).status, 409, 'setup tertutup tidak mengonsumsi kuota');
    }
    await masuk(owner.username);
    assert.equal((await kirim('/api/account/email', { email: owner.email, currentPassword: 'rahasia-fixture' }, cookie, 'PATCH')).status, 200);
    assert.equal((await kirim('/api/account/password', { ...body, currentPassword: 'rahasia-fixture' }, cookie, 'PATCH')).status, 200);
  });
  await cek('proxy: kuota perubahan akun terpisah setelah autentikasi', async () => {
    const token = 'fixture-limit-session';
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(token, 'limit-target', '2099-01-01T00:00:00.000Z');
    const body = { email: 'limit@fixture.invalid', currentPassword: 'salah', newPassword: 'rahasia-baru', confirmPassword: 'rahasia-baru' };
    for (const route of ['/api/account/email', '/api/account/password']) {
      const responses = [];
      for (let i = 0; i < 31; i += 1) responses.push(await kirim(route, body, `mydrive_session=${token}`, 'PATCH'));
      assert.deepEqual(responses.map((res) => res.status), [...Array(30).fill(401), 429], route);
      assert.equal(Number(responses.at(-1).headers.get('retry-after')) > 0, true);
    }
    assert.equal((await kirim('/api/account/email', { email: 'member@fixture.invalid', currentPassword: 'rahasia-baru' }, cookieMember, 'PATCH')).status, 200);
    assert.equal((await kirim('/api/account/password', { ...body, currentPassword: 'rahasia-baru' }, cookieMember, 'PATCH')).status, 200);
  });

  if (process.env.CHROME_BIN) await cek('browser: SVG img/iframe/object tidak menjalankan script', async () => {
    fs.writeFileSync(path.join(kerja, 'assets', 'probe.html'), '<!doctype html><p id="hasil">AMAN</p><img src="/cdn/slug-svg"><iframe src="/cdn/slug-svg"></iframe><object data="/cdn/slug-svg" type="image/svg+xml"></object>');
    browser = spawn(process.env.CHROME_BIN, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking', `--user-data-dir=${path.join(kerja, 'browser')}`, '--dump-dom', '--virtual-time-budget=3000', `${dasar}/probe.html`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let dom = '', errors = '';
    browser.stdout.on('data', (data) => { dom += data; });
    browser.stderr.on('data', (data) => { errors += data; });
    const stop = setTimeout(() => browser.kill('SIGKILL'), 12000);
    const [code] = await once(browser, 'close');
    clearTimeout(stop);
    assert.equal(code, 0, errors);
    assert.match(dom, /id="hasil">AMAN<\/p>/);
  });
  await cek('server tetap sehat; tidak ada exception tak tertangani', async () => {
    assert.equal((await api('/api/setup')).status, 200);
    assert.doesNotMatch(log, /\[uncaughtException\]|\[unhandledRejection\]/);
  });
} catch (error) {
  hasil.push({ nama: 'fixture', ok: false });
  console.error(error.stack, log);
} finally {
  clearTimeout(paksa);
  db?.close();
  if (anak.exitCode === null) { anak.kill('SIGTERM'); await once(anak, 'close'); }
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  fs.rmSync(kerja, { recursive: true, force: true });
}
const gagal = hasil.filter((item) => !item.ok);
console.log(`${hasil.length - gagal.length}/${hasil.length} uji keamanan lulus.`);
process.exitCode = gagal.length ? 1 : 0;
