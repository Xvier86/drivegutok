// Uji gaya: setiap kelas yang dipakai JS wajib punya aturan di assets/styles/*.css,
// tidak boleh ada inline style statis (hanya lebar progress yang dinamis), setiap nama ikon harus
// ada di assets/js/ikon.js, assets/index.html tidak boleh memuat skrip pihak ketiga, dan aset
// JS/CSS/HTML wajib dikirim `no-store` (Cloudflare menimpa `no-cache` jadi max-age 4 jam).
// Bug lama: tombol Owner control memakai var(--yellow) yang tidak pernah ada di CSS.
import fs from 'node:fs';

// Akar repo (folder induk uji/) supaya uji bisa dijalankan dari folder mana pun.
const akar = new URL('../', import.meta.url);
const baca = (rel) => fs.readFileSync(new URL(rel, akar), 'utf8');
const daftar = (rel) => fs.readdirSync(new URL(rel, akar)).map((f) => `${rel}/${f}`);

const berkasJs = ['assets/app.js', ...daftar('assets/js').filter((f) => f.endsWith('.js')), ...daftar('assets/js/views').filter((f) => f.endsWith('.js'))];
const berkasCss = daftar('assets/styles');

// Kelas penanda aksi/keadaan: sengaja tanpa aturan sendiri (gaya ikut .icon-btn/.file-card).
const PENANDA = /^(on|active|drag|show|folder|danger|member-view|view-enter)$|^(file|folder|provider|trash)-(view|rename|move|delete|cdn|share|config|toggle|restore|purge)$/;

const dipakai = new Set();
// Buang ekspresi ${...} di dalam kelas supaya 'current'/'on'/'off' tidak dianggap kelas statis.
const bersih = (teks) => { let t = teks; for (let i = 0; i < 5 && t.includes('${'); i += 1) t = t.replace(/\$\{[^{}]*\}/g, ' '); return t; };
for (const berkas of berkasJs) {
  const src = baca(berkas);
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    for (const kelas of bersih(m[1]).split(/\s+/)) if (/^[a-z][a-z0-9-]*$/.test(kelas)) dipakai.add(kelas);
  }
}

const bergaya = new Set();
for (const berkas of berkasCss) {
  const src = baca(berkas).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of src.matchAll(/\.([a-zA-Z][\w-]*)/g)) bergaya.add(m[1]);
}

let gagal = 0;
const cek = (keterangan, syarat) => { if (syarat) console.log(`  ok  ${keterangan}`); else { console.error(`  GAGAL  ${keterangan}`); gagal += 1; } };

const tanpaGaya = [...dipakai].filter((kelas) => !bergaya.has(kelas) && !PENANDA.test(kelas)).sort();
cek(`semua kelas punya aturan CSS (${dipakai.size} kelas dipakai)`, tanpaGaya.length === 0);
if (tanpaGaya.length) console.error(`        tanpa aturan: ${tanpaGaya.join(', ')}`);

const inline = [];
for (const berkas of berkasJs) {
  for (const m of baca(berkas).matchAll(/style="([^"]*)"/g)) if (!m[1].includes('${')) inline.push(`${berkas}: ${m[1]}`);
}
cek('tidak ada inline style statis', inline.length === 0);
inline.forEach((baris) => console.error(`        ${baris}`));

// Struktur CSS: kurung seimbang dan tidak ada selector bersarang di dalam blok deklarasi.
// Bug nyata: `.card-actions {` lupa ditutup di components.css, sehingga `.provider`, `.stats`,
// `.progress`, `.modal-backdrop`, `.toast`, `.loading-overlay`, dan `.admin-card` semuanya
// menjadi nested rule — hanya berlaku di dalam `.card-actions`, dan browser yang tidak mendukung
// CSS nesting membuangnya seluruhnya. Akibatnya modal Owner control tampil tanpa overlay (tombol
// konfigurasi/invite seolah tidak bisa dipakai) dan bilah provider di dashboard tidak terlihat.
const rusak = [];
for (const berkas of berkasCss) {
  let kedalaman = 0;
  for (const [index, baris] of baca(berkas).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').entries()) {
    const teks = baris.trim();
    if (kedalaman > 0 && /^\S[^{}]*\{\s*$/.test(teks) && !teks.startsWith('@')) rusak.push(`${berkas}:${index + 1} selector bersarang: ${teks}`);
    kedalaman += (baris.match(/\{/g) || []).length - (baris.match(/\}/g) || []).length;
  }
  if (kedalaman !== 0) rusak.push(`${berkas}: kurung tidak seimbang (${kedalaman})`);
}
cek('struktur CSS: kurung seimbang dan tanpa selector bersarang', rusak.length === 0);
rusak.forEach((baris) => console.error(`        ${baris}`));

// Widget penyimpanan: meter tersegmentasi yang menyala berurutan (delay per --i) lalu persentase
// menyusul setelah segmen terakhir. Semuanya animasi CSS, bukan timer JS, dan wajib tanpa
// box-shadow — pemisahan bagian hanya lewat hairline --line dan warna segmen.
const cssKomponen = baca('assets/styles/components.css');
// Komentar dibuang dulu: kalimat penjelas "tanpa box-shadow" di blok ini tidak boleh ikut terbaca
// sebagai deklarasi box-shadow.
const blokStorage = cssKomponen.slice(cssKomponen.indexOf('/* Widget penyimpanan'), cssKomponen.indexOf('/* Grid kartu di Owner control')).replace(/\/\*[\s\S]*?\*\//g, '');
cek('blok CSS widget penyimpanan ditemukan', blokStorage.length > 0);
cek('keyframes nyala-segmen dan muncul-persen ada', /@keyframes\s+nyala-segmen\s*\{/.test(blokStorage) && /@keyframes\s+muncul-persen\s*\{/.test(blokStorage));
cek('segmen menyala berurutan lewat animation-delay calc(var(--i))', /animation-delay:\s*calc\(var\(--i\)/.test(blokStorage));
cek('persentase muncul setelah meter selesai (var(--delay-pct))', /\.storage-card\.is-anim \.storage-pct/.test(blokStorage) && /var\(--delay-pct\)/.test(blokStorage));
cek('widget penyimpanan tanpa box-shadow', !/box-shadow/.test(blokStorage));
cek('meter memakai token --amber-glow, --amber-unlit, dan hairline --line', /var\(--amber-glow\)/.test(blokStorage) && /var\(--amber-unlit\)/.test(blokStorage) && /var\(--line\)/.test(blokStorage));
cek('angka penyimpanan memakai var(--f-mono)', /font-family:\s*var\(--f-mono\)/.test(blokStorage));
// Animasi hanya sekali per page-load: dijaga flag modul, dan prefers-reduced-motion melewatinya
// sama sekali (segmen langsung menyala penuh, angka tidak dihitung naik).
const sumberFiles = baca('assets/js/views/files.js');
cek('animasi meter dikunci flag sekali per page-load', /let storageDimainkan = false/.test(sumberFiles) && /storageDimainkan = true/.test(sumberFiles));
cek('animasi meter menghormati prefers-reduced-motion', /prefers-reduced-motion: reduce/.test(sumberFiles));

// Baris unggah dan aksi hapus. Tombol hapus disembunyikan dengan `visibility` (bukan `display`)
// selama unggah supaya tata letak baris tidak melompat, dan animasi masuk/keluar baris punya
// keyframes sendiri — tanpa keyframes-nya, `animationend` di deleteFile() hanya menunggu timeout.
cek('kelas baris unggah punya aturan sendiri', ['upl-meta', 'upl-bar', 'upl-fill', 'upl-angka', 'upl-persen', 'badge-selesai'].every((kelas) => new RegExp(`\\.${kelas}[ ,{]`).test(cssKomponen)));
cek('tombol hapus disembunyikan selama unggah', /\.file-card\.is-uploading \.file-delete \{\s*visibility: hidden/.test(cssKomponen));
cek('keyframes rowIn dan rowKeluar ada', /@keyframes\s+rowIn\s*\{/.test(cssKomponen) && /@keyframes\s+rowKeluar\s*\{/.test(cssKomponen));
cek('baris .removing memakai animasi keluar', /\.file-card\.removing \{[^}]*animation: rowKeluar/.test(cssKomponen));
cek('tombol unggah mengapung punya aturan .fab', /(^|\n)\.fab \{/.test(cssKomponen));
cek('bilah unggah tetap terlihat di tab CDN', /\.files-panel\[data-tab="cdn"\] \.file-card\.is-uploading \{ display: grid; \}/.test(baca('assets/styles/views.css')));

const token = new Set([...berkasCss.map((berkas) => baca(berkas)).join('\n').matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const dipakaiToken = new Set();
for (const berkas of [...berkasJs, ...berkasCss]) {
  for (const m of baca(berkas).matchAll(/var\(--([a-z0-9-]+)/g)) dipakaiToken.add(m[1]);
}
const tokenHilang = [...dipakaiToken].filter((nama) => !token.has(nama)).sort();
cek('semua var(--token) terdefinisi', tokenHilang.length === 0);
if (tokenHilang.length) console.error(`        token hilang: ${tokenHilang.join(', ')}`);

// Ikon: nama yang dipanggil icon('...') harus ada di peta ikon.js, karena nama yang salah hanya
// menghasilkan SVG kosong (tombol tanpa ikon) tanpa error apa pun di browser.
const petaIkon = new Set([...baca('assets/js/ikon.js').matchAll(/^\s+'([a-z0-9-]+)':/gm)].map((m) => m[1]));
const dipakaiIkon = new Set();
// Nama ikon juga diambil dari dalam ekspresi: `icon(a === 'application/pdf' ? 'file-text' : 'file')`
// dan peta ikonMime() di state.js dulu lolos dari pemeriksaan versi lama, sehingga 'image', 'video',
// dan 'file-text' tidak pernah terdaftar di ikon.js padahal dipakai (kartu media tanpa ikon).
const catatLiteral = (teks) => { for (const m of teks.matchAll(/'([^']*)'/g)) if (/^[a-z0-9-]+$/.test(m[1])) dipakaiIkon.add(m[1]); };
for (const berkas of [...berkasJs, ...berkasCss]) {
  for (const m of baca(berkas).matchAll(/icon\(([^)\n]*)/g)) catatLiteral(m[1]);
}
catatLiteral(baca('assets/js/state.js').match(/ikonMime = [^;]+/)?.[0] || '');
const ikonHilang = [...dipakaiIkon].filter((nama) => !petaIkon.has(nama)).sort();
cek(`semua nama ikon terdaftar di ikon.js (${dipakaiIkon.size} ikon dipakai)`, ikonHilang.length === 0);
if (ikonHilang.length) console.error(`        ikon hilang: ${ikonHilang.join(', ')}`);

const halaman = baca('assets/index.html');
const skripLuar = [...halaman.matchAll(/<script[^>]+src="(https?:[^"]+)"/g)].map((m) => m[1]);
cek('index.html tidak memuat skrip pihak ketiga', skripLuar.length === 0);
if (skripLuar.length) console.error(`        skrip luar: ${skripLuar.join(', ')}`);
// Font: Space Grotesk untuk label display, JetBrains Mono khusus angka. Kalau mono tidak dimuat,
// angka meter jatuh ke font sistem dan lebarnya bergoyang saat count-up.
cek('index.html memuat Space Grotesk dan JetBrains Mono', /family=[^"]*Space\+Grotesk/.test(halaman) && /family=[^"]*JetBrains\+Mono/.test(halaman));

// Pengiriman aset ke browser. Terukur di produksi 13 Sep 2026 (curl ke /js/views/admin.js dengan
// query pengusir cache, jawaban cf-cache-status=MISS dari origin): origin mengirim `no-cache`, tetapi
// yang diterima browser `cache-control: max-age=14400` karena Cloudflare menimpa Cache-Control aset
// statis dengan Browser Cache TTL miliknya. Akibatnya perbaikan owner control yang sudah ada di
// server (md5 aset VPS = repo) tetap tidak terlihat sampai 4 jam; gejalanya "Owner control terbuka
// sebentar lalu kembali ke Semua file". `no-store` adalah satu-satunya direktif yang menurut tabel
// Cloudflare tidak disimpan browser sama sekali, jadi aset JS/CSS/HTML harus dikirim dengan itu.
cek("server.js mengirim 'no-store' untuk aset JS/CSS/HTML", /Cache-Control',\s*\/\\\.\(js\|css\|html\)\$\/\.test\(berkas\)\s*\?\s*'no-store'/.test(baca('server.js')));

// Pemisahan berkas CDN dan berkas biasa: kalau aturan ini hilang, tab File/CDN cuma hiasan —
// dua tab menampilkan daftar yang sama.
const cssTampilan = baca('assets/styles/views.css');
cek('CSS menyembunyikan baris per tab (File vs CDN)', /\.files-panel\[data-tab="file"\] \.file-card\.is-cdn/.test(cssTampilan) && /\.files-panel\[data-tab="cdn"\] \.file-card:not\(\.is-cdn\)/.test(cssTampilan));
cek('kelas .tabs dan .tab punya aturan sendiri', /(^|\n)\.tabs \{/.test(cssTampilan) && /(^|\n)\.tab \{/.test(cssTampilan));
cek('kelas .file-list dan .file-info punya aturan sendiri', /(^|\n)\.file-list \{/.test(cssTampilan) && /(^|\n)\.file-info \{/.test(baca('assets/styles/components.css')));

console.log(gagal ? `GAGAL: ${gagal} pemeriksaan.` : 'Semua uji lulus.');
process.exitCode = gagal ? 1 : 0;
