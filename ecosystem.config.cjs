// Konfigurasi PM2 untuk Gutok Drive.
// Dipakai: pm2 start ecosystem.config.cjs / pm2 restart ecosystem.config.cjs --update-env
// Script deploy (setup.sh, update-code.sh, deploy-bersih.sh) menyuntik nilai STORAGE_CONFIG_KEY
// dari .env ke baris di bawah, jadi jangan ganti placeholder-nya dengan format lain.
module.exports = {
  apps: [{
    name: 'gutok-drive',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,

    // VPS-nya 1 GB. Heap dibatasi 384 MB supaya Node tidak menggelembung sampai memicu OOM
    // killer (yang membunuh proses lain juga); max_memory_restart adalah jaring pengaman terakhir
    // kalau RSS tetap naik karena kebocoran memori.
    // Dua-duanya dipasang karena PM2 pada sebagian VPS hanya meneruskan `node_args` lewat
    // variabel lingkungan NODE_OPTIONS, bukan ke command line. Cek buktinya:
    //   tr '\0' '\n' < /proc/$(pgrep -f 'gutok-drive/server.js' | head -1)/environ | grep NODE_OPTIONS
    node_args: '--max-old-space-size=384',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      NODE_OPTIONS: '--max-old-space-size=384',

      // WAJIB sama persis dengan yang dipakai saat setup pertama. Kalau value ini beda,
      // semua config provider (token/password) yang tersimpan terenkripsi di SQLite
      // tidak akan bisa didekrip lagi.
      STORAGE_CONFIG_KEY: 'ganti-dengan-secret-acak-minimal-32-karakter',

      MAX_FILE_SIZE: 5368709120,

      // Masa simpan item di Sampah (hari) sebelum dibersihkan otomatis. Opsional, default 30.
      TRASH_RETENTION_DAYS: 30,
    },
  }],
};
