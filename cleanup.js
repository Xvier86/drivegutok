// Jalankan dari root folder project (~/drivegutok), pakai:
//   STORAGE_CONFIG_KEY='secret-yang-sama-dengan-.env' node cleanup.js
//
// Script ini BENAR-BENAR menghapus semua file dari provider remote (Telegram / Mega / Google Drive)
// yang terdaftar aktif di database, baru kemudian mengosongkan tabel files/folders dan mereset
// used_bytes provider ke 0. Sebelumnya script ini hanya soft-delete di database sehingga file
// fisik tetap tersisa di provider — itu sudah diperbaiki di sini.
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, 'data', 'mydrive.sqlite'));

const configKey = crypto.createHash('sha256').update(process.env.STORAGE_CONFIG_KEY || 'change-this-storage-config-key').digest();
function decryptConfig(value) {
  if (!value?.startsWith('enc:')) return JSON.parse(value || '{}');
  const [, ivValue, tagValue, encryptedValue] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', configKey, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8'));
}

async function getGoogleAccessToken(config) {
  const account = typeof config.serviceAccountJson === 'string' ? JSON.parse(config.serviceAccountJson) : config.serviceAccountJson;
  account.private_key = account.private_key.replace(/\\n/g, '\n');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const base64Url = (value) => Buffer.from(value).toString('base64url');
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: account.token_uri, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signer = crypto.createSign('RSA-SHA256'); signer.update(`${header}.${payload}`); signer.end();
  const assertion = `${header}.${payload}.${signer.sign(account.private_key, 'base64url')}`;
  const response = await fetch(account.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(result.error_description || `Google token API ${response.status}`);
  return result.access_token;
}

async function deleteFromTelegram(remoteFileId, config) {
  const parts = remoteFileId.split(':');
  if (parts.length < 4) return; // record lama tanpa message_id, tidak bisa dihapus permanen dari channel
  const [, chatId, messageId] = parts;
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/deleteMessage?chat_id=${encodeURIComponent(chatId)}&message_id=${encodeURIComponent(messageId)}`);
  const result = await response.json();
  if (!result.ok && !/message to delete not found/i.test(result.description || '')) throw new Error(result.description || `Telegram HTTP ${response.status}`);
}
async function deleteFromGoogleDrive(remoteFileId, config) {
  const fileId = remoteFileId.replace('gdrive:', '');
  const accessToken = await getGoogleAccessToken(config);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok && response.status !== 404) { const result = await response.json().catch(() => ({})); throw new Error(result.error?.message || `Google Drive HTTP ${response.status}`); }
}
async function deleteFromMega(remoteFileId, config) {
  const nodeId = remoteFileId.replace('mega:', '');
  const { Storage } = require('megajs');
  const storage = new Storage({ email: config.email, password: config.password });
  await new Promise((resolve, reject) => { storage.on('ready', resolve); storage.on('error', reject); });
  try {
    const node = storage.files?.[nodeId] || Object.values(storage.files || {}).find((entry) => entry.nodeId === nodeId);
    if (!node) return;
    await new Promise((resolve, reject) => node.delete(true, (error) => error ? reject(error) : resolve()));
  } finally { storage.close?.(); }
}
async function deleteRemoteFile(file, provider) {
  if (!file.remote_file_id || !provider) return;
  const encryptedMatch = file.remote_file_id.match(/^enc:([^:]+):(.+)$/);
  const remoteFileId = encryptedMatch ? encryptedMatch[2] : file.remote_file_id;
  const config = decryptConfig(provider.config_json);
  if (provider.kind === 'telegram') return deleteFromTelegram(remoteFileId, config);
  if (provider.kind === 'gdrive') return deleteFromGoogleDrive(remoteFileId, config);
  if (provider.kind === 'mega') return deleteFromMega(remoteFileId, config);
}

(async () => {
  const files = db.prepare("SELECT * FROM files WHERE deleted_at IS NULL").all();
  const providers = new Map(db.prepare("SELECT * FROM providers").all().map((provider) => [provider.id, provider]));
  let deleted = 0;
  let failed = 0;
  for (const file of files) {
    try {
      await deleteRemoteFile(file, providers.get(file.provider));
      deleted++;
    } catch (error) {
      failed++;
      console.error(`Gagal hapus "${file.name}" (${file.provider}): ${error.message}`);
    }
  }
  const folders = db.prepare("UPDATE folders SET deleted_at = ? WHERE deleted_at IS NULL").run(new Date().toISOString());
  db.prepare("UPDATE files SET deleted_at = ? WHERE deleted_at IS NULL").run(new Date().toISOString());
  db.prepare("UPDATE providers SET used_bytes = 0").run();

  console.log(`Selesai. ${deleted} file berhasil dihapus permanen dari provider remote, ${failed} gagal (lihat log di atas). ${folders.changes} folder ditandai terhapus. Angka pemakaian provider direset ke 0.`);
  if (failed > 0) console.log('File yang gagal dihapus dari provider TETAP tersimpan aman di sana — cek pesan error di atas dan/atau hapus manual dari dashboard provider terkait (mis. bot masih admin channel, kredensial masih valid).');
})();
