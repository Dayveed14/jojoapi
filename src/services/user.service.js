import { withTransaction } from '../db/pool.js';
import * as User from '../models/user.model.js';
import * as Payment from '../models/payment.model.js';
import { AppError, badRequest } from '../utils/errors.js';
import { toNaira } from '../utils/money.js';
import * as auditService from './audit.service.js';
import { checkPassword, hashPassword } from './auth.service.js';
import { revokeAllSessions } from './session.service.js';
import * as uploadService from './upload.service.js';

const parseJson = (v) => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
};

/** Shape sent to the browser. Never includes hashes, token_version or other users' data. */
export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    role: row.role,
    displayName: row.display_name || row.email.split('@')[0],
    avatarUrl: row.avatar_url,
    emailVerified: Boolean(row.email_verified_at),
    preferredContactMethod: row.preferred_contact_method || 'email',
    notificationPreferences: parseJson(row.notification_preferences) || { bookingUpdates: true, promotions: false },
    householdSize: row.household_size ?? null,
    reminderLeadDays: row.reminder_lead_days ?? 3,
    restockRemindersEnabled: row.restock_reminders_enabled == null ? true : Boolean(row.restock_reminders_enabled),
    memberSince: row.created_at,
  };
}

export async function getMe(userId) {
  const user = toPublicUser(await User.findById(userId));
  user.creditBalance = toNaira(await Payment.creditBalanceKobo(userId));
  return user;
}

export async function updateProfile(userId, body) {
  const { phone, ...profile } = body;
  try {
    await withTransaction(async (conn) => {
      if (phone !== undefined) await User.updatePhone(userId, phone, conn);
      await User.updateProfile(userId, profile, conn);
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'That phone number is already linked to another account.', 'PHONE_IN_USE');
    throw err;
  }
  return getMe(userId);
}

export async function changePassword(userId, { currentPassword, newPassword }, ip) {
  const ok = await checkPassword(currentPassword, await User.getPasswordHash(userId));
  if (!ok) throw badRequest('Your current password is incorrect.', { fields: { currentPassword: 'Incorrect password' } });
  const hash = await hashPassword(newPassword);
  await withTransaction(async (conn) => {
    await User.updatePassword(userId, hash, conn);
    await revokeAllSessions(userId, conn); // signs out every other device
  });
  await auditService.record({ actorUserId: userId, action: 'user.password_changed', entityType: 'user', entityId: userId, ip });
  return User.findById(userId);
}

export async function setAvatar(userId, buffer) {
  uploadService.detectImageFormat(buffer);
  const current = await User.findById(userId);
  const result = await uploadService.uploadPublicImage(buffer, {
    folder: 'avatars',
    publicId: `u${userId}-${Date.now().toString(36)}`, // not guessable from the user id alone
    transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }, { quality: 'auto', fetch_format: 'auto' }],
  });
  await User.setAvatar(userId, result.secure_url, result.public_id);
  if (current?.avatar_public_id && current.avatar_public_id !== result.public_id) await uploadService.deleteImage(current.avatar_public_id);
  return getMe(userId);
}

export async function removeAvatar(userId) {
  const current = await User.findById(userId);
  await User.setAvatar(userId, null, null);
  await uploadService.deleteImage(current?.avatar_public_id);
  return getMe(userId);
}
