cd ~/drivegutok
pm2 stop gutok-drive
git pull origin main
npm ci --omit=dev
pm2 restart ecosystem.config.cjs --update-env
pm2 save
