// users + customer_profiles. Models only talk to the database — no business rules here.
import { pool } from '../db/pool.js';

const SELECT_USER = `
  SELECT u.id, u.email, u.phone, u.role, u.status, u.avatar_url, u.avatar_public_id, u.email_verified_at,
         u.token_version, u.created_at, u.last_login_at,
         p.display_name, p.preferred_contact_method, p.notification_preferences,
         p.household_size, p.reminder_lead_days, p.restock_reminders_enabled
    FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id`;

export async function findById(id, conn = pool) {
  const [rows] = await conn.query(`${SELECT_USER} WHERE u.id = ?`, [id]);
  return rows[0] || null;
}

export async function findAuthByEmail(email, conn = pool) {
  const [rows] = await conn.query('SELECT id, email, password_hash, role, status FROM users WHERE email = ?', [email]);
  return rows[0] || null;
}

export async function findSessionInfo(id, conn = pool) {
  const [rows] = await conn.query('SELECT id, role, status, token_version FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function getPasswordHash(id, conn = pool) {
  const [rows] = await conn.query('SELECT password_hash FROM users WHERE id = ?', [id]);
  return rows[0]?.password_hash || null;
}

export async function create({ email, phone, passwordHash, role = 'customer' }, conn = pool) {
  const [res] = await conn.query(
    "INSERT INTO users (email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, 'active')",
    [email, phone || null, passwordHash, role],
  );
  return res.insertId;
}

export async function createProfile(userId, { displayName, notificationPreferences }, conn = pool) {
  await conn.query(
    'INSERT INTO customer_profiles (user_id, display_name, notification_preferences) VALUES (?, ?, ?)',
    [userId, displayName, JSON.stringify(notificationPreferences)],
  );
}

export async function updatePhone(userId, phone, conn = pool) {
  await conn.query('UPDATE users SET phone = ? WHERE id = ?', [phone, userId]);
}

const PROFILE_COLUMNS = {
  displayName: 'display_name',
  preferredContactMethod: 'preferred_contact_method',
  notificationPreferences: 'notification_preferences',
  householdSize: 'household_size',
  reminderLeadDays: 'reminder_lead_days',
  restockRemindersEnabled: 'restock_reminders_enabled',
};

export async function updateProfile(userId, fields, conn = pool) {
  const sets = [];
  const vals = [];
  for (const [key, col] of Object.entries(PROFILE_COLUMNS)) {
    if (fields[key] === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(key === 'notificationPreferences' ? JSON.stringify(fields[key]) : fields[key]);
  }
  if (!sets.length) return;
  await conn.query(`UPDATE customer_profiles SET ${sets.join(', ')} WHERE user_id = ?`, [...vals, userId]);
}

export async function updatePassword(userId, passwordHash, conn = pool) {
  await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
}

export async function bumpTokenVersion(userId, conn = pool) {
  await conn.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
}

export async function markLogin(userId, conn = pool) {
  await conn.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userId]);
}

export async function markEmailVerified(userId, conn = pool) {
  await conn.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?', [userId]);
}

export async function setAvatar(userId, url, publicId, conn = pool) {
  await conn.query('UPDATE users SET avatar_url = ?, avatar_public_id = ? WHERE id = ?', [url, publicId, userId]);
}

export async function setStatus(userId, status, conn = pool) {
  await conn.query('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
}

export async function customerStats(conn = pool) {
  const [[row]] = await conn.query(`
    SELECT SUM(role = 'customer') AS customers,
           SUM(role = 'customer' AND created_at >= NOW() - INTERVAL 7 DAY) AS newThisWeek,
           SUM(role = 'customer' AND email_verified_at IS NULL) AS unverified,
           SUM(status = 'suspended') AS suspended
      FROM users`);
  return row;
}

export async function listCustomers({ q, limit, offset }, conn = pool) {
  const where = ["u.role = 'customer'"];
  const params = [];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    where.push('(u.email LIKE ? OR p.display_name LIKE ? OR u.phone LIKE ?)');
    params.push(like, like, like);
  }
  const whereSql = where.join(' AND ');
  const [[{ total }]] = await conn.query(
    `SELECT COUNT(*) AS total FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id WHERE ${whereSql}`, params);
  const [rows] = await conn.query(
    `SELECT u.id, u.email, u.phone, u.status, u.created_at, u.last_login_at, u.email_verified_at, p.display_name,
            (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id) AS booking_count,
            (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id AND b.status = 'completed') AS completed_count
       FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id
      WHERE ${whereSql} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
  return { total: Number(total), rows };
}

export async function recentCustomers(limit = 5, conn = pool) {
  const [rows] = await conn.query(
    `SELECT u.id, u.email, u.created_at, u.email_verified_at, p.display_name
       FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id
      WHERE u.role = 'customer' ORDER BY u.created_at DESC LIMIT ?`, [limit]);
  return rows;
}

/** Customers with restock reminders on (for the reminder job). */
export async function findReminderRecipients(customerIds, conn = pool) {
  if (!customerIds.length) return [];
  const [rows] = await conn.query(
    `SELECT u.id, u.email, u.status, p.display_name, p.restock_reminders_enabled, p.notification_preferences
       FROM users u JOIN customer_profiles p ON p.user_id = u.id
      WHERE u.id IN (?)`, [customerIds]);
  return rows;
}
