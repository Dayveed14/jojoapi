// Resend adapter (https://resend.com/docs/api-reference/emails/send-email).
// Sends from the domain you verified in Resend (see MAIL_FROM in .env).
import { env } from '../../config/env.js';

export async function send({ to, subject, text, html, idempotencyKey }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject,
      text,
      html,
      ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || `Resend error ${res.status}`);
    err.code = data?.name || `RESEND_${res.status}`; // e.g. validation_error when the from-domain isn't verified
    throw err;
  }
  return { id: data?.id };
}
