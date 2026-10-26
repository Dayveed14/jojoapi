import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/pool.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { AppError, badRequest, forbidden, unauthorized } from '../../utils/errors.js';
import { audit } from '../../utils/audit.js';
import { emails, sendMail } from '../../utils/mailer.js';
import { findUserWithProfile } from '../users/users.repo.js';
import { revokeAllSessions } from './session.service.js';

// Used so a login for a non-existent email takes as long as a real one (no timing oracle).
const DUMMY_HASH = bcrypt.hashSync('jojo-market-timing-equaliser', env.BCRYPT_ROUNDS);

export const hashPassword = (pw) => bcrypt.hash(pw, env.BCRYPT_ROUNDS);

async function createUserToken(conn, userId, purpose, ttlMs) {
  // One live token per purpose: older unused ones are invalidated.
  await conn.query('UPDATE user_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [userId, purpose]);
  const raw = randomToken(32);
  await conn.query('INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?)', [
    userId, purpose, sha256(raw), new Date(Date.now() + ttlMs),
  ]);
  return raw;
}

/** Atomically consume a single-use token. Returns user_id or null. */
async function consumeUserToken(conn, raw, purpose) {
  const [rows] = await conn.query(
    'SELECT id, user_id FROM user_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE',
    [sha256(raw), purpose],
  );
  if (!rows[0]) return null;
  await conn.query('UPDATE user_tokens SET used_at = NOW() WHERE id = ?', [rows[0].id]);
  return rows[0].user_id;
}

export async function register({ displayName, email, phone, password }, ip) {
  const hash = await hashPassword(password);
  let userId;
  let verifyToken;
  try {
    ({ userId, verifyToken } = await withTransaction(async (conn) => {
      const [res] = await conn.query(
        "INSERT INTO users (email, phone, password_hash, role, status) VALUES (?, ?, ?, 'customer', 'active')",
        [email, phone || null, hash],
      );
      const id = res.insertId;
      await conn.query('INSERT INTO customer_profiles (user_id, display_name, notification_preferences) VALUES (?, ?, ?)', [
        id, displayName, JSON.stringify({ bookingUpdates: true, promotions: false }),
      ]);
      const token = await createUserToken(conn, id, 'email_verification', env.EMAIL_VERIFY_TTL_HOURS * 3_600_000);
      return { userId: id, verifyToken: token };
    }));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      // Deliberately vague: don't confirm which field or that an account exists.
      throw new AppError(409, "We couldn't create an account with those details. If you already have one, sign in or reset your password.", 'REGISTRATION_CONFLICT');
    }
    throw err;
  }

  await audit({ actorUserId: userId, action: 'auth.register', entityType: 'user', entityId: userId, ip });
  const mail = emails.verify(`${env.CLIENT_ORIGIN}/verify-email?token=${verifyToken}`);
  await sendMail({ to: email, ...mail });
  return findUserWithProfile(userId);
}

export async function login({ email, password, portal }, ip) {
  const [rows] = await pool.query('SELECT id, password_hash, role, status FROM users WHERE email = ?', [email]);
  const row = rows[0];
  const ok = await bcrypt.compare(password, row?.password_hash || DUMMY_HASH);

  if (!row || !ok) {
    await audit({ actorUserId: row?.id ?? null, action: 'auth.login_failed', entityType: 'user', entityId: row?.id ?? null, ip });
    throw unauthorized('Incorrect email or password.');
  }
  if (row.status === 'suspended') {
    throw forbidden('This account is suspended. Please contact support.');
  }
  if (portal === 'admin' && row.role !== 'operator') {
    throw forbidden('This sign-in is for Jojo Market staff. Customers can sign in on the main page.');
  }

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id]);
  await audit({ actorUserId: row.id, action: row.role === 'operator' ? 'auth.operator_login' : 'auth.login', entityType: 'user', entityId: row.id, ip });
  return findUserWithProfile(row.id);
}

export async function requestPasswordReset(email, ip) {
  const [rows] = await pool.query("SELECT id FROM users WHERE email = ? AND status <> 'suspended'", [email]);
  if (!rows[0]) return; // same response either way
  const userId = rows[0].id;
  const raw = await withTransaction((conn) => createUserToken(conn, userId, 'password_reset', env.PASSWORD_RESET_TTL_MINUTES * 60_000));
  await audit({ actorUserId: userId, action: 'auth.password_reset_requested', entityType: 'user', entityId: userId, ip });
  await sendMail({ to: email, ...emails.reset(`${env.CLIENT_ORIGIN}/reset-password?token=${raw}`) });
}

export async function resetPassword({ token, password }, ip) {
  const hash = await hashPassword(password);
  const userId = await withTransaction(async (conn) => {
    const id = await consumeUserToken(conn, token, 'password_reset');
    if (!id) return null;
    await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
    await revokeAllSessions(id, conn);
    return id;
  });
  if (!userId) throw badRequest('This reset link is invalid or has expired. Please request a new one.');
  await audit({ actorUserId: userId, action: 'auth.password_reset', entityType: 'user', entityId: userId, ip });
}

export async function verifyEmail(token, ip) {
  const userId = await withTransaction(async (conn) => {
    const id = await consumeUserToken(conn, token, 'email_verification');
    if (!id) return null;
    await conn.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?', [id]);
    return id;
  });
  if (!userId) throw badRequest('This verification link is invalid or has expired.');
  await audit({ actorUserId: userId, action: 'auth.email_verified', entityType: 'user', entityId: userId, ip });
}

export async function resendVerification(userId) {
  const user = await findUserWithProfile(userId);
  if (!user || user.email_verified_at) return;
  const raw = await withTransaction((conn) => createUserToken(conn, userId, 'email_verification', env.EMAIL_VERIFY_TTL_HOURS * 3_600_000));
  await sendMail({ to: user.email, ...emails.verify(`${env.CLIENT_ORIGIN}/verify-email?token=${raw}`) });
}
