import * as User from '../models/user.model.js';
import { verifyAccessToken } from '../services/session.service.js';
import { forbidden, unauthorized } from '../utils/errors.js';

/**
 * Verifies the short-lived access token from `Authorization: Bearer <token>`, then confirms the account
 * is still active and the token hasn't been invalidated (token_version bumps on password change / suspension).
 */
export async function requireAuth(req, _res, next) {
  try {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw unauthorized('Session expired. Please sign in again.');
    }
    const user = await User.findSessionInfo(payload.sub);
    if (!user || user.status === 'suspended' || user.token_version !== payload.tv) throw unauthorized('Session expired. Please sign in again.');
    req.user = { id: user.id, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** Server-side role gate. Hiding a button in React is not authorization. */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};
