// Uji halaman publik (/, /privacy, /terms) — syarat publikasi aplikasi OAuth di Google.
//
// Kenapa perlu diuji: SPA punya catch-all yang melayani index.html untuk SEMUA alamat, jadi
// /privacy dan /terms bisa "HTTP 200" padahal isinya halaman aplikasi. Persis itu yang terjadi
// sebelum rute ini ada — dan Google menilai halaman dari isinya, bukan dari status 200-nya.
//
// Yang diperiksa karena itu: isinya benar-benar berbeda dari halaman aplikasi, menyebut aplikasi ini
// dengan namanya, dan tidak memuat skrip (kebijakan privasi harus terbaca walau JS mati).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const akar = new URL('../', import.meta.url).pathname;
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'drivegutok-publik-'));
const port = 42000 + Math.floor(Math.random() * 900);
let gagal = 0;
const cek = (nama, syarat, rincian = '') => {
  if (syarat) console.log(`  ok  ${nama}`);
  else { console.error(`  GAGAL  ${nama}${rincian ? ' -> ' + rincian : ''}`); gagal += 1; }
};

const anak = spawn(process.execPath, ['server.js'], {
  cwd: akar,
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', STORAGE_CONFIG_KEY: 'kunci-uji-publik', DATA_DIR: path.join(kerja, 'data') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
anak.stdout.on('data', (b) => { log += b; });
anak.stderr.on('data', (b) => { log += b; });

const dasar = `http://127.0.0.1:${port}`;
const tunggu = async (jalur, batas = 100) => {
  for (let i = 0; i < batas; i += 1) {
    try { const r = await fetch(dasar + jalur); if (r.ok || r.status < 500) return r; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};

const bersihkan = () => { anak.kill('SIGTERM'); fs.rmSync(kerja, { recursive: true, force: true }); };

try {
  const siap = await tunggu('/');
  if (!siap) throw new Error('server tidak siap: ' + log.slice(-400));

  const app = await (await fetch(dasar + '/')).text();
  const privasi = await fetch(dasar + '/privacy');
  const terms = await fetch(dasar + '/terms');
  const isiPrivasi = await privasi.text();
  const isiTerms = await terms.text();

  cek('kebijakan privasi dilayani HTTP 200', privasi.status === 200, `status=${privasi.status}`);
  cek('ketentuan layanan dilayani HTTP 200', terms.status === 200, `status=${terms.status}`);
  cek('keduanya HTML', (privasi.headers.get('content-type') || '').includes('text/html') && (terms.headers.get('content-type') || '').includes('text/html'));
  // Inti masalahnya: dulu keduanya mengembalikan index.html SPA.
  cek('kebijakan privasi BUKAN halaman aplikasi', isiPrivasi !== app && !isiPrivasi.includes('id="app"'), `panjang app=${app.length} privasi=${isiPrivasi.length}`);
  cek('ketentuan layanan BUKAN halaman aplikasi', isiTerms !== app && !isiTerms.includes('id="app"'));
  cek('isinya benar-benar berbeda satu sama lain', isiPrivasi !== isiTerms);

  cek('kebijakan privasi menyebut nama aplikasi', /Gutok\s*Drive/.test(isiPrivasi));
  cek('ketentuan layanan menyebut nama aplikasi', /Gutok\s*Drive/.test(isiTerms));
  cek('kebijakan privasi menyebut izin Google dan cara mencabutnya', /drive/i.test(isiPrivasi) && isiPrivasi.includes('myaccount.google.com/permissions'));
  cek('kebijakan privasi menjelaskan pihak ketiga (Drive/Mega/Telegram)', /Google Drive/.test(isiPrivasi) && /Mega/.test(isiPrivasi) && /Telegram/.test(isiPrivasi));
  // Isi teks harus ada di HTML yang dikirim (bukan diisi oleh skrip): itulah yang dibaca Google dan
// tetap terbaca kalau JS mati. Skrip tema kecil yang ada hanya memilih mode warna, bukan isinya.
cek('isi teks ada di HTML, bukan diisi skrip', /Kebijakan Privasi/.test(isiPrivasi) && /Ketentuan Layanan/.test(isiTerms) && /Google Drive/.test(isiPrivasi));
cek('skrip yang ada hanya pemilih tema, bukan pembangun isi', (isiPrivasi.match(/<script/g) || []).length === 1 && !/innerHTML\s*=/.test(isiPrivasi));
cek('halaman publik ikut mode tema', /gutok-tema/.test(isiPrivasi) && /gutok-tema/.test(isiTerms));
  cek('keduanya menyebut tanggal berlaku', /Berlaku sejak/.test(isiPrivasi) && /Berlaku sejak/.test(isiTerms));
  cek('tidak ada alamat yang menunjuk domain karangan', !/contoh|example\.com|localhost/i.test(isiPrivasi + isiTerms));
  cek('keduanya memakai token warna yang ada (ikut mode tema)', isiPrivasi.includes('styles/tokens.css') && /var\(--ink-soft\)/.test(isiPrivasi + isiTerms));
  cek('alamat tidak dikenal tetap dilayani aplikasi (SPA tidak rusak)', (await (await fetch(dasar + '/folder/apa-saja')).text()).includes('id="app"'));
  cek('API tetap 404 untuk rute tak dikenal (bukan HTML)', (await fetch(dasar + '/api/tidak-ada')).status === 404);
} catch (error) {
  console.error('GAGAL uji selesai tanpa error ->', error.message);
  gagal += 1;
} finally {
  bersihkan();
}

console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
