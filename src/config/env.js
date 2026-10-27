import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // The site's address, e.g. https://jojo-market.vercel.app (no trailing slash).
  // Several allowed origins can be comma-separated; the FIRST is used in email links.
  CLIENT_ORIGIN: z.string().default('http://localhost:5173')
    .transform((v) => v.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean))
    .refine((list) => list.length > 0 && list.every((o) => /^https?:\/\/[^/]+$/.test(o)), 'Use full origins like https://jojo-market.vercel.app (no path, no trailing slash)'),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),
  // Hosted MySQL (Aiven, TiDB, Railway, PlanetScale…) usually needs TLS. DB_SSL_CA = the provider's CA certificate (PEM), optional.
  DB_SSL: bool,
  DB_SSL_CA: z.string().optional(),

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
  // Number of proxies in front of the API. Render alone = 1; Vercel → Render = 2.
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

export const env = { ...parsed.data, CLIENT_ORIGINS: parsed.data.CLIENT_ORIGIN, CLIENT_ORIGIN: parsed.data.CLIENT_ORIGIN[0] };
export const isProd = env.NODE_ENV === 'production';
export const resendEnabled = Boolean(parsed.data.RESEND_API_KEY);
export const paystackEnabled = Boolean(parsed.data.PAYSTACK_SECRET_KEY);
export const cloudinaryEnabled = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);

if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
  console.error('COOKIE_SAMESITE=none only works with COOKIE_SECURE=true.');
  process.exit(1);
}

/** TLS options for mysql2 (shared by the app pool and the migration runner). */
export const dbSsl = env.DB_SSL
  ? { minVersion: 'TLSv1.2', rejectUnauthorized: true, ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) }
  : undefined;

if (isProd && (!env.COOKIE_SECURE)) {
  console.error('COOKIE_SECURE must be true in production.');
  process.exit(1);
}
