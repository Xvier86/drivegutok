// Sandbox browser: server asli, SQLite sementara, Telegram tiruan lokal.
// Jalankan: node uji/browser-fixture.mjs. Ctrl+C menghapus sandbox; data repo tidak disentuh.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import Database from 'better-sqlite3';

const root = fileURLToPath(new URL('..', import.meta.url));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'drivegutok-browser-'));
const mock = express();
const files = new Map();
let nextFileId = 0;
mock.use(express.json());
mock.post('/token', (_req, res) => res.json({ access_token: 'fixture', expires_in: 3600 }));
mock.get('/drive/v3/files/personal-folder', (_req, res) => res.json({ id: 'personal-folder', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } }));
mock.get('/drive/v3/about', (_req, res) => res.json({ storageQuota: { limit: '0', usage: '0' } }));
mock.get('/botfixture/getChat', (_req, res) => res.json({ ok: true, result: { id: -1001, title: 'Sandbox' } }));
mock.post('/botfixture/sendDocument', multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } }).single('document'), (req, res) => {
  const id = String(++nextFileId);
  files.set(id, req.file.buffer);
  res.json({ ok: true, result: { message_id: Number(id), document: { file_id: id, file_size: req.file.size } } });
});
mock.get('/botfixture/getFile', (req, res) => res.json({ ok: files.has(req.query.file_id), result: { file_path: req.query.file_id } }));
mock.get('/file/botfixture/:id', (req, res) => {
  const data = files.get(req.params.id);
  if (!data) return res.sendStatus(404);
  res.set('Accept-Ranges', 'bytes');
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (!range) return res.end(data);
  const start = Number(range[1]), end = Math.min(Number(range[2] || data.length - 1), data.length - 1);
  if (start > end || start >= data.length) return res.status(416).set('Content-Range', `bytes */${data.length}`).end();
  res.status(206).set('Content-Range', `bytes ${start}-${end}/${data.length}`).end(data.subarray(start, end + 1));
});
mock.get('/botfixture/deleteMessage', (req, res) => { files.delete(String(req.query.message_id)); res.json({ ok: true, result: true }); });
const upstream = mock.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const probe = http.createServer().listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
for (const file of ['server.js', 'package.json']) fs.copyFileSync(path.join(root, file), path.join(kerja, file));
for (const dir of ['node_modules', 'assets']) fs.symlinkSync(path.join(root, dir), path.join(kerja, dir));
const log = fs.openSync(path.join(kerja, 'server.log'), 'a');
const server = spawn(process.execPath, ['server.js'], {
  cwd: kerja, stdio: ['ignore', log, log],
  env: { ...process.env, NODE_ENV: 'test', PORT: String(port), STORAGE_CONFIG_KEY: crypto.randomBytes(32).toString('hex'), TELEGRAM_API_BASE: `http://127.0.0.1:${upstream.address().port}`, GOOGLE_API_BASE: `http://127.0.0.1:${upstream.address().port}`, PUBLIC_BASE_URL: '', TRASH_RETENTION_DAYS: '30' },
});
const base = `http://127.0.0.1:${port}`;
const call = async (url, body, cookie = '', method = 'POST') => {
  const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  assert.ok(response.ok, `${method} ${url}: ${response.status} ${await response.clone().text()}`);
  return response;
};
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.kill('SIGTERM');
  if (server.exitCode === null && server.signalCode === null) await once(server, 'exit');
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
  fs.closeSync(log);
  fs.rmSync(kerja, { recursive: true, force: true });
}
process.on('SIGINT', () => close().then(() => process.exit(0)));
process.on('SIGTERM', () => close().then(() => process.exit(0)));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(base + '/api/setup', { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'sandbox server ready');
  const password = crypto.randomBytes(24).toString('base64url');
  await call('/api/setup', { email: 'owner@fixture.invalid', username: 'owner', password });
  const ownerLogin = await call('/api/login', { identity: 'owner', password });
  const ownerCookie = ownerLogin.headers.get('set-cookie').split(';')[0];
  await call('/api/admin/users', { email: 'member@fixture.invalid', username: 'member', password }, ownerCookie);
  const memberLogin = await call('/api/login', { identity: 'member', password });
  const memberCookie = memberLogin.headers.get('set-cookie').split(';')[0];
  const provider = await (await call('/api/admin/providers', { name: 'Telegram sandbox', kind: 'telegram', capacityBytes: 1024 ** 3, config: { botToken: 'fixture', chatId: '-1001' } }, ownerCookie)).json();
  await call(`/api/admin/providers/${provider.id}`, { enabled: true }, ownerCookie, 'PATCH');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const google = await (await call('/api/admin/providers', { name: 'Google personal tidak valid', kind: 'gdrive', capacityBytes: 0, config: { folderId: 'personal-folder', serviceAccountJson: JSON.stringify({ client_email: 'fixture@fixture.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `http://127.0.0.1:${upstream.address().port}/token` }) } }, ownerCookie)).json();
  // Reproduksi provider lama: aktif sebelum validasi Shared Drive diperkenalkan.
  const db = new Database(path.join(kerja, 'data', 'mydrive.sqlite'));
  db.prepare('UPDATE providers SET enabled = 1 WHERE id = ?').run(google.id);
  db.prepare('UPDATE providers SET used_bytes = 1 WHERE id = ?').run(provider.id);
  db.close();
  const fixtures = path.join(kerja, 'fixtures');
  fs.mkdirSync(fixtures);
  fs.writeFileSync(path.join(fixtures, 'catatan.txt'), 'Berkas uji lokal. Tidak dikirim ke cloud.\n');
  fs.writeFileSync(path.join(fixtures, 'gambar.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#2563eb"/></svg>');
  fs.writeFileSync(path.join(fixtures, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGmsAAAAASUVORK5CYII=', 'base64'));
  fs.writeFileSync(path.join(kerja, 'session.json'), JSON.stringify({ base, ownerCookie, memberCookie, fixtures, providerId: provider.id }), { mode: 0o600 });
  console.log(JSON.stringify({ base, workspace: kerja, sessions: path.join(kerja, 'session.json'), fixtures }));
} catch (error) {
  console.error(error.message);
  await close();
  process.exitCode = 1;
}
