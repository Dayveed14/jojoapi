import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  COOKIE_SECURE: bool,
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  EMAIL_VERIFY_TTL_HOURS: z.coerce.number().int().positive().default(48),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('jojo-market'),

  // Email via Resend. MAIL_FROM must use a domain verified in your Resend account.
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Jojo Market <jojomarket@fixer.com>'),
  MAIL_REPLY_TO: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Payments: leave blank to run in manual bank-transfer mode (operator confirms receipt).
  PAYSTACK_SECRET_KEY: z.string().optional(),

  // Road distances: leave blank to use straight-line distance × ROAD_FACTOR as a fallback estimate.
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  ROAD_FACTOR: z.coerce.number().min(1).max(3).default(1.35),

  // Background jobs (hold expiry, restocking reminders) run inside the API process when true.
  JOBS_ENABLED: bool,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const resendEnabled = Boolean(parsed.data.RESEND_API_KEY);
export const paystackEnabled = Boolean(parsed.data.PAYSTACK_SECRET_KEY);
export const cloudinaryEnabled = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);

if (isProd && (!env.COOKIE_SECURE)) {
  console.error('COOKIE_SECURE must be true in production.');
  process.exit(1);
}
