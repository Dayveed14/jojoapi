import { z } from 'zod';

/** Naira amount: number or numeric string, ≥ 0, max ₦100m, rounded to kobo. */
export const naira = z.coerce
  .number({ message: 'Enter an amount' })
  .min(0, 'Amount cannot be negative')
  .max(100_000_000, 'Amount is too large')
  .transform((v) => Math.round(v * 100) / 100);

export const optionalNaira = z.union([naira, z.literal('').transform(() => null), z.null()]).optional();

export const id = z.coerce.number().int().positive();
export const optionalId = z.union([id, z.null()]).optional();

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');

export const text = (max, msg) => z.string().trim().max(max, msg || `Keep this under ${max} characters`);
export const optionalText = (max) => z.union([text(max), z.null()]).optional().transform((v) => (v ? v : null));

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const reference = z.string().trim().regex(/^JM-[A-Z0-9]{6}$/, 'Invalid booking reference');
