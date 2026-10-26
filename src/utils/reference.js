import crypto from 'node:crypto';

// No 0/O/1/I/L so references are easy to read out over the phone.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Human-friendly, non-sequential booking reference, e.g. JM-7KQ2XD. */
export function bookingReference() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `JM-${out}`;
}

export const paymentReference = (bookingRef) => `${bookingRef}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
