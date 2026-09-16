// node uji/pilihan-upload.mjs — salinan server + DB sementara, hanya API tiruan lokal.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-pilihan-upload-'));
const payload = Buffer.from('uji pilihan upload\n');
const calls = { google: 0, telegram: 0, folders: 0 };
const stored = new Map();
let quota = { usage: '0', limit: '0' };
let rejectUpload = false;
let rejectDelete = false;
let pendingDeletes = null;
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const reply = (body, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  let prefix = Buffer.alloc(0);
  for await (const chunk of req) if (prefix.length < 4096) prefix = Buffer.concat([prefix, chunk]).subarray(0, 4096);
  if (url.pathname === '/slow-token' || url.pathname === '/drive/v3/files/slow-folder') return;
  if (url.pathname === '/token' || url.pathname === '/oauth2/v3/token') return reply({ access_token: 'local-token' });
  if (url.pathname === '/drive/v3/about') return reply({ storageQuota: quota });
  if (url.pathname.startsWith('/drive/v3/files/')) {
    if (req.method === 'DELETE') {
      if (pendingDeletes) {
        pendingDeletes.push(res);
        if (pendingDeletes.length === 2) for (const response of pendingDeletes) response.writeHead(204).end();
        return;
      }
      return rejectDelete ? reply({ error: { message: 'local delete rejected' } }, 403) : res.writeHead(204).end();
    }
    calls.folders++;
    const folder = url.pathname.split('/').at(-1);
    return reply({ id: folder, mimeType: 'application/vnd.google-apps.folder', ...(folder === 'shared' ? { driveId: 'shared-drive' } : {}), capabilities: { canAddChildren: true } });
  }
  if (url.pathname === '/upload/drive/v3/files') {
    calls.google++;
    if (prefix.includes('"personal"') || rejectUpload) return reply({ error: { message: 'local upload rejected' } }, 403);
    return reply({ id: `google-${calls.google}` });
  }
  if (url.pathname.endsWith('/getChat')) return reply({ ok: true, result: { id: 123 } });
  if (url.pathname.endsWith('/sendDocument')) {
    calls.telegram++;
    const fileId = `telegram-${calls.telegram}`;
    const start = prefix.indexOf('\r\n\r\n', prefix.indexOf('name="document"')) + 4;
    const end = prefix.indexOf('\r\n--', start);
    stored.set(fileId, prefix.subarray(start, end));
    return reply({ ok: true, result: { message_id: calls.telegram, document: { file_id: fileId } } });
  }
  if (url.pathname.endsWith('/getFile')) return reply({ ok: true, result: { file_path: url.searchParams.get('file_id') } });
  if (url.pathname.startsWith('/file/')) return res.end(stored.get(url.pathname.split('/').at(-1)));
  return reply({ error: { message: `Unexpected local API: ${url.pathname}` } }, 404);
});
await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
const fakeBase = `http://127.0.0.1:${fake.address().port}`;
const reserve = http.createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
fs.copyFileSync(process.env.UJI_SERVER_JS || path.join(root, 'server.js'), path.join(kerja, 'server.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(kerja, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));
const child = spawn(process.execPath, ['server.js'], {
  cwd: kerja,
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'local-test-only', TELEGRAM_API_BASE: fakeBase, GOOGLE_API_BASE: fakeBase, TELEGRAM_CHAT_ID: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', chunk => { logs += chunk; });
child.stderr.on('data', chunk => { logs += chunk; });
const base = `http://127.0.0.1:${port}`;
const api = (url, options = {}) => fetch(`${base}${url}`, { ...options, signal: AbortSignal.timeout(15000) });
let db;
let failures = 0;
let checks = 0;
const check = async (name, fn) => {
  checks++;
  try { await fn(); console.log(`OK ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
};
try {
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    try { ready = (await api('/api/setup')).ok; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.ok(ready, logs);
  db = new Database(path.join(kerja, 'data/mydrive.sqlite'));
  for (const role of ['owner', 'user']) {
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)').run(role, `${role}@example.invalid`, role, 'unused', role, 'active', new Date().toISOString());
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(role, role, new Date(Date.now() + 600000).toISOString());
  }
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const service = folderId => ({ folderId, authMode: 'service', serviceAccountJson: { client_email: 'test@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${fakeBase}/token` } });
  const telegram = { botToken: 'local-token', chatId: '123' };
  const seed = (id, kind, config, used = 0, capacity = 0) => db.prepare('INSERT INTO providers (id,name,kind,enabled,used_bytes,capacity_bytes,config_json) VALUES (?,?,?,1,?,?,?)').run(id, id, kind, used, capacity, JSON.stringify(config));
  const reset = () => { db.exec('DELETE FROM files; DELETE FROM providers'); calls.google = calls.telegram = calls.folders = 0; stored.clear(); };
  const upload = async (route, providerId = '', role = 'owner', blob = new Blob([payload], { type: 'image/png' })) => {
    const form = new FormData();
    if (providerId) form.set('providerId', providerId);
    form.set('file', blob, 'test.png');
    const response = await api(route, { method: 'POST', headers: { cookie: `mydrive_session=${role}` }, body: form });
    return { status: response.status, data: await response.json() };
  };
  const routes = ['/api/files', '/api/files/cdn'];
  for (const route of routes) {
    await check(`${route}: invalid Google skipped before upload; Telegram bytes intact`, async () => {
      reset(); seed('bad-google', 'gdrive', service('personal')); seed('healthy', 'telegram', telegram, 100);
      const result = await upload(route);
      assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(result.data.provider, 'healthy');
      assert.equal(db.prepare('SELECT provider FROM files WHERE id = ?').get(result.data.id)?.provider, 'healthy');
      assert.equal(calls.google, 0, 'invalid Google must not receive upload bytes');
      assert.equal(calls.telegram, 1);
      const download = await api(route.endsWith('/cdn') ? result.data.cdnUrl : `/api/files/${result.data.id}/download`, { headers: { cookie: 'mydrive_session=owner' } });
      assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload);
      assert.deepEqual(fs.readdirSync(path.join(kerja, 'data/tmp')), []);
    });
    await check(`${route}: explicit bad Google returns 409 without upload`, async () => {
      reset(); seed('explicit-bad', 'gdrive', service('personal')); seed('healthy', 'telegram', telegram, 100);
      const result = await upload(route, 'explicit-bad');
      assert.equal(result.status, 409, JSON.stringify(result));
      assert.match(result.data.error, /Shared Drive.*OAuth/);
      assert.equal(calls.google + calls.telegram, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files').get().n, 0);
      assert.deepEqual(fs.readdirSync(path.join(kerja, 'data/tmp')), []);
    });
    await check(`${route}: only invalid candidate fails clearly`, async () => {
      reset(); seed('only-bad', 'gdrive', service('personal'));
      const result = await upload(route);
      assert.equal(result.status, 409, JSON.stringify(result));
      assert.match(result.data.error, /Shared Drive.*OAuth/);
      assert.equal(calls.google, 0);
    });
    for (const config of [service('shared'), { authMode: 'oauth', folderId: 'oauth-personal', clientId: 'local', clientSecret: 'local', refreshToken: 'local' }]) {
      await check(`${route}: ${config.authMode} valid folder accepted`, async () => {
        reset(); seed('valid-google', 'gdrive', config);
        const result = await upload(route, 'valid-google');
        assert.equal(result.status, 201, JSON.stringify(result));
        assert.equal(result.data.provider, 'valid-google');
        assert.equal(calls.google, 1);
      });
    }
    await check(`${route}: full, incomplete, disabled providers skipped`, async () => {
      reset(); seed('incomplete', 'gdrive', {}, 0); seed('no-chat', 'telegram', { botToken: 'local' }, 1);
      seed('full', 'telegram', telegram, 2, 3); seed('disabled', 'telegram', telegram, 3);
      db.prepare('UPDATE providers SET enabled = 0 WHERE id = ?').run('disabled');
      seed('healthy', 'telegram', telegram, 100, 1000);
      const result = await upload(route);
      assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(result.data.provider, 'healthy');
      assert.equal(calls.telegram, 1);
      for (const providerId of ['incomplete', 'no-chat', 'full', 'disabled', 'absent']) {
        const invalid = await upload(route, providerId);
        assert.equal(invalid.status, 409, JSON.stringify(invalid));
        assert.equal(calls.telegram, 1);
      }
    });
    await check(`${route}: member providerId ignored; owner selection retained`, async () => {
      reset(); seed('bad-google', 'gdrive', service('personal')); seed('healthy', 'telegram', telegram, 100); seed('manual', 'telegram', telegram, 1000);
      const member = await upload(route, 'manual', 'user');
      assert.equal(member.status, 201, JSON.stringify(member));
      assert.equal(member.data.provider, 'healthy');
      const owner = await upload(route, 'manual');
      assert.equal(owner.status, 201, JSON.stringify(owner));
      assert.equal(owner.data.provider, 'manual');
    });
    await check(`${route}: no retry after upstream received upload`, async () => {
      reset(); seed('shared-google', 'gdrive', service('shared')); seed('healthy', 'telegram', telegram, 100);
      rejectUpload = true;
      try {
        const result = await upload(route);
        assert.equal(result.status, 502, JSON.stringify(result));
        assert.equal(calls.google, 1);
        assert.equal(calls.telegram, 0);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files').get().n, 0);
      } finally { rejectUpload = false; }
    });
  }
  const waitCapacity = async id => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const overview = await (await api('/api/admin/overview', { headers: { cookie: 'mydrive_session=owner' } })).json();
      if (overview.providers.find(provider => provider.id === id)?.capacitySource === 'google-drive') return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('capacity cache not ready');
  };
  for (const route of routes) {
    await check(`${route}: cached cloud capacity overrides stale DB capacity`, async () => {
      reset(); const id = `cached-full-${route}`;
      quota = { usage: '100', limit: '100' };
      seed(id, 'gdrive', service('shared')); seed('healthy', 'telegram', telegram, 100);
      await waitCapacity(id);
      const result = await upload(route);
      assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(result.data.provider, 'healthy');
      const explicit = await upload(route, id);
      assert.equal(explicit.status, 409, JSON.stringify(explicit));
      assert.match(explicit.data.error, /Kapasitas/);
      assert.equal(calls.google, 0);
    });
  }
  await check('cached cloud usage includes subsequent successful uploads', async () => {
    reset(); quota = { usage: '0', limit: String(payload.length * 2) }; seed('cached-progress', 'gdrive', service('shared'));
    await waitCapacity('cached-progress');
    for (const route of routes) assert.equal((await upload(route, 'cached-progress')).status, 201);
    const result = await upload('/api/files', 'cached-progress');
    assert.equal(result.status, 409, JSON.stringify(result));
    assert.equal(calls.google, 2);
  });
  await check('successful purge frees cached capacity; failed purge preserves it', async () => {
    reset(); quota = { usage: '0', limit: String(payload.length) }; seed('cached-purge', 'gdrive', service('shared'));
    await waitCapacity('cached-purge');
    const uploaded = await upload('/api/files', 'cached-purge');
    assert.equal(uploaded.status, 201);
    assert.equal((await upload('/api/files', 'cached-purge')).status, 409);
    const deletion = () => api(`/api/files/${uploaded.data.id}/permanent`, { method: 'DELETE', headers: { cookie: 'mydrive_session=owner' } });
    rejectDelete = true;
    try {
      assert.equal((await deletion()).status, 502);
      assert.ok(db.prepare('SELECT id FROM files WHERE id = ?').get(uploaded.data.id));
      assert.equal(db.prepare('SELECT used_bytes FROM providers WHERE id = ?').get('cached-purge').used_bytes, payload.length);
      assert.equal((await upload('/api/files', 'cached-purge')).status, 409, 'failed deletion must not free cached capacity');
      assert.equal(calls.google, 1);
    } finally { rejectDelete = false; }
    assert.equal((await deletion()).status, 204);
    assert.equal(db.prepare('SELECT id FROM files WHERE id = ?').get(uploaded.data.id), undefined);
    assert.equal(db.prepare('SELECT used_bytes FROM providers WHERE id = ?').get('cached-purge').used_bytes, 0);
    assert.equal((await upload('/api/files/cdn', 'cached-purge')).status, 201, 'successful deletion must free cached capacity');
    assert.equal((await upload('/api/files', 'cached-purge')).status, 409, 'replacement upload fills capacity again');
    assert.equal(calls.google, 2);
  });
  await check('overlapping purges decrement DB and cached usage only once', async () => {
    reset(); quota = { usage: '0', limit: String(payload.length * 2) }; seed('overlapping-purge', 'gdrive', service('shared'));
    await waitCapacity('overlapping-purge');
    const uploaded = await upload('/api/files', 'overlapping-purge');
    const retained = await upload('/api/files', 'overlapping-purge');
    assert.equal(uploaded.status, 201);
    assert.equal(retained.status, 201);
    pendingDeletes = [];
    try {
      const deletion = () => api(`/api/files/${uploaded.data.id}/permanent`, { method: 'DELETE', headers: { cookie: 'mydrive_session=owner' } });
      const responses = await Promise.all([deletion(), deletion()]);
      assert.deepEqual(responses.map(response => response.status), [204, 204]);
      assert.equal(pendingDeletes.length, 2, 'both purges must reach the provider before either completes');
    } finally { pendingDeletes = null; }
    assert.equal(db.prepare('SELECT id FROM files WHERE id = ?').get(uploaded.data.id), undefined);
    assert.ok(db.prepare('SELECT id FROM files WHERE id = ?').get(retained.data.id));
    const overview = await (await api('/api/admin/overview', { headers: { cookie: 'mydrive_session=owner' } })).json();
    assert.deepEqual({
      db: db.prepare('SELECT used_bytes FROM providers WHERE id = ?').get('overlapping-purge').used_bytes,
      cached: overview.providers.find(provider => provider.id === 'overlapping-purge').used_bytes,
    }, { db: payload.length, cached: payload.length }, 'retained file must remain counted in DB and cache');
    assert.equal((await upload('/api/files/cdn', 'overlapping-purge')).status, 201);
    assert.equal((await upload('/api/files', 'overlapping-purge')).status, 409, 'only one upload slot was freed');
    assert.equal(calls.google, 3);
  });
  for (const folderId of ['personal', 'shared', 'oauth-personal']) {
    await check(`activation validates ${folderId}`, async () => {
      reset();
      seed('activate', 'gdrive', folderId === 'oauth-personal' ? { authMode: 'oauth', folderId, clientId: 'local', clientSecret: 'local', refreshToken: 'local' } : service(folderId));
      db.prepare('UPDATE providers SET enabled = 0 WHERE id = ?').run('activate');
      const response = await api('/api/admin/providers/activate', { method: 'PATCH', headers: { cookie: 'mydrive_session=owner', 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
      assert.equal(response.status, folderId === 'personal' ? 409 : 200);
      assert.equal(db.prepare('SELECT enabled FROM providers WHERE id = ?').get('activate').enabled, folderId === 'personal' ? 0 : 1);
    });
  }
  await check('Telegram over 50 MB skips to Shared Drive; explicit Telegram rejects', async () => {
    reset(); seed('telegram', 'telegram', telegram); seed('large-google', 'gdrive', service('shared'), 100);
    const file = path.join(kerja, 'large.bin');
    const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, 50 * 1024 * 1024 + 1); fs.closeSync(fd);
    const blob = await fs.openAsBlob(file);
    const automatic = await upload('/api/files', '', 'owner', blob);
    assert.equal(automatic.status, 201, JSON.stringify(automatic));
    assert.equal(automatic.data.provider, 'large-google');
    const explicit = await upload('/api/files', 'telegram', 'owner', blob);
    assert.equal(explicit.status, 409, JSON.stringify(explicit));
    assert.match(explicit.data.error, /50 MB/);
    assert.equal(calls.telegram, 0);
  });
  for (const slow of ['token', 'folder']) {
    await check(`Google ${slow} preflight timeout permits fallback`, async () => {
      reset(); const config = service(slow === 'folder' ? 'slow-folder' : 'shared');
      if (slow === 'token') config.serviceAccountJson.token_uri = `${fakeBase}/slow-token`;
      seed(`slow-${slow}`, 'gdrive', config); seed('healthy', 'telegram', telegram, 100);
      const result = await upload('/api/files');
      assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(result.data.provider, 'healthy');
      assert.equal(calls.google, 0);
    });
  }
} finally {
  db?.close();
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  fake.closeAllConnections();
  await new Promise(resolve => fake.close(resolve));
  fs.rmSync(kerja, { recursive: true, force: true });
}
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) { console.error(logs); process.exitCode = 1; }
