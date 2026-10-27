import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { startupCheck } from './db/startupCheck.js';
import { startScheduler } from './jobs/scheduler.js';
import { mailMode } from './services/mail.service.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`Jojo Market API listening on http://localhost:${env.PORT}`);
  console.log(mailMode() === 'resend' ? `Email: Resend, from ${env.MAIL_FROM}` : 'Email: printed in this terminal (set RESEND_API_KEY to send for real)');
  startupCheck();
  if (env.JOBS_ENABLED) startScheduler();
});

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down…`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
