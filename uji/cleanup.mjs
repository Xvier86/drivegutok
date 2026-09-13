// Uji cepat cleanup.js tanpa menyentuh data asli dan tanpa jaringan.
// Jalankan dari mana pun: node uji/cleanup.mjs
//
// Cara kerja: cleanup.js dan skema SQLite minimal disalin ke folder sementara (node_modules
// di-symlink), lalu:
//   - 2 file dianggap berhasil (provider tidak dikenal / remote_file_id kosong),
//   - 1 file sengaja gagal (config_json bukan JSON valid -> decryptConfig melempar error),
//   - 1 folder lama ikut ditandai terhapus, used_bytes provider direset ke 0.
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-cleanup-'));
const gagal = [];

fs.mkdirSync(path.join(kerja, 'data'));
fs.copyFileSync(path.join(root, 'cleanup.js'), path.join(kerja, 'cleanup.js'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(kerja, 'package.json'));

const dbPath = path.join(kerja, 'data', 'mydrive.sqlite');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE providers (id INTEGER PRIMARY KEY, kind TEXT, config_json TEXT, used_bytes INTEGER);
  CREATE TABLE folders (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
  CREATE TABLE files (id INTEGER PRIMARY KEY, name TEXT, provider INTEGER, remote_file_id TEXT, deleted_at TEXT);
  INSERT INTO providers (id, kind, config_json, used_bytes) VALUES (1, 'tidak-dikenal', '{}', 999), (2, 'gdrive', 'bukan-json{', 5);
  INSERT INTO folders (id, name, deleted_at) VALUES (1, 'lama', NULL);
  INSERT INTO files (id, name, provider, remote_file_id, deleted_at) VALUES
    (1, 'tanpa-remote-id', 1, NULL, NULL),
    (2, 'provider-tak-ada', 99, 'telegram:1:2:3', NULL),
    (3, 'config-rusak', 2, 'gdrive:abc', NULL);
`);
db.close();

const hasil = spawnSync('node', ['cleanup.js'], {
  cwd: kerja,
  encoding: 'utf8',
  env: { ...process.env, STORAGE_CONFIG_KEY: 'secret-uji-cleanup' },
});
const keluaran = `${hasil.stdout}${hasil.stderr}`;

const cek = (nama, benar, detail = '') => {
  if (benar) {
    console.log(`  [OK]    ${nama}`);
  } else {
    gagal.push(nama);
    console.log(`  [GAGAL] ${nama} ${detail}`);
  }
};

cek('exit 0', hasil.status === 0, `(exit ${hasil.status})`);
cek('ringkasan 2 berhasil, 1 gagal', /2 file berhasil dihapus permanen dari provider remote, 1 gagal/.test(keluaran));
cek('1 folder ditandai terhapus', /1 folder ditandai terhapus/.test(keluaran));
cek('error config rusak dilaporkan', /Gagal hapus "config-rusak" \(2\)/.test(keluaran));
cek('catatan file yang gagal tetap aman', /TETAP tersimpan aman di sana/.test(keluaran));

const db2 = new Database(dbPath, { readonly: true });
cek('semua file ditandai terhapus', db2.prepare('SELECT COUNT(*) AS n FROM files WHERE deleted_at IS NULL').get().n === 0);
cek('semua folder ditandai terhapus', db2.prepare('SELECT COUNT(*) AS n FROM folders WHERE deleted_at IS NULL').get().n === 0);
cek('used_bytes provider direset', db2.prepare('SELECT SUM(used_bytes) AS n FROM providers').get().n === 0);
db2.close();

fs.rmSync(kerja, { recursive: true, force: true });
console.log(gagal.length === 0 ? '\nHASIL: semua pemeriksaan lolos.' : `\nHASIL: ${gagal.length} pemeriksaan gagal.`);
process.exit(gagal.length === 0 ? 0 : 1);
