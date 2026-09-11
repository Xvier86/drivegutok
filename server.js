import express from 'express';
import multer from 'multer';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const startedAt = Date.now();
const dataDir = path.join(root, 'data');
const storageDir = path.join(root, 'storage');
const tempDir = path.join(dataDir, 'tmp');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(storageDir, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });

const db = new Database(path.join(dataDir, 'mydrive.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL, deleted_at TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, folder_id TEXT, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, provider TEXT NOT NULL, remote_file_id TEXT, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL, deleted_at TEXT, cdn_slug TEXT UNIQUE, cdn_enabled INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, used_bytes INTEGER NOT NULL DEFAULT 0, capacity_bytes INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, file_id TEXT, folder_id TEXT, password_hash TEXT, expires_at TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(owner_id, parent_id);
  CREATE INDEX IF NOT EXISTS idx_files_folder ON files(owner_id, folder_id);
  INSERT OR IGNORE INTO providers (id, name, kind, enabled, used_bytes, capacity_bytes) VALUES ('telegram', 'Telegram Channel', 'telegram', 0, 0, 214748364800);
  INSERT OR IGNORE INTO providers (id, name, kind, enabled, used_bytes, capacity_bytes) VALUES ('mega', 'Mega Drive', 'mega', 0, 0, 2147483648000);
  INSERT OR IGNORE INTO providers (id, name, kind, enabled, used_bytes, capacity_bytes) VALUES ('gdrive', 'Google Drive', 'gdrive', 0, 0, 1610612736000);
`);
for (const statement of [
  "ALTER TABLE files ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE files ADD COLUMN retention_type TEXT NOT NULL DEFAULT 'forever'",
  "ALTER TABLE files ADD COLUMN retention_value INTEGER",
  "ALTER TABLE files ADD COLUMN expires_at TEXT"
]) { try { db.exec(statement); } catch (error) { if (!error.message.includes('duplicate column name')) throw error; } }
try { db.exec("ALTER TABLE providers ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'"); } catch (error) { if (!error.message.includes('duplicate column name')) throw error; }
db.prepare("UPDATE providers SET enabled = 0 WHERE kind = 'local'").run();

const app = express();
const port = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
const sessionTtl = 60 * 60 * 24 * 7;
const upload = multer({ dest: tempDir, limits: { fileSize: Number(process.env.MAX_FILE_SIZE || 5 * 1024 * 1024 * 1024) } });
const cdnUpload = multer({ dest: tempDir, limits: { fileSize: 5 * 1024 * 1024 } });
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const json = (res, data, status = 200) => res.status(status).json(data);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const safeName = (name) => path.basename(name).replace(/[^\w. -]/g, '_');
const cookieOptions = `Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const providerRequirements = {
  telegram: ['botToken'],
  mega: ['email', 'password'],
  gdrive: ['folderId']
};
const providerKinds = new Set(Object.keys(providerRequirements));
const configKey = crypto.createHash('sha256').update(process.env.STORAGE_CONFIG_KEY || 'change-this-storage-config-key').digest();
function encryptConfig(config) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', configKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return `enc:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}
function decryptConfig(value) {
  if (!value?.startsWith('enc:')) return JSON.parse(value || '{}');
  const [, ivValue, tagValue, encryptedValue] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', configKey, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8'));
}
function normalizeGoogleFolderId(value) {
  const text = String(value || '').trim();
  const match = text.match(/\/folders\/([^/?#]+)/);
  return match ? match[1] : text;
}
function normalizeProviderConfig(kind, config) {
  const normalized = { ...(config || {}) };
  if (kind === 'gdrive') normalized.folderId = normalizeGoogleFolderId(normalized.folderId);
  return normalized;
}
function retentionExpiry(type, value) {
  if (type === 'forever') return null;
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 1) return null;
  const expiry = new Date();
  if (type === 'months') expiry.setMonth(expiry.getMonth() + amount);
  else expiry.setDate(expiry.getDate() + amount);
  return expiry.toISOString();
}
async function encryptUpload(file) {
  const iv = crypto.randomBytes(16);
  const encryptedPath = path.join(tempDir, `${id()}.enc`);
  const cipher = crypto.createCipheriv('aes-256-ctr', configKey, iv);
  await pipeline(fs.createReadStream(file.path), cipher, fs.createWriteStream(encryptedPath));
  return { path: encryptedPath, size: fs.statSync(encryptedPath).size, iv: iv.toString('base64url') };
}
function providerStatus(provider) {
  let config = {};
  try { config = decryptConfig(provider.config_json); } catch {}
  const missing = (providerRequirements[provider.kind] || []).filter((key) => !config[key]);
  if (provider.kind === 'gdrive') {
    let account = null;
    try { account = typeof config.serviceAccountJson === 'string' ? JSON.parse(config.serviceAccountJson) : config.serviceAccountJson; } catch {}
    if (!account?.client_email || !account?.private_key || !account?.token_uri) missing.push('serviceAccountJson');
  }
  const { config_json: _config, ...safeProvider } = provider;
  return { ...safeProvider, configured: missing.length === 0, missing };
}
async function readProviderCapacity(provider) {
  const status = providerStatus(provider);
  if (!status.configured) return { usedBytes: provider.used_bytes, capacityBytes: provider.capacity_bytes, capacitySource: 'not-configured', capacityError: `Missing: ${status.missing.join(', ')}` };
  let config = {};
  try { config = decryptConfig(provider.config_json); } catch { return { usedBytes: provider.used_bytes, capacityBytes: provider.capacity_bytes, capacitySource: 'error', capacityError: 'Konfigurasi provider tidak dapat dibaca.' }; }
  if (provider.kind === 'telegram') {
    const usage = db.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM files WHERE provider = ? AND deleted_at IS NULL').get(provider.id).bytes;
    return { usedBytes: usage, capacityBytes: 0, capacitySource: 'telegram', capacityError: 'Telegram tidak menyediakan total kuota channel.' };
  }
  if (provider.kind === 'gdrive') {
    const accessToken = await getGoogleAccessToken(config);
    const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return { usedBytes: provider.used_bytes, capacityBytes: provider.capacity_bytes, capacitySource: 'error', capacityError: `Google Drive API ${response.status}` };
    const quota = (await response.json()).storageQuota || {};
    return { usedBytes: Number(quota.usage || 0), capacityBytes: Number(quota.limit || 0), capacitySource: 'google-drive' };
  }
  if (provider.kind === 'mega') {
    const { Storage } = await import('megajs');
    const storage = new Storage({ email: config.email, password: config.password });
    await new Promise((resolve, reject) => { storage.on('ready', resolve); storage.on('error', reject); });
    return { usedBytes: Number(storage.usedSpace || 0), capacityBytes: Number(storage.capacity || 0), capacitySource: 'mega' };
  }
  return { usedBytes: provider.used_bytes, capacityBytes: provider.capacity_bytes, capacitySource: 'manual' };
}
function base64Url(value) { return Buffer.from(value).toString('base64url'); }
async function getGoogleAccessToken(config) {
  if (config.accessToken && !config.accessToken.startsWith('AIza')) return config.accessToken;
  let account;
  try { account = typeof config.serviceAccountJson === 'string' ? JSON.parse(config.serviceAccountJson) : config.serviceAccountJson; } catch { throw new Error('serviceAccountJson Google tidak valid.'); }
  if (!account?.client_email || !account?.private_key || !account?.token_uri) throw new Error('Service account Google belum lengkap.');
  account.private_key = account.private_key.replace(/\\n/g, '\n');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: account.token_uri, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signer = crypto.createSign('RSA-SHA256'); signer.update(`${header}.${payload}`); signer.end();
  const assertion = `${header}.${payload}.${signer.sign(account.private_key, 'base64url')}`;
  const response = await fetch(account.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(result.error_description || `Google token API ${response.status}`);
  return result.access_token;
}
async function providerStatusWithCapacity(provider) {
  try {
    const capacity = await readProviderCapacity(provider);
    return { ...providerStatus(provider), used_bytes: capacity.usedBytes, capacity_bytes: capacity.capacityBytes, capacitySource: capacity.capacitySource, capacityError: capacity.capacityError || null };
  } catch (error) { return { ...providerStatus(provider), used_bytes: provider.used_bytes, capacity_bytes: provider.capacity_bytes, capacitySource: 'error', capacityError: error.message }; }
}
async function uploadToTelegram(file, config, name, mimeType) {
  const form = new FormData();
  const chatId = config.chatId || config.ownerId || process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('Telegram membutuhkan channel ID atau owner ID sebagai tujuan.');
  const chatResponse = await fetch(`https://api.telegram.org/bot${config.botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`);
  const chatResult = await chatResponse.json();
  if (!chatResponse.ok || !chatResult.ok) throw new Error(chatResult.description || 'Bot tidak bisa mengakses target Telegram. Untuk channel, jadikan bot admin; untuk owner ID, tekan Start pada bot.');
  form.append('chat_id', chatId);
  form.append('document', new Blob([fs.readFileSync(file.path)], { type: mimeType }), name);
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendDocument`, { method: 'POST', body: form });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API ${response.status}. Pastikan bot sudah menjadi admin channel atau user sudah memulai chat.`);
  return { remoteFileId: `telegram:${result.result.document.file_id}`, size: file.size };
}
async function uploadToGoogleDrive(file, config, name, mimeType) {
  config = normalizeProviderConfig('gdrive', config);
  const accessToken = await getGoogleAccessToken(config);
  const boundary = `gutok-${crypto.randomBytes(12).toString('hex')}`;
  const metadata = JSON.stringify({ name, mimeType, parents: [config.folderId] });
  const content = fs.readFileSync(file.path);
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`), content, Buffer.from(`\r\n--${boundary}--`)]);
  const folderCheck = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(config.folderId)}?fields=id,name,mimeType,driveId,capabilities&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const folderResult = await folderCheck.json();
  if (!folderCheck.ok || folderResult.mimeType !== 'application/vnd.google-apps.folder') throw new Error(folderResult.error?.message || 'Folder Google Drive tidak ditemukan atau belum dibagikan ke service account.');
  if (folderResult.capabilities?.canAddChildren === false) throw new Error('Service account hanya bisa membaca folder Google Drive. Beri akses Editor/Content manager pada folder atau Shared Drive.');
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,size', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  const result = await response.json();
  if (!response.ok || !result.id) throw new Error(result.error?.message || `Google Drive API ${response.status}. Service account memerlukan folder Shared Drive dengan akses Content manager.`);
  return { remoteFileId: `gdrive:${result.id}`, size: Number(result.size || file.size) };
}
async function uploadToMega(file, config, name) {
  const { Storage } = await import('megajs');
  const storage = new Storage({ email: config.email, password: config.password });
  await new Promise((resolve, reject) => { storage.on('ready', resolve); storage.on('error', reject); });
  const upload = storage.upload({ name, size: file.size });
  fs.createReadStream(file.path).pipe(upload);
  const remote = await new Promise((resolve, reject) => { upload.on('complete', resolve); upload.on('error', reject); });
  return { remoteFileId: `mega:${remote.nodeId || remote}`, size: file.size };
}
async function uploadToProvider(file, provider, name, mimeType) {
  const config = decryptConfig(provider.config_json);
  if (provider.kind === 'telegram') return uploadToTelegram(file, config, name, mimeType);
  if (provider.kind === 'gdrive') return uploadToGoogleDrive(file, config, name, mimeType);
  if (provider.kind === 'mega') return uploadToMega(file, config, name);
  throw new Error(`Provider ${provider.kind} belum didukung.`);
}
async function sendRemoteFile(res, file, provider) {
  const config = decryptConfig(provider.config_json);
  const encryptedMatch = file.remote_file_id.match(/^enc:([^:]+):(.+)$/);
  const remoteFileId = encryptedMatch ? encryptedMatch[2] : file.remote_file_id;
  let response;
  if (provider.kind === 'telegram') {
    const fileId = remoteFileId.replace('telegram:', '');
    const info = await fetch(`https://api.telegram.org/bot${config.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`).then((result) => result.json());
    if (!info.ok) throw new Error(info.description || 'Telegram file tidak ditemukan.');
    response = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${info.result.file_path}`);
  } else if (provider.kind === 'gdrive') {
    const fileId = remoteFileId.replace('gdrive:', '');
    response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${await getGoogleAccessToken(config)}` } });
  } else { throw new Error('Download Mega belum tersedia.'); }
  if (!response.ok || !response.body) throw new Error(`Provider ${provider.kind} mengembalikan HTTP ${response.status}`);
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Length', file.size);
  res.setHeader('Content-Disposition', `inline; filename="${safeName(file.name)}"`);
  const remoteStream = Readable.fromWeb(response.body);
  if (encryptedMatch) {
    const decipher = crypto.createDecipheriv('aes-256-ctr', configKey, Buffer.from(encryptedMatch[1], 'base64url'));
    return remoteStream.pipe(decipher).pipe(res);
  }
  return remoteStream.pipe(res);
}
async function verifyGoogleProvider(config) {
  config = normalizeProviderConfig('gdrive', config);
  const accessToken = await getGoogleAccessToken(config);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(config.folderId)}?fields=id,name,mimeType,driveId,capabilities&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `Google Drive API ${response.status}`);
  if (result.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Link tersebut bukan folder Google Drive.');
  if (result.capabilities?.canAddChildren === false) throw new Error('Service account tidak memiliki hak membuat file di folder ini. Beri akses Editor.');
  return result;
}

app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (/\.(env|sqlite|sqlite3|db|pem|key|log)$/i.test(req.path) || /(^|\/)(server\.js|package-lock\.json|wrangler\.toml|ecosystem\.config\.cjs)(\/|$)/i.test(req.path)) return res.status(404).end();
  return next();
});
app.use(express.static(path.join(root, 'assets')));

function currentUser(req) {
  const token = req.headers.cookie?.match(/mydrive_session=([^;]+)/)?.[1];
  if (!token) return null;
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?').get(token, now());
  return session ? db.prepare("SELECT id, email, username, role, status FROM users WHERE id = ? AND status = 'active'").get(session.user_id) : null;
}
function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return json(res, { error: 'Unauthorized' }, 401);
  req.user = user;
  return next();
}
function ownerOnly(req, res, next) {
  if (req.user.role !== 'owner') return json(res, { error: 'Forbidden' }, 403);
  return next();
}
function audit(actorId, action, targetType, targetId = null) {
  db.prepare('INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id(), actorId, action, targetType, targetId, now());
}

app.get('/api/setup', (_req, res) => json(res, { needsSetup: db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0 }));
app.post('/api/setup', (req, res) => {
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0) return json(res, { error: 'Owner sudah dibuat.' }, 409);
  const { email, username, password } = req.body;
  if (!email || !username || !password || password.length < 8) return json(res, { error: 'Email, username, dan password minimal 8 karakter wajib diisi.' }, 400);
  const user = { id: id(), email: email.trim().toLowerCase(), username: username.trim(), role: 'owner', status: 'active', created_at: now() };
  try { db.prepare('INSERT INTO users (id, email, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, user.email, user.username, hash(password), user.role, user.status, user.created_at); return json(res, { user }, 201); }
  catch { return json(res, { error: 'Email atau username sudah digunakan.' }, 409); }
});
app.post('/api/login', (req, res) => {
  const identity = req.body.identity?.trim() || '';
  const user = db.prepare("SELECT * FROM users WHERE (email = ? OR username = ?) AND status = 'active'").get(identity.toLowerCase(), identity);
  if (!user || user.password_hash !== hash(req.body.password || '')) return json(res, { error: 'Identitas atau password salah.' }, 401);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(token, user.id, new Date(Date.now() + sessionTtl * 1000).toISOString());
  res.setHeader('Set-Cookie', `mydrive_session=${token}; Max-Age=${sessionTtl}; ${cookieOptions}`);
  return json(res, { user: { id: user.id, email: user.email, username: user.username, role: user.role } });
});
app.post('/api/logout', (req, res) => { const token = req.headers.cookie?.match(/mydrive_session=([^;]+)/)?.[1]; if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token); res.setHeader('Set-Cookie', `mydrive_session=; Max-Age=0; ${cookieOptions}`); return res.status(204).end(); });

app.get('/api/me', requireUser, (req, res) => json(res, { user: req.user }));
app.get('/api/dashboard', requireUser, (req, res) => {
  const folderId = req.query.folderId || null;
  const folders = db.prepare('SELECT id, name, parent_id, created_at FROM folders WHERE owner_id = ? AND parent_id IS ? AND deleted_at IS NULL ORDER BY name').all(req.user.id, folderId);
  const files = db.prepare("SELECT id, name, mime_type, size, provider, uploaded_by, uploaded_at, cdn_enabled, cdn_slug, encrypted, retention_type, retention_value, expires_at FROM files WHERE owner_id = ? AND folder_id IS ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY uploaded_at DESC").all(req.user.id, folderId, now());
  const providers = db.prepare("SELECT id, name, kind, enabled, used_bytes, capacity_bytes FROM providers WHERE kind != 'local' ORDER BY name").all();
  const stats = db.prepare("SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM files WHERE owner_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)").get(req.user.id, now());
  return json(res, { folders, files, providers, stats, folderId, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) });
});
app.post('/api/folders', requireUser, (req, res) => { if (!req.body.name?.trim()) return json(res, { error: 'Nama folder wajib diisi.' }, 400); const folder = { id: id(), name: req.body.name.trim(), parent_id: req.body.parentId || null, owner_id: req.user.id, created_at: now() }; db.prepare('INSERT INTO folders (id, owner_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)').run(folder.id, folder.owner_id, folder.parent_id, folder.name, folder.created_at); audit(req.user.id, 'create', 'folder', folder.id); return json(res, folder, 201); });
app.patch('/api/folders/:id', requireUser, (req, res) => {
  const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id);
  if (!folder) return json(res, { error: 'Folder tidak ditemukan.' }, 404);
  if (!req.body.name?.trim() && req.body.parentId === undefined) return json(res, { error: 'Nama atau folder tujuan wajib diisi.' }, 400);
  if (req.body.name?.trim()) db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(req.body.name.trim(), folder.id);
  if (req.body.parentId !== undefined) db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(req.body.parentId || null, folder.id);
  audit(req.user.id, 'update', 'folder', folder.id);
  return json(res, { ok: true });
});
app.delete('/api/folders/:id', requireUser, (req, res) => {
  const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id);
  if (!folder) return res.status(404).end();
  const deletedAt = now();
  const files = db.prepare("SELECT files.id, files.size, files.provider, files.remote_file_id FROM files WHERE files.owner_id = ? AND files.folder_id IN (WITH RECURSIVE tree(id) AS (SELECT id FROM folders WHERE id = ? UNION ALL SELECT folders.id FROM folders JOIN tree ON folders.parent_id = tree.id) SELECT id FROM tree) AND files.deleted_at IS NULL").all(req.user.id, folder.id);
  for (const file of files) {
    db.prepare('UPDATE providers SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?').run(file.size, file.provider);
    if (file.remote_file_id) fs.rmSync(path.join(storageDir, file.remote_file_id), { force: true });
  }
  db.prepare("UPDATE folders SET deleted_at = ? WHERE owner_id = ? AND (id = ? OR id IN (WITH RECURSIVE tree(id) AS (SELECT id FROM folders WHERE id = ? UNION ALL SELECT folders.id FROM folders JOIN tree ON folders.parent_id = tree.id) SELECT id FROM tree))").run(deletedAt, req.user.id, folder.id, folder.id);
  db.prepare('UPDATE files SET deleted_at = ? WHERE owner_id = ? AND folder_id IN (SELECT id FROM folders WHERE owner_id = ? AND deleted_at = ?)').run(deletedAt, req.user.id, req.user.id, deletedAt);
  audit(req.user.id, 'delete', 'folder', folder.id);
  return res.status(204).end();
});

app.post('/api/files', requireUser, upload.single('file'), async (req, res) => {
  const file = req.file;
  const name = req.body.name || file?.originalname;
  const mimeType = req.body.mimeType || file?.mimetype || 'application/octet-stream';
  const retentionType = req.body.retentionType === 'days' || req.body.retentionType === 'months' ? req.body.retentionType : 'forever';
  const retentionValue = retentionType === 'forever' ? null : Number(req.body.retentionValue);
  const expiresAt = retentionExpiry(retentionType, retentionValue);
  const encrypted = req.user.role === 'owner' && req.body.encrypt === 'true';
  if (!name) { if (file) fs.rmSync(file.path, { force: true }); return json(res, { error: 'File wajib dipilih.' }, 400); }
  const requestedProvider = req.user.role === 'owner' ? String(req.body.providerId || '') : '';
  const provider = requestedProvider ? db.prepare("SELECT id, kind, capacity_bytes, used_bytes, config_json FROM providers WHERE id = ? AND kind != 'local' AND enabled = 1").get(requestedProvider) : db.prepare("SELECT id, kind, capacity_bytes, used_bytes, config_json FROM providers WHERE kind != 'local' AND enabled = 1 ORDER BY used_bytes ASC LIMIT 1").get();
  if (!provider) { if (file) fs.rmSync(file.path, { force: true }); return json(res, { error: 'Belum ada provider remote yang aktif dan terkonfigurasi.' }, 409); }
  if (!providerStatus(provider).configured) { if (file) fs.rmSync(file.path, { force: true }); return json(res, { error: 'Provider aktif belum memiliki konfigurasi lengkap.' }, 409); }
  if (!file) return json(res, { error: 'File wajib dipilih.' }, 400);
  let uploadFile = file;
  if (encrypted) uploadFile = await encryptUpload(file);
  const size = uploadFile.size;
  if (provider.capacity_bytes > 0 && provider.used_bytes + size > provider.capacity_bytes) { fs.rmSync(file.path, { force: true }); return json(res, { error: 'Kapasitas provider tidak mencukupi.' }, 409); }
  try {
    const uploaded = await uploadToProvider(uploadFile, provider, safeName(name), mimeType);
    const fileId = id();
    const remoteFileId = encrypted ? `enc:${uploadFile.iv}:${uploaded.remoteFileId}` : uploaded.remoteFileId;
    const record = { id: fileId, owner_id: req.user.id, folder_id: req.body.folderId || null, name: safeName(name), mime_type: mimeType, size: uploaded.size, provider: provider.id, remote_file_id: remoteFileId, uploaded_by: req.user.id, uploaded_at: now(), cdn_enabled: /^(image|video)\//.test(mimeType) ? 1 : 0, cdn_slug: /^(image|video)\//.test(mimeType) ? crypto.randomBytes(18).toString('hex') : null, encrypted: encrypted ? 1 : 0, retention_type: retentionType, retention_value: retentionValue, expires_at: expiresAt };
    db.prepare('INSERT INTO files (id, owner_id, folder_id, name, mime_type, size, provider, remote_file_id, uploaded_by, uploaded_at, cdn_enabled, cdn_slug, encrypted, retention_type, retention_value, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.owner_id, record.folder_id, record.name, record.mime_type, record.size, record.provider, record.remote_file_id, record.uploaded_by, record.uploaded_at, record.cdn_enabled, record.cdn_slug, record.encrypted, record.retention_type, record.retention_value, record.expires_at);
    db.prepare('UPDATE providers SET used_bytes = used_bytes + ? WHERE id = ?').run(record.size, provider.id); audit(req.user.id, 'upload', 'file', record.id); return json(res, record, 201);
  } catch (error) { return json(res, { error: `Upload ${provider.kind} gagal: ${error.message}` }, 502); }
  finally { fs.rmSync(file.path, { force: true }); if (uploadFile !== file) fs.rmSync(uploadFile.path, { force: true }); }
});
app.post('/api/files/cdn', requireUser, (req, res, next) => cdnUpload.single('file')(req, res, (error) => error ? json(res, { error: 'File CDN maksimal 5 MB.' }, 413) : next()), async (req, res) => {
  const file = req.file;
  const name = file?.originalname;
  const mimeType = file?.mimetype || '';
  const retentionType = req.body.retentionType === 'days' || req.body.retentionType === 'months' ? req.body.retentionType : 'forever';
  const retentionValue = retentionType === 'forever' ? null : Number(req.body.retentionValue);
  const expiresAt = retentionExpiry(retentionType, retentionValue);
  if (!file || !name || !/^(image|video)\//.test(mimeType)) { if (file) fs.rmSync(file.path, { force: true }); return json(res, { error: 'Upload CDN hanya menerima gambar atau video maksimal 5 MB.' }, 400); }
  const requestedProvider = req.user.role === 'owner' ? String(req.body.providerId || '') : '';
  const provider = requestedProvider ? db.prepare("SELECT id, kind, capacity_bytes, used_bytes, config_json FROM providers WHERE id = ? AND kind != 'local' AND enabled = 1").get(requestedProvider) : db.prepare("SELECT id, kind, capacity_bytes, used_bytes, config_json FROM providers WHERE kind != 'local' AND enabled = 1 ORDER BY used_bytes ASC LIMIT 1").get();
  if (!provider || !providerStatus(provider).configured) { fs.rmSync(file.path, { force: true }); return json(res, { error: 'Aktifkan provider storage terlebih dahulu.' }, 409); }
  if (provider.capacity_bytes > 0 && provider.used_bytes + file.size > provider.capacity_bytes) { fs.rmSync(file.path, { force: true }); return json(res, { error: 'Kapasitas provider tidak mencukupi.' }, 409); }
  try {
    const uploaded = await uploadToProvider(file, provider, safeName(name), mimeType);
    const record = { id: id(), owner_id: req.user.id, folder_id: req.body.folderId || null, name: safeName(name), mime_type: mimeType, size: uploaded.size, provider: provider.id, remote_file_id: uploaded.remoteFileId, uploaded_by: req.user.id, uploaded_at: now(), cdn_enabled: 1, cdn_slug: crypto.randomBytes(18).toString('hex'), encrypted: 0, retention_type: retentionType, retention_value: retentionValue, expires_at: expiresAt };
    db.prepare('INSERT INTO files (id, owner_id, folder_id, name, mime_type, size, provider, remote_file_id, uploaded_by, uploaded_at, cdn_enabled, cdn_slug, encrypted, retention_type, retention_value, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.owner_id, record.folder_id, record.name, record.mime_type, record.size, record.provider, record.remote_file_id, record.uploaded_by, record.uploaded_at, record.cdn_enabled, record.cdn_slug, record.encrypted, record.retention_type, record.retention_value, record.expires_at);
    db.prepare('UPDATE providers SET used_bytes = used_bytes + ? WHERE id = ?').run(record.size, provider.id); audit(req.user.id, 'upload_cdn', 'file', record.id); return json(res, { ...record, cdnUrl: `/cdn/${record.cdn_slug}` }, 201);
  } catch (error) { return json(res, { error: `Upload CDN gagal: ${error.message}` }, 502); }
  finally { fs.rmSync(file.path, { force: true }); }
});
app.get('/api/files/:id/download', requireUser, async (req, res) => { const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id); const provider = file && db.prepare('SELECT * FROM providers WHERE id = ?').get(file.provider); if (!file?.remote_file_id || !provider) return json(res, { error: 'File tidak ditemukan.' }, 404); try { return await sendRemoteFile(res, file, provider); } catch (error) { return json(res, { error: error.message }, 502); } });
app.patch('/api/files/:id', requireUser, (req, res) => { const file = db.prepare('SELECT id FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id); if (!file) return json(res, { error: 'File tidak ditemukan.' }, 404); if (!req.body.name?.trim()) return json(res, { error: 'Nama file wajib diisi.' }, 400); db.prepare('UPDATE files SET name = ? WHERE id = ?').run(safeName(req.body.name.trim()), file.id); audit(req.user.id, 'rename', 'file', file.id); return json(res, { ok: true }); });
app.delete('/api/files/:id', requireUser, (req, res) => { const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id); if (!file) return res.status(404).end(); db.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').run(now(), file.id); db.prepare('UPDATE providers SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?').run(file.size, file.provider); if (file.remote_file_id) fs.rmSync(path.join(storageDir, file.remote_file_id), { force: true }); audit(req.user.id, 'delete', 'file', file.id); return res.status(204).end(); });
app.post('/api/files/:id/share', requireUser, (req, res) => {
  const file = db.prepare('SELECT id, name, mime_type FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id);
  if (!file) return json(res, { error: 'File tidak ditemukan.' }, 404);
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt).toISOString() : null;
  db.prepare('INSERT INTO shares (token, file_id, password_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(token, file.id, req.body.password ? hash(req.body.password) : null, expiresAt, now());
  audit(req.user.id, 'share', 'file', file.id);
  return json(res, { token, url: `${req.protocol}://${req.get('host')}/s/${token}`, expiresAt });
});
app.get('/api/shares/:token', (req, res) => {
  const share = db.prepare('SELECT shares.*, files.name, files.mime_type, files.remote_file_id FROM shares JOIN files ON files.id = shares.file_id WHERE shares.token = ? AND files.deleted_at IS NULL').get(req.params.token);
  if (!share || (share.expires_at && share.expires_at <= now())) return json(res, { error: 'Link share tidak berlaku.' }, 404);
  if (share.password_hash && share.password_hash !== hash(req.query.password || '')) return json(res, { error: 'Password share salah atau belum diisi.' }, 401);
  return json(res, { name: share.name, mimeType: share.mime_type, downloadUrl: `/s/${share.token}/download` });
});
app.get('/s/:token/download', (req, res) => {
  const share = db.prepare('SELECT shares.*, files.name, files.remote_file_id FROM shares JOIN files ON files.id = shares.file_id WHERE shares.token = ? AND files.deleted_at IS NULL').get(req.params.token);
  if (!share || (share.expires_at && share.expires_at <= now()) || (share.password_hash && share.password_hash !== hash(req.query.password || ''))) return res.status(404).end();
  return res.download(path.join(storageDir, share.remote_file_id), share.name);
});
app.get('/cdn/:slug', async (req, res) => { const file = db.prepare('SELECT * FROM files WHERE cdn_slug = ? AND cdn_enabled = 1 AND deleted_at IS NULL').get(req.params.slug); const provider = file && db.prepare('SELECT * FROM providers WHERE id = ?').get(file.provider); if (!file?.remote_file_id || !provider) return res.status(404).end(); res.setHeader('Cache-Control', 'public, max-age=86400, immutable'); try { return await sendRemoteFile(res, file, provider); } catch { return res.status(502).end(); } });

app.get('/api/admin/overview', requireUser, ownerOnly, async (_req, res) => {
  const providers = await Promise.all(db.prepare("SELECT * FROM providers WHERE kind != 'local' ORDER BY name").all().map(providerStatusWithCapacity));
  return json(res, { users: db.prepare('SELECT id, email, username, role, status, created_at FROM users ORDER BY created_at DESC').all(), files: db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM files WHERE deleted_at IS NULL').get(), providers, logs: db.prepare('SELECT audit_logs.*, users.username FROM audit_logs JOIN users ON users.id = audit_logs.actor_id ORDER BY audit_logs.created_at DESC LIMIT 8').all() });
});
app.post('/api/admin/users', requireUser, ownerOnly, (req, res) => { const { email, username, password } = req.body; if (!email || !username || !password || password.length < 8) return json(res, { error: 'Data invite belum lengkap.' }, 400); const user = { id: id(), email: email.trim().toLowerCase(), username: username.trim(), role: 'user', status: 'active', created_at: now() }; try { db.prepare('INSERT INTO users (id, email, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, user.email, user.username, hash(password), user.role, user.status, user.created_at); audit(req.user.id, 'invite', 'user', user.id); return json(res, user, 201); } catch { return json(res, { error: 'Email atau username sudah digunakan.' }, 409); } });
app.post('/api/admin/providers', requireUser, ownerOnly, (req, res) => {
  const kind = String(req.body.kind || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const capacityBytes = Number(req.body.capacityBytes);
  if (!providerKinds.has(kind) || !name || !Number.isFinite(capacityBytes) || capacityBytes < 0) return json(res, { error: 'Nama, jenis provider, dan kapasitas storage wajib valid.' }, 400);
  const config = normalizeProviderConfig(kind, req.body.config && typeof req.body.config === 'object' ? req.body.config : {});
  const provider = { id: id(), name, kind, enabled: 0, used_bytes: 0, capacity_bytes: Math.floor(capacityBytes), config_json: encryptConfig(config) };
  db.prepare('INSERT INTO providers (id, name, kind, enabled, used_bytes, capacity_bytes, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(provider.id, provider.name, provider.kind, provider.enabled, provider.used_bytes, provider.capacity_bytes, provider.config_json);
  audit(req.user.id, 'create', 'provider', provider.id);
  return json(res, providerStatus(provider), 201);
});
app.patch('/api/admin/providers/:id', requireUser, ownerOnly, async (req, res) => {
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  if (!provider) return json(res, { error: 'Provider tidak ditemukan.' }, 404);
  if (req.body.config && typeof req.body.config === 'object') {
    const config = normalizeProviderConfig(provider.kind, req.body.config);
    db.prepare('UPDATE providers SET config_json = ? WHERE id = ?').run(encryptConfig(config), provider.id);
    provider.config_json = encryptConfig(config);
  }
  if (req.body.enabled && !providerStatus(provider).configured) return json(res, { error: `Provider belum siap. Isi: ${providerStatus(provider).missing.join(', ')}` }, 409);
  if (req.body.enabled && provider.kind === 'gdrive') {
    try { await verifyGoogleProvider(decryptConfig(provider.config_json)); }
    catch (error) { return json(res, { error: `Google Drive belum bisa diaktifkan: ${error.message}` }, 409); }
  }
  db.prepare('UPDATE providers SET enabled = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, provider.id);
  audit(req.user.id, req.body.enabled ? 'enable' : 'disable', 'provider', provider.id);
  return json(res, { ok: true });
});

app.get('/*splat', (req, res) => { if (req.path.startsWith('/api/')) return json(res, { error: 'Not found' }, 404); return res.sendFile(path.join(root, 'assets', 'index.html')); });
app.listen(port, () => console.log(`MyDrive berjalan di http://127.0.0.1:${port}`));