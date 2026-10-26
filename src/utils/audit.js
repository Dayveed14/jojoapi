import { pool } from '../db/pool.js';
import { hashIp } from './crypto.js';

/**
 * Record a sensitive action. Never pass passwords, tokens, full addresses or payment data in metadata.
 * Failures are logged but never break the request.
 */
export async function audit({ actorUserId = null, action, entityType = null, entityId = null, reason = null, metadata = null, ip = null }, conn = pool) {
  try {
    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, reason, redacted_metadata_json, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [actorUserId, action, entityType, entityId == null ? null : String(entityId), reason, metadata ? JSON.stringify(metadata) : null, hashIp(ip)],
    );
  } catch (err) {
    console.error('audit log failed:', err.message);
  }
}
