import { env } from '../config/env.js';
import { forbidden } from '../utils/errors.js';

/**
 * Cookie-authenticated endpoints (refresh, logout) need CSRF protection.
 * Defence in depth: SameSite cookie + a required custom header (which a cross-site
 * form cannot set without a CORS preflight) + Origin check when the browser sends one.
 */
export function requireCsrfHeader(req, _res, next) {
  if (req.get('x-requested-with') !== 'jojo-web') return next(forbidden('Invalid request origin'));
  const origin = req.get('origin');
  if (origin && origin !== env.CLIENT_ORIGIN) return next(forbidden('Invalid request origin'));
  next();
}
