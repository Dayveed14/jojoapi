// customer_item_estimates + restocking_reminders (estimates only — never inventory)
import { pool } from '../db/pool.js';

export async function upsertEstimate(e, conn = pool) {
  await conn.query(
    `INSERT INTO customer_item_estimates (customer_id, catalog_item_id, option_key, item_label, last_purchase_item_id, last_booking_id,
        last_purchase_date, estimated_duration_days, estimated_depletion_date, remind_on, customer_status, reminders_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 1)
     ON DUPLICATE KEY UPDATE item_label = VALUES(item_label), last_purchase_item_id = VALUES(last_purchase_item_id),
        last_booking_id = VALUES(last_booking_id), last_purchase_date = VALUES(last_purchase_date),
        estimated_duration_days = IF(customer_adjusted = 1, estimated_duration_days, VALUES(estimated_duration_days)),
        estimated_depletion_date = IF(customer_adjusted = 1, DATE_ADD(VALUES(last_purchase_date), INTERVAL estimated_duration_days DAY), VALUES(estimated_depletion_date)),
        remind_on = IF(customer_adjusted = 1, DATE_SUB(DATE_ADD(VALUES(last_purchase_date), INTERVAL estimated_duration_days DAY), INTERVAL ? DAY), VALUES(remind_on)),
        customer_status = 'unknown', last_reminded_at = NULL`,
    [e.customerId, e.catalogItemId, e.optionKey, e.itemLabel, e.purchaseItemId, e.bookingId, e.purchaseDate,
      e.durationDays, e.depletionDate, e.remindOn, e.leadDays]);
}

export async function listForCustomer(customerId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT e.*, c.name AS category_name, c.icon AS category_icon, b.reference AS last_booking_reference
       FROM customer_item_estimates e
       JOIN catalog_items i ON i.id = e.catalog_item_id JOIN catalog_categories c ON c.id = i.category_id
       LEFT JOIN bookings b ON b.id = e.last_booking_id
      WHERE e.customer_id = ? ORDER BY e.estimated_depletion_date`, [customerId]);
  return rows;
}

export async function findForCustomer(id, customerId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM customer_item_estimates WHERE id = ? AND customer_id = ?', [id, customerId]);
  return rows[0] || null;
}

export async function update(id, fields, conn = pool) {
  const cols = {
    customerStatus: 'customer_status', remindersEnabled: 'reminders_enabled', estimatedDurationDays: 'estimated_duration_days',
    estimatedDepletionDate: 'estimated_depletion_date', remindOn: 'remind_on', customerAdjusted: 'customer_adjusted',
    lastConfirmedAt: 'last_confirmed_at', lastRemindedAt: 'last_reminded_at',
  };
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(cols)) {
    if (fields[k] === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(typeof fields[k] === 'boolean' ? (fields[k] ? 1 : 0) : fields[k]);
  }
  if (sets.length) await conn.query(`UPDATE customer_item_estimates SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
}

/** Estimates whose reminder date has arrived and that haven't been reminded for this cycle. */
export async function findDue(today, conn = pool) {
  const [rows] = await conn.query(
    `SELECT e.* FROM customer_item_estimates e
      WHERE e.reminders_enabled = 1 AND e.remind_on <= ? AND e.last_reminded_at IS NULL
        AND e.customer_status <> 'still_available'
      ORDER BY e.customer_id, e.estimated_depletion_date`, [today]);
  return rows;
}

export async function markReminded(ids, conn = pool) {
  if (!ids.length) return;
  await conn.query('UPDATE customer_item_estimates SET last_reminded_at = NOW() WHERE id IN (?)', [ids]);
}

export async function insertReminder({ customerId, estimateIds, dedupKey, status, providerMessageId }, conn = pool) {
  const [res] = await conn.query(
    'INSERT IGNORE INTO restocking_reminders (customer_id, estimate_ids_json, dedup_key, status, provider_message_id) VALUES (?, ?, ?, ?, ?)',
    [customerId, JSON.stringify(estimateIds), dedupKey, status, providerMessageId ?? null]);
  return res.affectedRows === 1;
}

export async function dueSoonCount(customerId, untilDate, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS n FROM customer_item_estimates WHERE customer_id = ? AND estimated_depletion_date <= ? AND customer_status <> 'still_available'`,
    [customerId, untilDate]);
  return Number(row.n);
}
