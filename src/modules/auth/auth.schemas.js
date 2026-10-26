import { z } from 'zod';

export const email = z
  .string({ message: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(255)
  .email('Enter a valid email address');

export const password = z
  .string({ message: 'Password is required' })
  .min(8, 'Use at least 8 characters')
  .max(128, 'Password is too long')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number');

// Nigerian numbers: 080..., +23480..., 23480... → normalised to +234XXXXXXXXXX
export const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .refine((v) => /^(\+?234|0)[789][01]\d{8}$/.test(v), 'Enter a valid Nigerian phone number')
  .transform((v) => (v.startsWith('0') ? `+234${v.slice(1)}` : v.startsWith('+') ? v : `+${v}`));

export const displayName = z.string({ message: 'Enter your name' }).trim().min(2, 'Enter your name').max(120);

export const registerSchema = z.object({
  displayName,
  email,
  phone: phone.optional().or(z.literal('').transform(() => undefined)),
  password,
  acceptTerms: z.boolean({ message: 'Please accept the terms to continue' }).refine((v) => v === true, 'Please accept the terms to continue'),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
  portal: z.enum(['customer', 'admin']).default('customer'),
});

export const forgotSchema = z.object({ email });

export const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});

export const verifySchema = z.object({ token: z.string().min(20).max(200) });
