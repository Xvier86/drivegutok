module.exports = {
  apps: [{
    name: 'gutok-drive',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    env: { NODE_ENV: 'production', PORT: 3000 }
  }]
};