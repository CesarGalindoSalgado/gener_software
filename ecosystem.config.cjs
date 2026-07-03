const path = require('path');

// PM2 mantiene el dev server de Porttea-Gener corriendo y expuesto en la red
// local (--host), para verlo desde otra computadora en la misma red.
//   Arrancar:  pm2 start ecosystem.config.cjs
//   Ver logs:  pm2 logs porttea-web
//   Detener:   pm2 stop porttea-web
//   Al inicio de Windows: pm2 save  (tras arrancar)
module.exports = {
  apps: [
    {
      name: 'gener-web',
      cwd: path.join(__dirname, 'web'),
      script: path.join(__dirname, 'web', 'node_modules', 'vite', 'bin', 'vite.js'),
      args: '--host --port 5173',
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'development' },
    },
    {
      // Bot de WhatsApp (Baileys). Vincula el número la PRIMERA vez corriendo
      //   cd bot && npm start
      // y escaneando el QR; ya vinculado, se puede manejar con PM2.
      // Config sensible en bot/.env (WEBHOOK_URL + WHATSAPP_WEBHOOK_SECRET).
      name: 'gener-bot',
      cwd: path.join(__dirname, 'bot'),
      script: path.join(__dirname, 'bot', 'index.js'),
      node_args: '--env-file-if-exists=.env',
      autorestart: true,
      watch: false,
    },
  ],
};
