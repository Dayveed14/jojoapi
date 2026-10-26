import { pool } from '../db/pool.js';

const SELECT = `
  SELECT a.id, a.customer_id, a.label, a.recipient_name, a.recipient_phone, a.address_line, a.area_id,
         ar.name AS area_name, ar.lat AS area_lat, ar.lng AS area_lng,
         a.landmark, a.delivery_instructions, a.is_default, a.created_at
    FROM customer_addresses a JOIN areas ar ON ar.id = a.area_id`;

export async function listForCustomer(customerId, conn = pool) {
  const [rows] = await conn.query(`${SELECT} WHERE a.customer_id = ? AND a.archived_at IS NULL ORDER BY a.is_default DESC, a.created_at`, [customerId]);
  return rows;
}

/** Ownership is part of the WHERE clause, so one customer can never load another's address. */
export async function findForCustomer(id, customerId, conn = pool) {
  const [rows] = await conn.query(`${SELECT} WHERE a.id = ? AND a.customer_id = ? AND a.archived_at IS NULL`, [id, customerId]);
  return rows[0] || null;
}

export async function countForCustomer(customerId, conn = pool) {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM customer_addresses WHERE customer_id = ? AND archived_at IS NULL', [customerId]);
  return Number(n);
}

export async function create(customerId, a, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO customer_addresses (customer_id, label, recipient_name, recipient_phone, address_line, area_id, landmark, delivery_instructions, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [customerId, a.label, a.recipientName, a.recipientPhone, a.addressLine, a.areaId, a.landmark || null, a.deliveryInstructions || null, a.isDefault ? 1 : 0]);
  return res.insertId;
}

export async function update(id, customerId, a, conn = pool) {
  await conn.query(
    `UPDATE customer_addresses SET label = ?, recipient_name = ?, recipient_phone = ?, address_line = ?, area_id = ?,
            landmark = ?, delivery_instructions = ?, is_default = ?
      WHERE id = ? AND customer_id = ?`,
    [a.label, a.recipientName, a.recipientPhone, a.addressLine, a.areaId, a.landmark || null, a.deliveryInstructions || null, a.isDefault ? 1 : 0, id, customerId]);
}

export async function clearDefault(customerId, conn = pool) {
  await conn.query('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', [customerId]);
}

/** Soft delete: past bookings keep their own address snapshot. */
export async function archive(id, customerId, conn = pool) {
  await conn.query('UPDATE customer_addresses SET archived_at = NOW(), is_default = 0 WHERE id = ? AND customer_id = ?', [id, customerId]);
}
