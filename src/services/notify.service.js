// Emails to Jojo (operators). Recipients: settings → notifications.operatorEmails, or every active operator.
import { pool } from '../db/pool.js';
import * as mailService from './mail.service.js';
import * as settingsService from './settings.service.js';

async function recipients() {
  const { notifications } = await settingsService.getAll();
  const listed = (notifications.operatorEmails || '').split(',').map((e) => e.trim()).filter(Boolean);
  if (listed.length) return listed;
  const [rows] = await pool.query("SELECT email FROM users WHERE role = 'operator' AND status = 'active'");
  return rows.map((r) => r.email);
}

/** Fire-and-forget: never fails the customer's request. */
export async function operators(template, { bookingId = null } = {}) {
  try {
    for (const to of await recipients()) await mailService.send({ to, bookingId, ...template });
  } catch (err) {
    console.error('operator notification failed:', err.message);
  }
}
