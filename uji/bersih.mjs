// Uji bersih-vps.sh: rapikan VPS tidak boleh menghapus apa pun yang dipakai runtime
// (data/mydrive.sqlite*, .env, ecosystem.config.cjs), harus menyisakan arsip backup dan cadangan
// konfigurasi Nginx terbaru, dan hanya membuang sisa yang jelas tidak dipakai.
//
// Kenapa perlu: script ini menghapus berkas dengan pola nama. Salah pola = database produksi atau
// upload yang sedang berjalan ikut terhapus, dan kesalahan itu baru terasa setelah deploy berikutnya.
// Uji ini menjalankan script sungguhan di folder tiruan, jadi pola dan batas waktunya benar-benar
// diuji, bukan dibaca dari teksnya.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const akar = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skrip = path.join(akar, 'bersih-vps.sh');
const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-bersih-'));
const app = path.join(kerja, 'app');
const tmp = path.join(kerja, 'tmp');
const nginx = path.join(kerja, 'nginx');
const logPm2 = path.join(kerja, 'pm2-logs');
const npmCache = path.join(kerja, 'npm-cache');
const logrotate = path.join(kerja, 'logrotate');
const cloneLama = path.join(kerja, 'clone-lama');
const dataTmp = path.join(app, 'data', 'tmp');
for (const dir of [dataTmp, tmp, nginx, logPm2, npmCache, logrotate, cloneLama]) fs.mkdirSync(dir, { recursive: true });
for (const [nama, isi] of [['data/mydrive.sqlite', 'db'], ['data/mydrive.sqlite-wal', 'wal'], ['.env', 'SECRET=1'], ['ecosystem.config.cjs', 'config']]) {
  fs.writeFileSync(path.join(app, nama), isi);
}
fs.writeFileSync(path.join(cloneLama, 'README.md'), 'clone lama');
fs.writeFileSync(path.join(logPm2, 'gutok-drive-out.log'), 'log'.repeat(100));
fs.writeFileSync(path.join(npmCache, 'blob'), 'cache');

const TUA = new Date(Date.now() - 3 * 24 * 3600 * 1000);
const BARU = new Date();
const berkas = (dir, nama, isi = 'x', waktu = TUA) => {
  const full = path.join(dir, nama);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, isi);
  fs.utimesSync(full, waktu, waktu);
  return full;
};
const ada = (dir, nama) => fs.existsSync(path.join(dir, nama));

// 5 arsip backup: mtime 1..5 Agustus, jadi 3 terbaru (03, 04, 05) harus bertahan.
for (let hari = 1; hari <= 5; hari += 1) {
  fs.writeFileSync(path.join(app, `gutok-drive-backup-2026-08-0${hari}-0000.tar.gz`), `backup ${hari}`);
  fs.utimesSync(path.join(app, `gutok-drive-backup-2026-08-0${hari}-0000.tar.gz`), new Date(Date.UTC(2026, 7, hari)), new Date(Date.UTC(2026, 7, hari)));
}

berkas(tmp, 'deploy-LAMA.sh', '# salinan lama');
berkas(tmp, 'deploy.sh', '# salinan yang sedang berjalan', BARU);
berkas(tmp, 'gutok-drive.log');
berkas(tmp, 'penting.txt', 'bukan milik aplikasi');
berkas(dataTmp, 'upload-batal.bin');
berkas(dataTmp, 'upload-jalan.bin', 'masih dipakai', BARU);
berkas(nginx, 'gutokdrive.world.bak-2026-08-01-000000');
berkas(nginx, 'gutokdrive.world.bak-2026-09-01-000000', 'x', BARU);

let gagal = 0;
const cek = (keterangan, syarat) => { if (syarat) console.log(`  ok  ${keterangan}`); else { console.error(`  GAGAL  ${keterangan}`); gagal += 1; } };
const jalankan = (tambahan = {}) => {
  const env = {
    ...process.env,
    APP_DIR: app,
    TMP_DIR: tmp,
    NGINX_DIR: nginx,
    PM2_LOG_DIR: logPm2,
    NPM_CACHE: npmCache,
    LOGROTATE_DIR: logrotate,
    CLONE_LAMA: cloneLama,
    ...tambahan,
  };
  try {
    return { kode: 0, keluaran: execFileSync('bash', [skrip], { env, encoding: 'utf8' }) };
  } catch (error) {
    return { kode: error.status ?? 1, keluaran: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
};

// 1) Pratinjau tidak menghapus apa pun.
const pratinjau = jalankan({ DRY: '1' });
cek('DRY=1 exit 0', pratinjau.kode === 0);
cek('DRY=1 mencetak rencana', pratinjau.keluaran.includes('[DRY]'));
cek('DRY=1 tidak menghapus arsip backup lama', ada(app, 'gutok-drive-backup-2026-08-01-0000.tar.gz'));
cek('DRY=1 tidak menghapus sisa /tmp', ada(tmp, 'deploy-LAMA.sh'));
cek('DRY=1 tidak menghapus upload batal', ada(dataTmp, 'upload-batal.bin'));

// 2) Jalur normal.
const jalan = jalankan();
cek('exit 0', jalan.kode === 0);
cek('lapor selesai', jalan.keluaran.includes('HASIL: SELESAI'));
cek('arsip backup terbaru (03..05) disimpan', ['03', '04', '05'].every((h) => ada(app, `gutok-drive-backup-2026-08-${h}-0000.tar.gz`)));
cek('arsip backup lama (01, 02) dibuang', ['01', '02'].every((h) => !ada(app, `gutok-drive-backup-2026-08-${h}-0000.tar.gz`)));
cek('sisa /tmp dibuang', !ada(tmp, 'deploy-LAMA.sh') && !ada(tmp, 'gutok-drive.log'));
cek('salinan deploy.sh yang sedang berjalan tidak dibuang', ada(tmp, 'deploy.sh'));
cek('berkas asing di /tmp tidak dibuang', ada(tmp, 'penting.txt'));
cek('upload batal dibuang', !ada(dataTmp, 'upload-batal.bin'));
cek('upload yang sedang jalan disimpan', ada(dataTmp, 'upload-jalan.bin'));
cek('database produksi utuh', ada(app, 'data/mydrive.sqlite') && ada(app, 'data/mydrive.sqlite-wal'));
cek('.env dan ecosystem.config.cjs utuh', ada(app, '.env') && ada(app, 'ecosystem.config.cjs'));
cek('cadangan nginx terbaru disimpan', ada(nginx, 'gutokdrive.world.bak-2026-09-01-000000'));
cek('cadangan nginx lama dibuang', !ada(nginx, 'gutokdrive.world.bak-2026-08-01-000000'));
cek('clone lama dilaporkan, tidak dihapus', ada(cloneLama, 'README.md') && jalan.keluaran.includes('clone lama masih ada'));
cek('cache npm dibuang', !fs.existsSync(npmCache));

// 3) Idempoten + izin eksplisit menghapus clone lama.
const ulang = jalankan({ HAPUS_CLONE: '1' });
cek('jalan kedua exit 0 (idempoten)', ulang.kode === 0);
cek('tidak ada masalah pada jalan kedua', !ulang.keluaran.includes('[GAGAL]'));
cek('HAPUS_CLONE=1 menghapus clone lama', !fs.existsSync(cloneLama));

fs.rmSync(kerja, { recursive: true, force: true });
console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
