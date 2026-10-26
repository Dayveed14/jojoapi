import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/pool.js';
import { randomToken, sha256, uuid } from '../../utils/crypto.js';
import { AppError, unauthorized } from '../../utils/errors.js';
import { audit } from '../../utils/audit.js';

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

async function insertRefreshToken(conn, userId, familyId, userAgent) {
  const raw = randomToken();
  const expires = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const [res] = await conn.query(
    'INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    [userId, familyId, sha256(raw), expires, (userAgent || '').slice(0, 255) || null],
  );
  return { raw, id: res.insertId };
}

/** Start a new session (new refresh family) and set the httpOnly cookie. */
export async function startSession(user, req, res, conn = pool) {
  const { raw } = await insertRefreshToken(conn, user.id, uuid(), req.get('user-agent'));
  res.cookie(REFRESH_COOKIE, raw, cookieOptions());
  return signAccessToken(user);
}

export function clearSessionCookie(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(REFRESH_COOKIE, opts);
}

/**
 * Rotate the refresh token. Reuse of an already-rotated token revokes the entire family
 * (likely theft), except within a short grace window to tolerate two tabs refreshing at once.
 */
export async function rotateSession(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) throw unauthorized('No active session');

  const result = await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT rt.*, u.role, u.status, u.token_version
         FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = ? FOR UPDATE`,
      [sha256(raw)],
    );
    const token = rows[0];
    if (!token) return { error: 'invalid' };

    if (token.revoked_at) {
      const revokedAgo = Date.now() - new Date(token.revoked_at).getTime();
      if (token.replaced_by && revokedAgo < RACE_GRACE_MS) return { error: 'race' };
      await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL', [token.family_id]);
      return { error: 'reuse', userId: token.user_id };
    }
    if (new Date(token.expires_at) <= new Date() || token.status === 'suspended') {
      await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?', [token.id]);
      return { error: 'invalid' };
    }

    const next = await insertRefreshToken(conn, token.user_id, token.family_id, req.get('user-agent'));
    await conn.query('UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = ? WHERE id = ?', [next.id, token.id]);
    return { raw: next.raw, user: { id: token.user_id, role: token.role, token_version: token.token_version } };
  });

  if (result.error === 'race') throw new AppError(409, 'Session refresh already in progress', 'REFRESH_RACE');
  if (result.error) {
    clearSessionCookie(res);
    if (result.error === 'reuse') {
      await audit({ actorUserId: result.userId, action: 'auth.refresh_reuse_detected', entityType: 'user', entityId: result.userId, ip: req.ip });
    }
    throw unauthorized('Session expired. Please sign in again.');
  }

  res.cookie(REFRESH_COOKIE, result.raw, cookieOptions());
  return { accessToken: signAccessToken(result.user), userId: result.user.id };
}

/** Revoke the refresh family behind the current cookie (single-device logout). */
export async function endSession(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (raw) {
    const [rows] = await pool.query('SELECT family_id FROM refresh_tokens WHERE token_hash = ?', [sha256(raw)]);
    if (rows[0]) {
      await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL', [rows[0].family_id]);
    }
  }
  clearSessionCookie(res);
}

/** Invalidate every session for a user (password change/reset, suspension). */
export async function revokeAllSessions(userId, conn = pool) {
  await conn.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
  await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId]);
}
