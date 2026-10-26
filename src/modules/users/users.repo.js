import { pool } from '../../db/pool.js';

export async function findUserWithProfile(userId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT u.id, u.email, u.phone, u.role, u.status, u.avatar_url, u.avatar_public_id, u.email_verified_at,
            u.token_version, u.created_at, u.last_login_at,
            p.display_name, p.preferred_contact_method, p.notification_preferences
       FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id
      WHERE u.id = ?`,
    [userId],
  );
  return rows[0] || null;
}

/** Shape returned to the browser. Never include hashes, token_version or internal ids beyond the user's own. */
export function toPublicUser(row) {
  if (!row) return null;
  let prefs = row.notification_preferences;
  if (typeof prefs === 'string') {
    try { prefs = JSON.parse(prefs); } catch { prefs = null; }
  }
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    role: row.role,
    displayName: row.display_name || row.email.split('@')[0],
    avatarUrl: row.avatar_url,
    emailVerified: Boolean(row.email_verified_at),
    preferredContactMethod: row.preferred_contact_method || 'email',
    notificationPreferences: prefs || { bookingUpdates: true, promotions: false },
    memberSince: row.created_at,
  };
}
