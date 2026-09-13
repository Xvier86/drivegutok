// Hapus PERMANEN semua file dari provider remote (Telegram / Mega / Google Drive), lalu
// kosongkan tabel files/folders dan reset used_bytes provider ke 0.
//
// Jalankan dari root project:
//   STORAGE_CONFIG_KEY='secret-yang-sama-dengan-.env' node cleanup.js
//
// Catatan ESM: package.json memakai "type": "module", jadi file ini memakai import.
// Kalau dijalankan sebagai CommonJS akan error "require is not defined in ES module scope".
import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(root, 'data', 'mydrive.sqlite'));

// Harus sama persis dengan default di server.js, kalau tidak config provider gagal didekrip.
const KEY_DEFAULT = 'change-this-storage-config-key';

if (!process.env.STORAGE_CONFIG_KEY) {
  console.warn('PERINGATAN: STORAGE_CONFIG_KEY tidak diisi, memakai key default. Konfigurasi provider yang tersimpan kemungkinan gagal didekripsi.');
}
const configKey = crypto.createHash('sha256').update(process.env.STORAGE_CONFIG_KEY || KEY_DEFAULT).digest();

// config_json disimpan sebagai "enc:iv:tag:data" (aes-256-gcm) atau JSON biasa untuk data lama.
function decryptConfig(value) {
  if (!value?.startsWith('enc:')) return JSON.parse(value || '{}');
  const [, ivValue, tagValue, encryptedValue] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', configKey, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8'));
}

// remote_file_id yang dienkripsi berbentuk "enc:<iv>:<id-asli>".
function remoteIdDari(file) {
  const cocok = file.remote_file_id?.match(/^enc:([^:]+):(.+)$/);
  return cocok ? cocok[2] : file.remote_file_id;
}

const base64Url = (value) => Buffer.from(value).toString('base64url');

async function tokenGoogle(config) {
  const account = typeof config.serviceAccountJson === 'string' ? JSON.parse(config.serviceAccountJson) : config.serviceAccountJson;
  account.private_key = account.private_key.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: account.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const assertion = `${header}.${payload}.${signer.sign(account.private_key, 'base64url')}`;
  const response = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(result.error_description || `Google token API ${response.status}`);
  return result.access_token;
}

const hapusDiProvider = {
  async telegram(remoteFileId, config) {
    // Bentuk id: telegram:<chatId>:<messageId>:<fileId>. Record lama tanpa message_id dilewati.
    const parts = remoteFileId.split(':');
    if (parts.length < 4) return;
    const [, chatId, messageId] = parts;
    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/deleteMessage?chat_id=${encodeURIComponent(chatId)}&message_id=${encodeURIComponent(messageId)}`);
    const result = await response.json();
    // "message can't be deleted" = pesan lebih tua dari 48 jam: Bot API Telegram melarang bot
    // menghapusnya dan percobaan ulang pun sama, jadi dilewati — bukan dihitung gagal.
    if (!result.ok && !/message to delete not found|can't be deleted/i.test(result.description || '')) {
      throw new Error(result.description || `Telegram HTTP ${response.status}`);
    }
  },

  async gdrive(remoteFileId, config) {
    const fileId = remoteFileId.replace('gdrive:', '');
    const accessToken = await tokenGoogle(config);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok && response.status !== 404) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error?.message || `Google Drive HTTP ${response.status}`);
    }
  },

  async mega(remoteFileId, config) {
    const nodeId = remoteFileId.replace('mega:', '');
    const { Storage } = await import('megajs');
    const storage = new Storage({ email: config.email, password: config.password });
    // Sama seperti server.js: megajs hanya menolak promise storage.ready saat login gagal (tidak
    // mengirim event 'error'), jadi menunggu event saja akan menggantung tanpa pesan apa pun.
    await storage.ready;
    try {
      const node = storage.files?.[nodeId] || Object.values(storage.files || {}).find((entry) => entry.nodeId === nodeId);
      if (!node) return;
      await new Promise((resolve, reject) => node.delete(true, (error) => error ? reject(error) : resolve()));
    } finally {
      storage.close?.();
    }
  },
};

async function hapusRemote(file, provider) {
  if (!file.remote_file_id || !provider) return;
  const remoteFileId = remoteIdDari(file);
  const config = decryptConfig(provider.config_json);
  const hapus = hapusDiProvider[provider.kind];
  if (!hapus) return;
  await hapus(remoteFileId, config);
}

async function main() {
  const files = db.prepare('SELECT * FROM files WHERE deleted_at IS NULL').all();
  const providers = new Map(db.prepare('SELECT * FROM providers').all().map((provider) => [provider.id, provider]));
  let deleted = 0;
  let failed = 0;

  for (const file of files) {
    try {
      await hapusRemote(file, providers.get(file.provider));
      deleted++;
    } catch (error) {
      failed++;
      console.error(`Gagal hapus "${file.name}" (${file.provider}): ${error.message}`);
    }
  }

  const now = new Date().toISOString();
  const folders = db.prepare('UPDATE folders SET deleted_at = ? WHERE deleted_at IS NULL').run(now);
  db.prepare('UPDATE files SET deleted_at = ? WHERE deleted_at IS NULL').run(now);
  db.prepare('UPDATE providers SET used_bytes = 0').run();

  console.log(`Selesai. ${deleted} file berhasil dihapus permanen dari provider remote, ${failed} gagal (lihat log di atas). ${folders.changes} folder ditandai terhapus. Angka pemakaian provider direset ke 0.`);
  if (failed > 0) {
    console.log('File yang gagal dihapus dari provider TETAP tersimpan aman di sana — cek pesan error di atas dan/atau hapus manual dari dashboard provider terkait (mis. bot masih admin channel, kredensial masih valid).');
  }
}

main();
