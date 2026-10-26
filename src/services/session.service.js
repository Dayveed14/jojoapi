// JWT access tokens + rotating refresh tokens (httpOnly cookie).
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool, withTransaction } from '../db/pool.js';
import * as Token from '../models/token.model.js';
import * as User from '../models/user.model.js';
import { randomToken, sha256, uuid } from '../utils/crypto.js';
import { AppError, unauthorized } from '../utils/errors.js';
import * as auditService from './audit.service.js';

export const REFRESH_COOKIE = 'jojo_rt';
const REFRESH_COOKIE_PATH = '/api/auth';
const RACE_GRACE_MS = 10_000;

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  domain: env.COOKIE_DOMAIN || undefined,
  path: REFRESH_COOKIE_PATH,
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
});

export function signAccessToken(user) {
  return jwt.sign({ role: user.role, tv: user.token_version }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: 'jojo-market',
    audience: 'jojo-market-web',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'jojo-market', audience: 'jojo-market-web' });
}

async function issueRefreshToken(conn, userId, familyId, userAgent) {
  const raw = randomToken();
  const id = await Token.insertRefreshToken({
    userId, familyId, tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    userAgent: (userAgent || '').slice(0, 255),
  }, conn);
  return { raw, id };
}

/** Start a new session (new refresh family), set the cookie, return an access token. */
export async function startSession(user, req, res, conn = pool) {
  const { raw } = await issueRefreshToken(conn, user.id, uuid(), req.get('user-agent'));
  res.cookie(REFRESH_COOKIE, raw, cookieOptions());
  return signAccessToken(user);
}

export function clearSessionCookie(res) {
  const { maxAge: _maxAge, ...opts } = cookieOptions();
  res.clearCookie(REFRESH_COOKIE, opts);
}

/**
 * Rotate the refresh token. Re-use of an already-rotated token revokes the whole family
 * (likely theft) — except within a short grace window so two tabs refreshing together don't sign the user out.
 */
export async function rotateSession(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) throw unauthorized('No active session');

  const result = await withTransaction(async (conn) => {
    const token = await Token.findRefreshTokenForUpdate(sha256(raw), conn);
    if (!token) return { error: 'invalid' };

    if (token.revoked_at) {
      const revokedAgo = Date.now() - new Date(token.revoked_at).getTime();
      if (token.replaced_by && revokedAgo < RACE_GRACE_MS) return { error: 'race' };
      await Token.revokeFamily(token.family_id, conn);
      return { error: 'reuse', userId: token.user_id };
    }
    if (new Date(token.expires_at) <= new Date() || token.status === 'suspended') {
      await Token.revokeRefreshToken(token.id, null, conn);
      return { error: 'invalid' };
    }

    const next = await issueRefreshToken(conn, token.user_id, token.family_id, req.get('user-agent'));
    await Token.revokeRefreshToken(token.id, next.id, conn);
    return { raw: next.raw, user: { id: token.user_id, role: token.role, token_version: token.token_version } };
  });

  if (result.error === 'race') throw new AppError(409, 'Session refresh already in progress', 'REFRESH_RACE');
  if (result.error) {
    clearSessionCookie(res);
    if (result.error === 'reuse') {
      await auditService.record({ actorUserId: result.userId, action: 'auth.refresh_reuse_detected', entityType: 'user', entityId: result.userId, ip: req.ip });
    }
    throw unauthorized('Session expired. Please sign in again.');
  }

  res.cookie(REFRESH_COOKIE, result.raw, cookieOptions());
  return { accessToken: signAccessToken(result.user), userId: result.user.id };
}

/** Revoke the session behind the current cookie (sign out on this device). */
export async function endSession(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (raw) {
    const familyId = await Token.findRefreshFamily(sha256(raw));
    if (familyId) await Token.revokeFamily(familyId);
  }
  clearSessionCookie(res);
}

/** Invalidate every session for a user (password change/reset, suspension). */
export async function revokeAllSessions(userId, conn = pool) {
  await User.bumpTokenVersion(userId, conn);
  await Token.revokeAllForUser(userId, conn);
}
