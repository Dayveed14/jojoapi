// Paystack adapter (https://paystack.com/docs/api). Amounts are in kobo.
// Swap for Flutterwave/Monnify by implementing the same three functions.
import crypto from 'node:crypto';
import { env } from '../../config/env.js';

const BASE = 'https://api.paystack.co';

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.status) {
    const err = new Error(data?.message || `Paystack error ${res.status}`);
    err.code = 'PAYSTACK_ERROR';
    throw err;
  }
  return data.data;
}

export async function initialize({ email, amountKobo, reference, callbackUrl, metadata }) {
  const data = await call('/transaction/initialize', {
    method: 'POST',
    body: { email, amount: amountKobo, currency: 'NGN', reference, callback_url: callbackUrl, metadata },
  });
  return { authorizationUrl: data.authorization_url, accessCode: data.access_code };
}

export async function verify(reference) {
  const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
  return { status: data.status, amountKobo: data.amount, currency: data.currency, paidAt: data.paid_at, channel: data.channel, id: data.id };
}

/** Webhook signature: HMAC-SHA512 of the raw body with the secret key. */
export function verifySignature(rawBody, signature) {
  if (!signature || !env.PAYSTACK_SECRET_KEY) return false;
  const expected = crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
