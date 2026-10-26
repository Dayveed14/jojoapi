// refresh_tokens (sessions) and user_tokens (password reset, email verification). Only hashes are stored.
import { pool } from '../db/pool.js';

export async function insertRefreshToken({ userId, familyId, tokenHash, expiresAt, userAgent }, conn = pool) {
  const [res] = await conn.query(
    'INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    [userId, familyId, tokenHash, expiresAt, userAgent || null],
  );
  return res.insertId;
}

/** Locks the token row (use inside a transaction). */
export async function findRefreshTokenForUpdate(tokenHash, conn) {
  const [rows] = await conn.query(
    `SELECT rt.*, u.role, u.status, u.token_version
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = ? FOR UPDATE`, [tokenHash]);
  return rows[0] || null;
}

export async function findRefreshFamily(tokenHash, conn = pool) {
  const [rows] = await conn.query('SELECT family_id FROM refresh_tokens WHERE token_hash = ?', [tokenHash]);
  return rows[0]?.family_id || null;
}

export async function revokeRefreshToken(id, replacedBy = null, conn = pool) {
  await conn.query('UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = ? WHERE id = ?', [replacedBy, id]);
}

export async function revokeFamily(familyId, conn = pool) {
  await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL', [familyId]);
}

export async function revokeAllForUser(userId, conn = pool) {
  await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId]);
}

export async function invalidateUserTokens(userId, purpose, conn = pool) {
  await conn.query('UPDATE user_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [userId, purpose]);
}

export async function insertUserToken({ userId, purpose, tokenHash, expiresAt }, conn = pool) {
  await conn.query('INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [userId, purpose, tokenHash, expiresAt]);
}

/** Locks a live (unused, unexpired) token. */
export async function findLiveUserTokenForUpdate(tokenHash, purpose, conn) {
  const [rows] = await conn.query(
    'SELECT id, user_id FROM user_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE',
    [tokenHash, purpose]);
  return rows[0] || null;
}

export async function markUserTokenUsed(id, conn = pool) {
  await conn.query('UPDATE user_tokens SET used_at = NOW() WHERE id = ?', [id]);
}
