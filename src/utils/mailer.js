import { env, isProd } from '../config/env.js';

/**
 * Email provider adapter. Swap `transport` for a real provider (Resend, Postmark, SES, Zoho…)
 * without touching auth logic. In development, messages are printed to the console.
 */
const consoleTransport = {
  async send({ to, subject, text }) {
    console.log(`\n--- email (dev) ---\nFrom: ${env.MAIL_FROM}\nTo: ${to}\nSubject: ${subject}\n\n${text}\n-------------------\n`);
    return { id: `dev-${Date.now()}` };
  },
};

let transport = consoleTransport;
export const setMailTransport = (t) => { transport = t; };

export async function sendMail(message) {
  try {
    return await transport.send(message);
  } catch (err) {
    // Never leak provider errors to the user; log a code only.
    console.error('mail send failed:', isProd ? err.code || 'unknown' : err);
    return null;
  }
}

export const emails = {
  verify: (link) => ({
    subject: 'Confirm your Jojo Market email',
    text: `Welcome to Jojo Market!\n\nConfirm your email address by opening this link:\n${link}\n\nThe link expires in ${env.EMAIL_VERIFY_TTL_HOURS} hours. If you didn't create an account, you can ignore this email.`,
  }),
  reset: (link) => ({
    subject: 'Reset your Jojo Market password',
    text: `We received a request to reset your Jojo Market password.\n\nOpen this link to choose a new one:\n${link}\n\nIt expires in ${env.PASSWORD_RESET_TTL_MINUTES} minutes and can only be used once. If you didn't ask for this, ignore this email — your password stays the same.`,
  }),
};
