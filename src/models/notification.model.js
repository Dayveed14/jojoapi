import { pool } from '../db/pool.js';

export async function log({ userId = null, bookingId = null, templateKey, status, providerReference = null, errorCode = null }, conn = pool) {
  await conn.query(
    'INSERT INTO notification_logs (user_id, booking_id, template_key, status, provider_reference, error_code) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, bookingId, templateKey, status, providerReference, errorCode]);
}

export async function recent(limit = 50, conn = pool) {
  const [rows] = await conn.query(
    `SELECT n.*, u.email FROM notification_logs n LEFT JOIN users u ON u.id = n.user_id ORDER BY n.id DESC LIMIT ?`, [limit]);
  return rows;
}
