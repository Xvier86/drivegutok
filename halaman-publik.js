// Halaman publik yang diminta Google sebelum aplikasi OAuth bisa dipublikasikan.
//
// Kenapa perlu berkas terpisah: Google menolak tombol "Publish app" selama Branding belum punya
// Application home page, Privacy policy, dan Terms of service, dan ketiganya harus satu domain yang
// sudah terdaftar sebagai Authorized Domain. Tanpa halaman nyata, pemilik terjebak di lingkaran:
// tidak bisa publish, dan tidak bisa melewati halaman izin Google karena aplikasinya masih Testing.
//
// Dua berkas ditulis apa adanya (bukan dihasilkan JS): kebijakan privasi harus terbaca walau skrip
// dimatikan, dan Google memeriksanya sebagai halaman biasa. Isinya sengaja menyebut aplikasi ini
// dengan namanya dan menyatakan apa yang benar-benar disimpan — bukan teks contoh yang menyebut
// perusahaan karangan.
const NAMA_APLIKASI = 'Gutok Drive';
const PEMILIK = 'gutokdrive.world';

const kerangka = (judul, isi) => `<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${judul} | ${NAMA_APLIKASI}</title>
  <!-- Tema dipasang sebelum CSS dimuat, sama seperti halaman aplikasi: pembaca yang memakai mode
       terang tidak perlu melihat halaman putih/gelap yang menyilaukan. -->
  <script>
    try {
      var p = localStorage.getItem('gutok-tema');
      var t = p === 'terang' || p === 'gelap' ? p
        : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'terang' : 'gelap');
      document.documentElement.dataset.tema = t;
      document.documentElement.style.colorScheme = t;
    } catch (e) { document.documentElement.dataset.tema = 'gelap'; }
  </script>
  <link rel="stylesheet" href="/styles/tokens.css" />
  <link rel="stylesheet" href="/styles/base.css" />
  <link rel="stylesheet" href="/styles/components.css" />
  <style>
    /* Satu kolom baca, sama di dua mode: memakai token yang sudah ada supaya halaman ini ikut
       berubah saat tema diganti, tanpa aturan warna baru. */
    body { background: var(--ink-soft); color: var(--paper); }
    .dokumen { max-width: 46rem; margin: 0 auto; padding: var(--space-7) var(--gutter); }
    .dokumen h1 { font-size: var(--fs-display); line-height: var(--lh-display); letter-spacing: var(--ls-display); margin-bottom: var(--space-4); }
    .dokumen h2 { font-size: var(--fs-lg); margin: var(--space-6) 0 var(--space-3); }
    .dokumen p, .dokumen li { line-height: var(--lh-body); color: var(--muted-strong); }
    .dokumen p + p { margin-top: var(--space-3); }
    .dokumen ul { padding-left: 1.2rem; display: grid; gap: var(--space-2); }
    .dokumen .meta { color: var(--muted); font-size: var(--fs-sm); }
    .dokumen a { color: var(--gold-bright); }
    .dokumen nav a { margin-right: var(--space-4); }
  </style>
</head>
<body>
  <main class="dokumen">
    <nav><a href="/">Aplikasi</a><a href="/privacy">Kebijakan privasi</a><a href="/terms">Ketentuan layanan</a></nav>
    <h1>${judul}</h1>
    ${isi}
  </main>
</body>
</html>`;

export function halamanPrivasi() {
  return kerangka('Kebijakan Privasi', `
    <p class="meta">Berlaku sejak 29 September 2026. Aplikasi: ${NAMA_APLIKASI} (${PEMILIK}).</p>
    <p>${NAMA_APLIKASI} adalah penyimpanan berkas pribadi. Halaman ini menjelaskan data apa yang
    disimpan, ke mana datanya pergi, dan bagaimana Anda menghapusnya.</p>

    <h2>Data yang disimpan</h2>
    <ul>
      <li><strong>Akun</strong>: email, nama pengguna, dan sandi yang disimpan sebagai hash — bukan teks asli.</li>
      <li><strong>Berkas</strong>: berkas yang Anda unggah beserta nama, ukuran, dan tanggal unggahnya.</li>
      <li><strong>Catatan aktivitas</strong>: tindakan seperti masuk, unggah, dan hapus, untuk keperluan keamanan.</li>
    </ul>

    <h2>Ke mana berkas Anda pergi</h2>
    <p>Berkas disimpan di penyimpanan yang dipasang oleh pemilik workspace: Google Drive, Mega, atau
    channel Telegram. Untuk itu, berkas Anda dikirim ke layanan tersebut memakai kredensial yang
    pemilik pasang sendiri. ${NAMA_APLIKASI} tidak mengirim data Anda ke pihak lain, tidak memakai
    data Anda untuk iklan, dan tidak menjualnya.</p>
    <p>Kalau Anda menekan tombol enkripsi saat mengunggah, isi berkas dienkripsi sebelum dikirim,
    sehingga penyimpanan tujuan hanya menerima data terenkripsi.</p>

    <h2>Akses Google</h2>
    <p>Saat menghubungkan akun Google, aplikasi meminta izin <em>Google Drive</em>
    (<code>drive</code>) semata untuk membaca kuota, mengunggah, mengunduh, dan menghapus berkas yang
    dikelola aplikasi ini. Izin itu dapat Anda cabut kapan saja di
    <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>;
    setelah dicabut, aplikasi tidak lagi dapat mengakses Drive Anda. Kredensial yang tersimpan di
    server dienkripsi dengan kunci milik server.</p>

    <h2>Menghapus data</h2>
    <p>Menghapus berkas memindahkannya ke Sampah lebih dulu, lalu dibersihkan otomatis setelah masa
    simpan habis. Menghapus akun menghapus berkas dan catatan aktivitas miliknya. Untuk meminta
    penghapusan seluruh data, hubungi pemilik workspace melalui email yang terdaftar.</p>

    <h2>Keamanan</h2>
    <p>Akses dibatasi per akun; berkas milik pengguna lain tidak dapat dibaca kecuali pemilik
    workspace memberikannya secara eksplisit. Sandi disimpan sebagai hash dan koneksi memakai HTTPS.</p>

    <h2>Perubahan</h2>
    <p>Kalau kebijakan ini berubah, tanggal di bagian atas ikut diperbarui.</p>
  `);
}

export function halamanKetentuan() {
  return kerangka('Ketentuan Layanan', `
    <p class="meta">Berlaku sejak 29 September 2026. Aplikasi: ${NAMA_APLIKASI} (${PEMILIK}).</p>
    <p>Dengan memakai ${NAMA_APLIKASI}, Anda menyetujui ketentuan berikut.</p>

    <h2>Penggunaan yang diizinkan</h2>
    <p>Aplikasi ini disediakan untuk menyimpan berkas pribadi dan berkas yang Anda berhak simpan.
    Dilarang memakai layanan ini untuk menyimpan atau menyebarkan materi yang melanggar hukum,
    materi yang bukan milik Anda, atau untuk mengganggu layanan.</p>

    <h2>Akun dan tanggung jawab</h2>
    <p>Akses diberikan oleh pemilik workspace. Anda bertanggung jawab menjaga sandi akun Anda dan
    atas semua aktivitas yang terjadi melalui akun itu.</p>

    <h2>Penyimpanan pihak ketiga</h2>
    <p>Berkas dapat disimpan melalui layanan pihak ketiga (Google Drive, Mega, atau Telegram).
    Ketersediaan, batas kuota, dan kebijakan masing-masing layanan berlaku di samping ketentuan ini.
    Kalau koneksi ke salah satu penyimpanan terputus, berkas yang tersimpan di sana tetap mengikuti
    kebijakan penyedia tersebut.</p>

    <h2>Batas tanggung jawab</h2>
    <p>Layanan disediakan apa adanya. Pemilik workspace tidak menjamin layanan bebas gangguan atau
    kehilangan data, dan sejauh diizinkan hukum tidak bertanggung jawab atas kerugian yang timbul
    dari pemakaian layanan ini. Simpan salinan berkas penting Anda di tempat lain.</p>

    <h2>Penghentian</h2>
    <p>Akses dapat dihentikan kalau ketentuan ini dilanggar. Anda dapat berhenti memakai layanan ini
    kapan saja dan menghapus berkas Anda lebih dulu.</p>

    <h2>Kontak</h2>
    <p>Pertanyaan tentang ketentuan ini dapat disampaikan ke pemilik workspace melalui email yang
    terdaftar pada akun Anda.</p>
  `);
}
