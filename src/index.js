'use strict';

require('dotenv').config();

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'CLIENT_SECRET', 'SESSION_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('ناقص في ملف .env: ' + missing.join(', '));
  console.error('انسخ env.example باسم .env وعبّي القيم (شوف README.md).');
  process.exit(1);
}

const db = require('./db');
const { createClient } = require('./bot/client');
const { startWeb } = require('./web/server');

const client = createClient();
startWeb(client);
client.login(process.env.DISCORD_TOKEN).catch((e) => {
  console.error('فشل تسجيل دخول البوت (تأكد من التوكن):', e.message);
  process.exit(1);
});

const shutdown = () => {
  db.flush();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
