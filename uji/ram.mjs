// Uji RAM: membuktikan upload besar tidak lagi memuat seluruh file ke memori server.
// VPS-nya cuma 1 GB, dan dulu dua jalur upload melakukannya:
//   - Telegram: `new Blob([fs.readFileSync(file.path)])`  -> 1x ukuran file di heap
//   - Google Drive: `readFileSync` + `Buffer.concat`       -> 2x ukuran file di heap
// Akibatnya upload 300 MB saja sudah cukup memicu OOM killer (proses lain ikut mati).
//
// Cara kerja: server.js disalin ke folder sementara (node_modules di-symlink), lalu Telegram API
// dan Google Drive API diarahkan ke server tiruan lokal lewat TELEGRAM_API_BASE / GOOGLE_API_BASE.
// File 44 MB (batas Bot API 50 MB) dan 96 MB diunggah ke provider tiruan itu, sementara VmHWM
// proses server dibaca dari /proc/<pid>/status. Kalau file dimuat ke RAM, kenaikan HWM akan
// seukuran file — bukan belasan MB.
//
// Jalankan dari mana pun: node uji/ram.mjs
// Bandingkan dengan kode lama: UJI_SERVER_JS=/tmp/server-lama.js node uji/ram.mjs
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-ram-'));
const ukuranTelegram = 44 * 1024 * 1024; // di bawah batas 50 MB Bot API, tapi tetap besar untuk uji memori
const ukuranGdrive = Number(process.env.UJI_RAM_MB || 96) * 1024 * 1024;
const batasNaikMb = Number(process.env.UJI_RAM_BATAS_MB || 40);
const gagal = [];
const cek = (nama, syarat, detail = '') => {
  console.log(`${syarat ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ` -> ${detail}` : ''}`);
  if (!syarat) gagal.push(nama);
};

// --- Penjaga statis: aturan yang membuat uji ini tetap benar walau kode disunting nanti. ---
const sumber = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
for (const fungsi of ['kirimMultipart', 'uploadToTelegram', 'uploadToGoogleDrive']) {
  // Komentar dibuang dulu: penjelasan "dulu memakai readFileSync" tidak boleh dianggap kode.
  const badan = (sumber.match(new RegExp(`${fungsi === 'kirimMultipart' ? 'function' : 'async function'} ${fungsi}\\([\\s\\S]*?\\n\\}`))?.[0] || '').replace(/\/\/[^\n]*/g, '');
  cek(`${fungsi} mengalirkan file, tidak memuat ke RAM`, badan.length > 0 && !/readFileSync|Buffer\.concat/.test(badan) && (fungsi !== 'kirimMultipart' || /createReadStream/.test(badan)));
}
cek('SQLite dibatasi untuk VPS kecil', /pragma\('synchronous = NORMAL'\)/.test(sumber) && /pragma\('busy_timeout/.test(sumber) && /pragma\('cache_size/.test(sumber));
// Batas memori PM2 harus ada di DUA jalur: `node_args` (command line) dan `NODE_OPTIONS`
// (variabel lingkungan). Sebagian versi PM2 hanya meneruskan salah satunya, dan kegagalannya
// diam-diam: deploy tetap melaporkan sukses walau batas heap tidak terpasang.
const pm2 = fs.readFileSync(path.join(root, 'ecosystem.config.cjs'), 'utf8');
cek('PM2 punya batas heap (node_args + NODE_OPTIONS) + restart memori', /node_args: '--max-old-space-size=\d+'/.test(pm2) && /NODE_OPTIONS: '--max-old-space-size=\d+'/.test(pm2) && /max_memory_restart/.test(pm2));
// Script deploy wajib memeriksa environ juga, bukan hanya cmdline.
const deploy = `${fs.readFileSync(path.join(root, 'deploy.sh'), 'utf8')}${fs.readFileSync(path.join(root, 'redeploy.sh'), 'utf8')}`;
cek('script deploy membaca /proc/<pid>/environ dan cmdline', /cmdline/.test(deploy) && /environ/.test(deploy) && /NODE_OPTIONS/.test(deploy));
// Sumber bukti ketiga: PM2 sendiri tahu environment proses anaknya, jadi verifikasi tidak
// bergantung pada /proc (yang bisa gagal dibaca) atau format spawn PM2 tertentu.
cek('script deploy membaca NODE_OPTIONS lewat pm2 env juga', /pm2 env 0[^\n]*NODE_OPTIONS/.test(deploy));
// Script deploy menulis ulang dirinya sendiri lewat `git pull`, dan bash membaca script per-offset:
// tanpa salinan tetap, sisa script bisa tereksekusi dalam versi lama (pernah terjadi — peringatan
// heap palsu). Dipisah per script supaya keduanya wajib punya.
cek('deploy.sh jalan dari salinan tetap /tmp', deploy.includes('mktemp /tmp/deploy-') && deploy.includes('exec bash "$SALINAN_DEPLOY"'));
cek('redeploy.sh jalan dari salinan tetap /tmp', deploy.includes('mktemp /tmp/redeploy-') && deploy.includes('exec bash "$SALINAN_REDEPLOY"'));
cek('galat berulang dibatasi di log', /LOG_ULANG_MS/.test(sumber) && /function catatMasalah/.test(sumber));
cek('kegagalan kuota provider tidak dicoba ulang tiap menit', /CAPACITY_ERROR_TTL_MS/.test(sumber));

// --- Penjaga perilaku: galat yang datang berulang hanya boleh muncul sekali di log. ---
// 5 rejection identik harus menghasilkan 1 baris, bukan 5 — kalau tidak, akun Mega yang diblokir
// bisa mengisi disk VPS hanya dengan pesan yang sama.
const kerjaLog = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-log-'));
fs.copyFileSync(path.join(root, 'server.js'), path.join(kerjaLog, 'server.js'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerjaLog, 'node_modules'));
fs.writeFileSync(path.join(kerjaLog, 'picu.mjs'), [
  "await import('./server.js');",
  "const galat = new Error('EBLOCKED (-16): User blocked');",
  'for (let i = 0; i < 5; i += 1) process.emit(\'unhandledRejection\', galat);',
  'setTimeout(() => process.exit(0), 300);',
].join('\n'));
const logRingkas = await new Promise((resolve) => {
  const picu = spawn(process.execPath, ['picu.mjs'], {
    cwd: kerjaLog,
    env: { ...process.env, PORT: '0', NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'kunci-uji', LOG_ULANG_MS: '600000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let kumpul = '';
  picu.stdout.on('data', (data) => { kumpul += data; });
  picu.stderr.on('data', (data) => { kumpul += data; });
  picu.on('exit', () => resolve(kumpul));
});
fs.rmSync(kerjaLog, { recursive: true, force: true });
const barisGalat = (logRingkas.match(/\[unhandledRejection\]/g) || []).length;
cek('5 rejection identik hanya dicetak 1 kali', barisGalat === 1, `baris=${barisGalat}`);

if (!fs.existsSync('/proc/self/status')) {
  console.error('Uji RAM butuh Linux (/proc). Dilewati.');
  fs.rmSync(kerja, { recursive: true, force: true });
  process.exit(gagal.length ? 1 : 0);
}



// --- Server tiruan untuk Telegram Bot API + Google Drive API. ---
const diterimaProvider = { telegram: 0, gdrive: 0, contentLengthGdrive: null };
const tiruan = http.createServer((req, res) => {
  const jalur = new URL(req.url, 'http://127.0.0.1').pathname;
  let diterima = 0;
  req.on('data', (potongan) => { diterima += potongan.length; });
  req.on('end', () => {
    const kirim = (badan, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(badan)); };
    if (jalur === '/token') return kirim({ access_token: 'token-uji', expires_in: 3600 });
    if (jalur.endsWith('/getChat')) return kirim({ ok: true, result: { id: 1, title: 'uji' } });
    if (jalur.endsWith('/sendDocument')) { diterimaProvider.telegram = diterima; return kirim({ ok: true, result: { message_id: 1, document: { file_id: 'uji-telegram', file_size: diterima } } }); }
    if (jalur === '/drive/v3/files/folder-uji') return kirim({ id: 'folder-uji', name: 'uji', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } });
    if (jalur === '/upload/drive/v3/files') { diterimaProvider.gdrive = diterima; diterimaProvider.contentLengthGdrive = Number(req.headers['content-length']); return kirim({ id: 'uji-google', size: String(diterima) }); }
    if (jalur.startsWith('/drive/v3/about')) return kirim({ storageQuota: { usage: '0', limit: '1000000000' } });
    return kirim({ error: { message: `endpoint tiruan tidak dikenal: ${jalur}` } }, 404);
  });
});
await new Promise((resolve) => tiruan.listen(0, '127.0.0.1', resolve));
const dasarTiruan = `http://127.0.0.1:${tiruan.address().port}`;

// --- Salinan repo untuk dijalankan. ---
const berkasServer = process.env.UJI_SERVER_JS || path.join(root, 'server.js');
fs.copyFileSync(berkasServer, path.join(kerja, 'server.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(kerja, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(kerja, 'node_modules'));

const portApp = 3600 + Math.floor(Math.random() * 200);
const anak = spawn('node', ['server.js'], {
  cwd: kerja,
  env: {
    ...process.env,
    PORT: String(portApp),
    NODE_ENV: 'test',
    STORAGE_CONFIG_KEY: 'kunci-uji',
    TELEGRAM_API_BASE: dasarTiruan,
    GOOGLE_API_BASE: dasarTiruan,
  },
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
  tiruan.close();
  fs.rmSync(kerja, { recursive: true, force: true });
};
const paksa = setTimeout(() => {
  console.error(`!! Uji melebihi ${Math.round(Number(process.env.UJI_TIMEOUT_MS || 180000) / 1000)} detik. Log server:`);
  console.error(logAnak.trim());
  bersihkan();
  process.exit(1);
}, Number(process.env.UJI_TIMEOUT_MS || 180000));

// VmHWM = puncak pemakaian memori proses server sejak dijalankan.
const hwmMb = () => Number(fs.readFileSync(`/proc/${anak.pid}/status`, 'utf8').match(/VmHWM:\s+(\d+)/)[1]) / 1024;
const dasar = `http://127.0.0.1:${portApp}`;
const api = (jalur, opsi = {}) => fetch(`${dasar}${jalur}`, opsi);
const jsonOpsi = (badan, cookie = '') => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(badan) });

let siap = false;
for (let coba = 0; coba < 150 && !siap; coba += 1) {
  try { siap = (await api('/api/setup')).ok; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
}
if (!siap) { console.error('!! server tidak siap. Log:'); console.error(logAnak.trim()); cek('server siap', false); bersihkan(); process.exit(1); }

const buatOwner = await api('/api/setup', jsonOpsi({ email: 'owner@contoh.invalid', username: 'owner', password: 'rahasia123' }));
const ownerId = (await buatOwner.json()).user?.id || null;
const masuk = await api('/api/login', jsonOpsi({ identity: 'owner', password: 'rahasia123' }));
const cookie = (masuk.headers.get('set-cookie') || '').split(';')[0];

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const buatProvider = async (nama, kind, config) => {
  const respons = await api('/api/admin/providers', jsonOpsi({ name: nama, kind, capacityBytes: 4 * 1024 * 1024 * 1024, config }, cookie));
  return (await respons.json()).id;
};
const providerTelegram = await buatProvider('Telegram uji', 'telegram', { botToken: 'token-uji', chatId: '12345' });
const providerGdrive = await buatProvider('Google uji', 'gdrive', { folderId: 'folder-uji', serviceAccountJson: JSON.stringify({ client_email: 'uji@contoh.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${dasarTiruan}/token` }) });
cek('dua provider uji dibuat', Boolean(ownerId && cookie && providerTelegram && providerGdrive));

// Aktifkan langsung di SQLite supaya tidak memicu verifikasi koneksi saat PATCH.
const db = new Database(path.join(kerja, 'data', 'mydrive.sqlite'));
db.prepare('UPDATE providers SET enabled = 1 WHERE id IN (?, ?)').run(providerTelegram, providerGdrive);
db.close();

// File uji ditulis sebagai stream supaya proses uji ini sendiri tidak memuat 96 MB ke RAM.
const tulisBerkas = (namaBerkas, ukuran) => new Promise((resolve, reject) => {
  const tulis = fs.createWriteStream(namaBerkas);
  tulis.on('error', reject);
  const potongan = Buffer.alloc(1024 * 1024, 9);
  let sisa = ukuran;
  const lanjut = () => {
    while (sisa > 0) {
      const bagian = potongan.subarray(0, Math.min(sisa, potongan.length));
      sisa -= bagian.length;
      if (!tulis.write(bagian)) return tulis.once('drain', lanjut);
    }
    return tulis.end(resolve);
  };
  lanjut();
});
const berkasTelegram = path.join(kerja, 'uji-telegram.bin');
const berkasGdrive = path.join(kerja, 'uji-gdrive.bin');
await tulisBerkas(berkasTelegram, ukuranTelegram);
await tulisBerkas(berkasGdrive, ukuranGdrive);

const unggah = async (namaBerkas, nama, providerId, mimeType) => {
  const form = new FormData();
  form.append('name', nama);
  form.append('mimeType', mimeType);
  form.append('providerId', providerId);
  // Blob dari file di disk: proses uji ikut mengalirkan file tanpa membacanya ke RAM.
  form.append('file', await fs.openAsBlob(namaBerkas, { type: mimeType }), path.basename(namaBerkas));
  const respons = await fetch(`${dasar}/api/files`, { method: 'POST', headers: { cookie }, body: form });
  return { status: respons.status, data: await respons.json().catch(() => null) };
};

try {
  // Pemanasan: satu upload kecil lewat jalur yang sama, supaya JIT/buffer awal tidak ikut terukur
  // sebagai "kenaikan RAM upload besar".
  const berkasPanas = path.join(kerja, 'uji-panas.bin');
  await tulisBerkas(berkasPanas, 2 * 1024 * 1024);
  await unggah(berkasPanas, 'uji-panas.bin', providerTelegram, 'application/octet-stream');
  await api('/api/dashboard', { headers: { cookie } });
  const hwmAwal = hwmMb();

  const telegram = await unggah(berkasTelegram, 'uji-telegram.bin', providerTelegram, 'application/octet-stream');
  const naikTelegram = hwmMb() - hwmAwal;
  cek('upload Telegram berhasil', telegram.status === 201, `status=${telegram.status} ${telegram.data?.error || ''}`);
  cek('Telegram tiruan menerima seluruh file', diterimaProvider.telegram >= ukuranTelegram, `diterima=${diterimaProvider.telegram} ukuran=${ukuranTelegram}`);
  cek(`RAM server saat upload Telegram naik < ${batasNaikMb} MB`, naikTelegram < batasNaikMb, `naik=${Math.round(naikTelegram)} MB untuk file ${ukuranTelegram / 1048576} MB`);

  const hwmSebelumGdrive = hwmMb();
  const gdrive = await unggah(berkasGdrive, 'uji-gdrive.bin', providerGdrive, 'application/octet-stream');
  const naikGdrive = hwmMb() - hwmSebelumGdrive;
  cek('upload Google Drive berhasil', gdrive.status === 201, `status=${gdrive.status} ${gdrive.data?.error || ''}`);
  cek('Google tiruan menerima seluruh file', diterimaProvider.gdrive >= ukuranGdrive && diterimaProvider.gdrive === diterimaProvider.contentLengthGdrive, `diterima=${diterimaProvider.gdrive} content-length=${diterimaProvider.contentLengthGdrive}`);
  cek(`RAM server saat upload Google naik < ${batasNaikMb} MB`, naikGdrive < batasNaikMb, `naik=${Math.round(naikGdrive)} MB untuk file ${ukuranGdrive / 1048576} MB`);
} catch (error) {
  cek('uji selesai tanpa error', false, error.stack);
}

clearTimeout(paksa);
bersihkan();
if (gagal.length) {
  console.error(`\n${gagal.length} uji gagal: ${gagal.join(', ')}`);
  if (logAnak.trim()) console.error(logAnak.trim());
  process.exit(1);
}
console.log('\nSemua uji lulus.');
process.exit(0);
