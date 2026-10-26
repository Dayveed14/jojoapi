import { pool } from '../db/pool.js';

export async function insert(row, conn = pool) {
  await conn.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, reason, redacted_metadata_json, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.actorUserId, row.action, row.entityType, row.entityId, row.reason, row.metadata ? JSON.stringify(row.metadata) : null, row.ipHash],
  );
}

export async function activitySummary(days = 7, conn = pool) {
  const [rows] = await conn.query(
    `SELECT action, COUNT(*) AS total FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL ? DAY GROUP BY action ORDER BY total DESC LIMIT 10`, [days]);
  return rows;
}

export async function list({ action, limit, offset }, conn = pool) {
  const where = action ? 'WHERE a.action LIKE ?' : '';
  const params = action ? [`${action}%`] : [];
  const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM audit_logs a ${where}`, params);
  const [rows] = await conn.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.reason, a.redacted_metadata_json, a.created_at,
            u.email AS actor_email, p.display_name AS actor_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       LEFT JOIN customer_profiles p ON p.user_id = a.actor_user_id
       ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { total: Number(total), rows };
}
