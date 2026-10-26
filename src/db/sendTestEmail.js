// Check your Resend setup:  npm run mail:test -- you@example.com
import { env, resendEnabled } from '../config/env.js';
import * as mailService from '../services/mail.service.js';
import { pool } from './pool.js';

const to = process.argv[2];
if (!to) {
  console.error('Usage: npm run mail:test -- you@example.com');
  process.exit(1);
}
console.log(resendEnabled ? `Sending via Resend from ${env.MAIL_FROM} …` : 'RESEND_API_KEY is not set — the email will only be printed below.');
const res = await mailService.send({ to, ...mailService.templates.verify(`${env.CLIENT_ORIGIN}/verify-email?token=TEST-LINK-NOT-REAL`), templateKey: 'mail.test' });
console.log(res ? `✓ Sent (id ${res.id}). Check ${to} — and spam, the first time.` : '✗ Failed — see the error above. Most common cause: MAIL_FROM is not on a domain verified in Resend.');
await pool.end();
