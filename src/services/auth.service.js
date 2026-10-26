import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import * as Token from '../models/token.model.js';
import * as User from '../models/user.model.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { AppError, badRequest, forbidden, unauthorized } from '../utils/errors.js';
import * as auditService from './audit.service.js';
import * as mailService from './mail.service.js';
import { revokeAllSessions } from './session.service.js';

// A login for an unknown email still runs bcrypt, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('jojo-market-timing-equaliser', env.BCRYPT_ROUNDS);

export const hashPassword = (pw) => bcrypt.hash(pw, env.BCRYPT_ROUNDS);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash || DUMMY_HASH);

async function createUserToken(conn, userId, purpose, ttlMs) {
  await Token.invalidateUserTokens(userId, purpose, conn); // one live link per purpose
  const raw = randomToken(32);
  await Token.insertUserToken({ userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) }, conn);
  return raw;
}

async function consumeUserToken(conn, raw, purpose) {
  const token = await Token.findLiveUserTokenForUpdate(sha256(raw), purpose, conn);
  if (!token) return null;
  await Token.markUserTokenUsed(token.id, conn);
  return token.user_id;
}

export async function register({ displayName, email, phone, password }, ip) {
  const passwordHash = await hashPassword(password);
  let userId;
  let verifyToken;
  try {
    ({ userId, verifyToken } = await withTransaction(async (conn) => {
      const id = await User.create({ email, phone, passwordHash }, conn);
      await User.createProfile(id, { displayName, notificationPreferences: { bookingUpdates: true, promotions: false } }, conn);
      const token = await createUserToken(conn, id, 'email_verification', env.EMAIL_VERIFY_TTL_HOURS * 3_600_000);
      return { userId: id, verifyToken: token };
    }));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new AppError(409, "We couldn't create an account with those details. If you already have one, sign in or reset your password.", 'REGISTRATION_CONFLICT');
    }
    throw err;
  }

  await auditService.record({ actorUserId: userId, action: 'auth.register', entityType: 'user', entityId: userId, ip });
  await mailService.send({ to: email, userId, ...mailService.templates.verify(`${env.CLIENT_ORIGIN}/verify-email?token=${verifyToken}`) });
  return User.findById(userId);
}

export async function login({ email, password, portal }, ip) {
  const row = await User.findAuthByEmail(email);
  const ok = await checkPassword(password, row?.password_hash);

  if (!row || !ok) {
    await auditService.record({ actorUserId: row?.id ?? null, action: 'auth.login_failed', entityType: 'user', entityId: row?.id ?? null, ip });
    throw unauthorized('Incorrect email or password.');
  }
  if (row.status === 'suspended') throw forbidden('This account is suspended. Please contact support.');
  if (portal === 'admin' && row.role !== 'operator') {
    throw forbidden('This sign-in is for Jojo Market staff. Customers can sign in on the main page.');
  }

  await User.markLogin(row.id);
  await auditService.record({ actorUserId: row.id, action: row.role === 'operator' ? 'auth.operator_login' : 'auth.login', entityType: 'user', entityId: row.id, ip });
  return User.findById(row.id);
}

export async function requestPasswordReset(email, ip) {
  const row = await User.findAuthByEmail(email);
  if (!row || row.status === 'suspended') return; // identical response either way
  const raw = await withTransaction((conn) => createUserToken(conn, row.id, 'password_reset', env.PASSWORD_RESET_TTL_MINUTES * 60_000));
  await auditService.record({ actorUserId: row.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: row.id, ip });
  await mailService.send({ to: email, userId: row.id, ...mailService.templates.reset(`${env.CLIENT_ORIGIN}/reset-password?token=${raw}`) });
}

export async function resetPassword({ token, password }, ip) {
  const passwordHash = await hashPassword(password);
  const userId = await withTransaction(async (conn) => {
    const id = await consumeUserToken(conn, token, 'password_reset');
    if (!id) return null;
    await User.updatePassword(id, passwordHash, conn);
    await revokeAllSessions(id, conn);
    return id;
  });
  if (!userId) throw badRequest('This reset link is invalid or has expired. Please request a new one.');
  await auditService.record({ actorUserId: userId, action: 'auth.password_reset', entityType: 'user', entityId: userId, ip });
}

export async function verifyEmail(token, ip) {
  const userId = await withTransaction(async (conn) => {
    const id = await consumeUserToken(conn, token, 'email_verification');
    if (id) await User.markEmailVerified(id, conn);
    return id;
  });
  if (!userId) throw badRequest('This verification link is invalid or has expired.');
  await auditService.record({ actorUserId: userId, action: 'auth.email_verified', entityType: 'user', entityId: userId, ip });
}

export async function resendVerification(userId) {
  const user = await User.findById(userId);
  if (!user || user.email_verified_at) return;
  const raw = await withTransaction((conn) => createUserToken(conn, userId, 'email_verification', env.EMAIL_VERIFY_TTL_HOURS * 3_600_000));
  await mailService.send({ to: user.email, userId, ...mailService.templates.verify(`${env.CLIENT_ORIGIN}/verify-email?token=${raw}`) });
}
