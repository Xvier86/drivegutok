module.exports = {
  apps: [{
    name: 'gutok-drive',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      // WAJIB isi manual dengan secret yang sama persis dengan yang dipakai saat setup pertama.
      // Kalau value ini beda dari sebelumnya, semua config provider (token/password) yang sudah
      // tersimpan terenkripsi di SQLite tidak akan bisa didekrip lagi.
      STORAGE_CONFIG_KEY: 'ganti-dengan-secret-acak-minimal-32-karakter',
      MAX_FILE_SIZE: 5368709120
    }
  }]
};