// kitchen_orders, kitchen_order_items, kitchen_order_events, kitchen_day_overrides
import { pool } from '../db/pool.js';

const SELECT = `
  SELECT o.*, p.display_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
    FROM kitchen_orders o JOIN users u ON u.id = o.customer_id LEFT JOIN customer_profiles p ON p.user_id = o.customer_id`;

export async function create(o, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO kitchen_orders (reference, customer_id, order_type, status, delivery_date, delivery_window, requested_delivery_at,
        delivery_address_id, addr_label, addr_recipient, addr_phone, addr_line, addr_area, addr_landmark, addr_instructions, addr_lat, addr_lng,
        portions, is_bulk, subtotal, delivery_fee, express_fee, total, customer_notes, allergy_notes, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [o.reference, o.customerId, o.orderType, o.status, o.deliveryDate, o.deliveryWindow ?? null, o.requestedDeliveryAt ?? null,
      o.address.id, o.address.label, o.address.recipient_name, o.address.recipient_phone, o.address.address_line, o.address.area_name,
      o.address.landmark, o.address.delivery_instructions, o.address.area_lat, o.address.area_lng,
      o.portions, o.isBulk ? 1 : 0, o.subtotal, o.deliveryFee, o.expressFee, o.total, o.customerNotes || null, o.allergyNotes || null, o.expiresAt]);
  return res.insertId;
}

export async function insertItems(orderId, items, conn = pool) {
  await conn.query(
    `INSERT INTO kitchen_order_items (order_id, meal_id, option_id, meal_name, option_label, unit_price, quantity, portions, line_total, exclusions, spice_level, instructions, sort)
     VALUES ?`,
    [items.map((i, idx) => [orderId, i.mealId, i.optionId, i.mealName, i.optionLabel, i.unitPrice, i.quantity, i.portions, i.lineTotal,
      JSON.stringify(i.exclusions), i.spiceLevel ?? null, i.instructions || null, idx])]);
}

export async function findByReference(reference, conn = pool) {
  const [rows] = await conn.query(`${SELECT} WHERE o.reference = ?`, [reference]);
  return rows[0] || null;
}

export async function findByReferenceForCustomer(reference, customerId, conn = pool) {
  const [rows] = await conn.query(`${SELECT} WHERE o.reference = ? AND o.customer_id = ?`, [reference, customerId]);
  return rows[0] || null;
}

export async function findById(id, conn = pool) {
  const [rows] = await conn.query(`${SELECT} WHERE o.id = ?`, [id]);
  return rows[0] || null;
}

export async function lockById(id, conn) {
  const [rows] = await conn.query('SELECT * FROM kitchen_orders WHERE id = ? FOR UPDATE', [id]);
  return rows[0] || null;
}

export async function listItems(orderId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM kitchen_order_items WHERE order_id = ? ORDER BY sort, id', [orderId]);
  return rows.map((r) => ({ ...r, exclusions: typeof r.exclusions === 'string' ? JSON.parse(r.exclusions) : r.exclusions }));
}

export async function listForCustomer(customerId, statuses, conn = pool) {
  const [rows] = await conn.query(
    `${SELECT} WHERE o.customer_id = ? ${statuses ? 'AND o.status IN (?)' : ''} ORDER BY o.delivery_date DESC, o.id DESC LIMIT 100`,
    statuses ? [customerId, statuses] : [customerId]);
  return rows;
}

export async function listForAdmin({ statuses, from, to, type, q, limit, offset }, conn = pool) {
  const where = [];
  const params = [];
  if (statuses?.length) { where.push('o.status IN (?)'); params.push(statuses); }
  if (from) { where.push('o.delivery_date >= ?'); params.push(from); }
  if (to) { where.push('o.delivery_date <= ?'); params.push(to); }
  if (type) { where.push('o.order_type = ?'); params.push(type); }
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    where.push('(o.reference LIKE ? OR p.display_name LIKE ? OR u.email LIKE ?)');
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await conn.query(
    `SELECT COUNT(*) AS total FROM kitchen_orders o JOIN users u ON u.id = o.customer_id LEFT JOIN customer_profiles p ON p.user_id = o.customer_id ${whereSql}`, params);
  const [rows] = await conn.query(`${SELECT} ${whereSql} ORDER BY o.delivery_date ASC, o.id ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { total: Number(total), rows };
}

export async function countByStatus(conn = pool) {
  const [rows] = await conn.query('SELECT status, COUNT(*) AS n FROM kitchen_orders GROUP BY status');
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

const TIMESTAMP_FOR = { awaiting_payment: 'approved_at', confirmed: 'paid_at', delivered: 'delivered_at', cancelled: 'cancelled_at' };

export async function setStatus(id, status, { reason = null, expiresAt } = {}, conn = pool) {
  const sets = ['status = ?', 'status_reason = ?'];
  const vals = [status, reason];
  if (TIMESTAMP_FOR[status]) sets.push(`${TIMESTAMP_FOR[status]} = COALESCE(${TIMESTAMP_FOR[status]}, NOW())`);
  if (expiresAt !== undefined) { sets.push('expires_at = ?'); vals.push(expiresAt); }
  await conn.query(`UPDATE kitchen_orders SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
}

export async function setPricing(id, { deliveryFee, expressFee, total, operatorNote }, conn = pool) {
  await conn.query('UPDATE kitchen_orders SET delivery_fee = ?, express_fee = ?, total = ?, operator_note = ? WHERE id = ?',
    [deliveryFee, expressFee, total, operatorNote || null, id]);
}

export async function setSchedule(id, { deliveryDate, deliveryWindow, requestedDeliveryAt }, conn = pool) {
  await conn.query('UPDATE kitchen_orders SET delivery_date = ?, delivery_window = ?, requested_delivery_at = ? WHERE id = ?',
    [deliveryDate, deliveryWindow ?? null, requestedDeliveryAt ?? null, id]);
}

export async function setRefund(id, { refundDue, refundStatus }, conn = pool) {
  await conn.query('UPDATE kitchen_orders SET refund_due = ?, refund_status = ? WHERE id = ?', [refundDue, refundStatus, id]);
}

export async function insertEvent({ orderId, fromStatus, toStatus, actorUserId, reason }, conn = pool) {
  await conn.query('INSERT INTO kitchen_order_events (order_id, from_status, to_status, actor_user_id, reason) VALUES (?, ?, ?, ?, ?)',
    [orderId, fromStatus, toStatus, actorUserId ?? null, reason || null]);
}

export async function listEvents(orderId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT e.from_status, e.to_status, e.reason, e.created_at, u.role AS actor_role
       FROM kitchen_order_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.order_id = ? ORDER BY e.id`, [orderId]);
  return rows;
}

/** Portions + order count already committed per date (unexpired awaiting_payment + confirmed onwards). */
export async function usageByDate(from, to, statuses, { excludeOrderId = null } = {}, conn = pool) {
  const [rows] = await conn.query(
    `SELECT delivery_date, SUM(portions) AS portions, COUNT(*) AS orders FROM kitchen_orders
      WHERE delivery_date BETWEEN ? AND ? AND status IN (?) ${excludeOrderId ? 'AND id <> ?' : ''}
        AND (status <> 'awaiting_payment' OR expires_at IS NULL OR expires_at > NOW())
      GROUP BY delivery_date`, excludeOrderId ? [from, to, statuses, excludeOrderId] : [from, to, statuses]);
  return rows;
}

export async function listOverrides(from, to, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM kitchen_day_overrides WHERE override_date BETWEEN ? AND ? ORDER BY override_date', [from, to]);
  return rows;
}

export async function upsertOverride({ date, type, capacityPortions, reason, userId }, conn = pool) {
  await conn.query(
    `INSERT INTO kitchen_day_overrides (override_date, override_type, capacity_portions, reason, created_by) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE override_type = VALUES(override_type), capacity_portions = VALUES(capacity_portions), reason = VALUES(reason)`,
    [date, type, capacityPortions ?? null, reason || null, userId]);
}

export async function deleteOverride(date, conn = pool) {
  await conn.query('DELETE FROM kitchen_day_overrides WHERE override_date = ?', [date]);
}

export async function findExpired(statuses, conn = pool) {
  const [rows] = await conn.query('SELECT id, reference FROM kitchen_orders WHERE status IN (?) AND expires_at IS NOT NULL AND expires_at <= NOW()', [statuses]);
  return rows;
}

export async function listForDay(date, statuses, conn = pool) {
  const [rows] = await conn.query(`${SELECT} WHERE o.delivery_date = ? AND o.status IN (?) ORDER BY o.delivery_window, o.requested_delivery_at`, [date, statuses]);
  return rows;
}
