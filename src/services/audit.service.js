import * as Audit from '../models/audit.model.js';
import { hashIp } from '../utils/crypto.js';

/**
 * Record a sensitive action. Never pass passwords, tokens, full addresses or payment secrets in metadata.
 * Failures are logged but never break the request.
 */
export async function record({ actorUserId = null, action, entityType = null, entityId = null, reason = null, metadata = null, ip = null }, conn) {
  try {
    await Audit.insert({
      actorUserId, action, entityType, entityId: entityId == null ? null : String(entityId), reason, metadata, ipHash: hashIp(ip),
    }, conn);
  } catch (err) {
    console.error('audit log failed:', err.message);
  }
}
