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
const blokStorage = cssKomponen.slice(cssKomponen.indexOf('/* Widget penyimpanan'), cssKomponen.indexOf('/* Owner control')).replace(/\/\*[\s\S]*?\*\//g, '');
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

// Owner control: daftar baris + badge + timeline. Grid kartu lama wajib benar-benar hilang, tiga
// warna dot status wajib ada (amber = aktif, abu = nonaktif, merah redup = belum siap/kuota error),
// dan timeline butuh garis penghubung serta header grup tanggal — tanpa itu "list" kembali jadi
// kumpulan kotak dan tanggal terulang di setiap baris.
const cssLayar = baca('assets/styles/views.css');
const blokAdmin = cssKomponen.slice(cssKomponen.indexOf('/* Owner control')).replace(/\/\*[\s\S]*?\*\//g, '');
cek('blok CSS Owner control ditemukan', blokAdmin.length > 0);
cek('grid kartu provider/member sudah dihapus', !/\.provider-grid|\.member-grid/.test(cssKomponen + cssLayar));
cek('dot status: amber aktif, abu nonaktif, merah redup error', /\.dot\.on \{[^}]*var\(--amber-glow\)/.test(cssKomponen) && /\.dot\.off \{[^}]*var\(--muted\)/.test(cssKomponen) && /\.dot\.error \{[^}]*var\(--danger-dim\)/.test(cssKomponen));
cek('tombol .ghost dan .badge punya aturan sendiri', /(^|\n)\.ghost \{/.test(blokAdmin) && /(^|\n)\.badge \{/.test(blokAdmin));
cek('badge punya varian on/warn/error', /\.badge\.on \{/.test(blokAdmin) && /\.badge\.warn \{/.test(blokAdmin) && /\.badge\.error \{/.test(blokAdmin));
cek('baris member dipisah hairline --line-soft', /\.member-row \{[^}]*border-bottom: 1px solid var\(--line-soft\)/.test(blokAdmin));
cek('timeline punya garis penghubung tipis dan header grup tanggal', /\.tl-item::before \{[^}]*width: 1px[^}]*var\(--line-soft\)/.test(blokAdmin) && /\.tl-hari \{/.test(blokAdmin));
cek('ringkasan sidebar jadi daftar label/angka', /(^|\n)\.sidebar-stats \{/.test(cssLayar) && /\.stat-angka \{[^}]*var\(--f-mono\)/.test(cssLayar));

// Baris unggah dan aksi hapus. Tombol hapus disembunyikan dengan `visibility` (bukan `display`)
// selama unggah supaya tata letak baris tidak melompat, dan animasi masuk/keluar baris punya
// keyframes sendiri — tanpa keyframes-nya, `animationend` di deleteFile() hanya menunggu timeout.
cek('kelas baris unggah punya aturan sendiri', ['upl-meta', 'upl-bar', 'upl-fill', 'upl-angka', 'upl-persen', 'badge-selesai'].every((kelas) => new RegExp(`\\.${kelas}[ ,{]`).test(cssKomponen)));
cek('tombol hapus disembunyikan selama unggah', /\.file-card\.is-uploading \.file-delete \{\s*visibility: hidden/.test(cssKomponen));
cek('keyframes rowIn dan rowKeluar ada', /@keyframes\s+rowIn\s*\{/.test(cssKomponen) && /@keyframes\s+rowKeluar\s*\{/.test(cssKomponen));
cek('baris .removing memakai animasi keluar', /\.file-card\.removing \{[^}]*animation: rowKeluar/.test(cssKomponen));
// Status server di header: teks "Uptime X jam · Y digunakan" diganti tiga batang berdenyut. Keyframes-nya
// ikut diperiksa — animasi tanpa keyframes tidak menghasilkan error apa pun, batangnya hanya diam.
cek('keyframes denyut-status ada dan dipakai .server-status i', /@keyframes\s+denyut-status\s*\{/.test(cssKomponen) && /\.server-status i \{[^}]*animation:\s*denyut-status/.test(cssKomponen));

cek('tombol unggah mengapung punya aturan .fab', /(^|\n)\.fab \{/.test(cssKomponen));
cek('bilah unggah tetap terlihat di tab CDN', /\.files-panel\[data-tab="cdn"\] \.file-card\.is-uploading \{ display: grid; \}/.test(baca('assets/styles/views.css')));

// Tata letak responsif. .app-shell adalah query container: breakpoint memakai lebar panel (viewport
// dikurangi gutter), bukan lebar viewport — sidebar 240-264px membuat panel utama selalu lebih sempit
// dari layar, jadi breakpoint viewport salah menilai "sudah lebar" dan isi panel berdesakan.
const cssDasar = baca('assets/styles/base.css');
cek('.app-shell jadi query container', /\.app-shell \{[^}]*container-type: inline-size/.test(cssDasar) && /container-name: shell/.test(cssDasar));
cek('breakpoint tata letak memakai @container shell', /@container shell \(max-width: 720px\)/.test(cssDasar) && /@container shell \(min-width: 1025px\)/.test(cssDasar) && /@container shell \(max-width: 640px\)/.test(baca('assets/styles/views.css')));
// Sidebar di panel sempit jadi drawer: digeser dengan transform (bukan display: none) supaya ada
// animasi, dan position absolute karena `container-type` membuat `position: fixed` di dalam
// .app-shell ikut menggulir.
cek('sidebar sempit jadi drawer yang digeser transform', /\.sidebar \{ position: absolute;[^}]*transform: translateX\(-102%\); visibility: hidden/.test(cssDasar));
cek('drawer terbuka mengembalikan transform + visibility sidebar', /body\.is-drawer \.sidebar \{ transform: none; visibility: visible; \}/.test(cssDasar));
cek('drawer punya scrim gelap dan scroll terkunci', /body\.is-drawer \.drawer-scrim \{ opacity: 1; pointer-events: auto; \}/.test(cssDasar) && /body\.is-drawer \{ overflow: hidden; \}/.test(cssDasar));
cek('hamburger disembunyikan di panel lebar, muncul di panel sempit', /\.drawer-toggle \{ display: none; \}/.test(cssDasar) && /\.drawer-toggle \{ display: inline-flex; \}/.test(cssDasar));
// min(180px, 100%) bukan sekadar 180px: di panel yang lebih sempit dari 180px (layar 320px), kolom
// minimum 180px melebihi panelnya dan memicu scroll horizontal.
cek('grid file auto-fill dengan batas min()', /grid-template-columns: repeat\(auto-fill, minmax\(min\(180px, 100%\), 1fr\)\)/.test(cssDasar));

// Skala cair: tidak ada ukuran teks px tetap, dan jarak/teks inti memakai clamp/rem. Nilai px tetap
// membuat teks tidak ikut membesar saat pengguna memperbesar ukuran font browser.
const teksKaku = berkasCss.flatMap((berkas) => [...baca(berkas).matchAll(/font-size:\s*([^;]+);/g)].filter((cocok) => /\d+px/.test(cocok[1])).map((cocok) => `${berkas}: font-size: ${cocok[1]}`));
cek('tidak ada font-size px tetap', teksKaku.length === 0);
teksKaku.forEach((baris) => console.error(`        ${baris}`));
const cssToken = baca('assets/styles/tokens.css');
cek('skala teks dan jarak memakai clamp/rem', /--fs-body: clamp\(/.test(cssToken) && /--space-5: clamp\(/.test(cssToken) && /--gutter: clamp\(/.test(cssToken));

// Lebar tetap > 320px (layar terkecil yang diuji) tanpa pembatas min()/clamp() selalu memaksa scroll
// horizontal di suatu tempat. .provider-picker (min-width 180px) dan ikon 32-56px tetap aman.
const lebarKaku = [];
for (const berkas of berkasCss) {
  for (const [index, baris] of baca(berkas).split('\n').entries()) {
    for (const cocok of baris.matchAll(/(?:^|[;{])\s*(width|min-width):\s*([^;]+);/g)) {
      const nilai = cocok[2].trim();
      const px = [...nilai.matchAll(/(\d+(?:\.\d+)?)px/g)].map((angka) => Number(angka[1]));
      if (px.length && !/min\(|clamp\(|max\(/.test(nilai) && Math.max(...px) > 320) lebarKaku.push(`${berkas}:${index + 1} ${cocok[1]}: ${nilai}`);
    }
  }
}
cek('tidak ada lebar tetap > 320px', lebarKaku.length === 0);
lebarKaku.forEach((baris) => console.error(`        ${baris}`));

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
