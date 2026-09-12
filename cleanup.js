const Database = require('better-sqlite3');
const path = require('path');

// Jalankan dari root folder project (~/drivegutok), pakai: node cleanup.js
const db = new Database(path.join(__dirname, 'data', 'mydrive.sqlite'));

const now = new Date().toISOString();
const files = db.prepare("UPDATE files SET deleted_at = ? WHERE deleted_at IS NULL").run(now);
const folders = db.prepare("UPDATE folders SET deleted_at = ? WHERE deleted_at IS NULL").run(now);
db.prepare("UPDATE providers SET used_bytes = 0").run();

console.log(`Selesai. ${files.changes} file dan ${folders.changes} folder dihapus (soft delete). Angka pemakaian provider direset ke 0.`);
console.log('Catatan: file di Telegram channel / Mega tetap ada secara fisik di provider tersebut, cuma hilang dari daftar di dashboard.');
