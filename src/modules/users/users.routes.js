import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rateLimits.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../utils/audit.js';
import { AppError, asyncHandler, badRequest } from '../../utils/errors.js';
import { displayName, password, phone } from '../auth/auth.schemas.js';
import { hashPassword } from '../auth/auth.service.js';
import { revokeAllSessions, startSession } from '../auth/session.service.js';
import { assertRealImage, deleteImage, imageUpload, uploadPublicImage } from '../uploads/cloudinary.js';
import { findUserWithProfile, toPublicUser } from './users.repo.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ user: toPublicUser(await findUserWithProfile(req.user.id)) });
}));

const updateSchema = z
  .object({
    displayName: displayName.optional(),
    phone: phone.nullable().optional().or(z.literal('').transform(() => null)),
    preferredContactMethod: z.enum(['email', 'phone', 'whatsapp']).optional(),
    notificationPreferences: z.object({ bookingUpdates: z.boolean(), promotions: z.boolean() }).optional(),
  })
  .strict();

router.patch('/', validate(updateSchema), asyncHandler(async (req, res) => {
  const { displayName: name, phone: newPhone, preferredContactMethod, notificationPreferences } = req.body;
  try {
    await withTransaction(async (conn) => {
      if (newPhone !== undefined) await conn.query('UPDATE users SET phone = ? WHERE id = ?', [newPhone, req.user.id]);
      const sets = [];
      const vals = [];
      if (name !== undefined) { sets.push('display_name = ?'); vals.push(name); }
      if (preferredContactMethod) { sets.push('preferred_contact_method = ?'); vals.push(preferredContactMethod); }
      if (notificationPreferences) { sets.push('notification_preferences = ?'); vals.push(JSON.stringify(notificationPreferences)); }
      if (sets.length) {
        await conn.query(`UPDATE customer_profiles SET ${sets.join(', ')} WHERE user_id = ?`, [...vals, req.user.id]);
      }
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'That phone number is already linked to another account.', 'PHONE_IN_USE');
    throw err;
  }
  res.json({ user: toPublicUser(await findUserWithProfile(req.user.id)) });
}));

const passwordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });

router.post('/password', validate(passwordSchema), asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  const ok = await bcrypt.compare(req.body.currentPassword, rows[0]?.password_hash || '');
  if (!ok) throw badRequest('Your current password is incorrect.', { fields: { currentPassword: 'Incorrect password' } });

  const hash = await hashPassword(req.body.newPassword);
  await withTransaction(async (conn) => {
    await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    await revokeAllSessions(req.user.id, conn); // signs out every other device
  });
  await audit({ actorUserId: req.user.id, action: 'user.password_changed', entityType: 'user', entityId: req.user.id, ip: req.ip });

  const user = await findUserWithProfile(req.user.id);
  const accessToken = await startSession(user, req, res); // keep this device signed in
  res.json({ user: toPublicUser(user), accessToken, message: 'Password updated. Other devices have been signed out.' });
}));

router.post('/avatar', uploadLimiter, imageUpload.single('avatar'), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('Choose an image to upload.');
  assertRealImage(req.file.buffer);

  const current = await findUserWithProfile(req.user.id);
  // Random-suffixed id: avatar URLs aren't guessable from the user id.
  const publicId = `u${req.user.id}-${Date.now().toString(36)}`;
  const result = await uploadPublicImage(req.file.buffer, {
    folder: 'avatars',
    publicId,
    transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }, { quality: 'auto', fetch_format: 'auto' }],
  });

  await pool.query('UPDATE users SET avatar_url = ?, avatar_public_id = ? WHERE id = ?', [result.secure_url, result.public_id, req.user.id]);
  if (current?.avatar_public_id && current.avatar_public_id !== result.public_id) await deleteImage(current.avatar_public_id);

  res.json({ user: toPublicUser(await findUserWithProfile(req.user.id)) });
}));

router.delete('/avatar', asyncHandler(async (req, res) => {
  const current = await findUserWithProfile(req.user.id);
  await pool.query('UPDATE users SET avatar_url = NULL, avatar_public_id = NULL WHERE id = ?', [req.user.id]);
  await deleteImage(current?.avatar_public_id);
  res.json({ user: toPublicUser(await findUserWithProfile(req.user.id)) });
}));

export default router;
