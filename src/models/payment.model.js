// payment_transactions: charges, refunds, credits. Rows change status; amounts never get edited.
import { pool } from '../db/pool.js';

export async function create(t, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO payment_transactions (booking_id, kitchen_order_id, customer_id, provider, provider_reference, transaction_type, amount, status,
        idempotency_key, payer_note, verified_at, verified_by, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.bookingId ?? null, t.kitchenOrderId ?? null, t.customerId, t.provider, t.providerReference ?? null, t.type, t.amount, t.status,
      t.idempotencyKey ?? null, t.payerNote ?? null, t.verifiedAt ?? null, t.verifiedBy ?? null,
      t.metadata ? JSON.stringify(t.metadata) : null]);
  return res.insertId;
}

export async function findByProviderRefForUpdate(provider, reference, conn) {
  const [rows] = await conn.query('SELECT * FROM payment_transactions WHERE provider = ? AND provider_reference = ? FOR UPDATE', [provider, reference]);
  return rows[0] || null;
}

export async function findByIdForUpdate(id, conn) {
  const [rows] = await conn.query('SELECT * FROM payment_transactions WHERE id = ? FOR UPDATE', [id]);
  return rows[0] || null;
}

export async function findByIdempotencyKey(key, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM payment_transactions WHERE idempotency_key = ?', [key]);
  return rows[0] || null;
}

export async function markStatus(id, status, { verifiedBy = null, metadata } = {}, conn = pool) {
  const sets = ['status = ?'];
  const vals = [status];
  if (status === 'successful') { sets.push('verified_at = NOW()', 'verified_by = ?'); vals.push(verifiedBy); }
  if (metadata) { sets.push('metadata_json = ?'); vals.push(JSON.stringify(metadata)); }
  await conn.query(`UPDATE payment_transactions SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
}

export async function listForBooking(bookingId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY id', [bookingId]);
  return rows;
}

export async function listForCustomer(customerId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT t.*, b.reference AS booking_reference, k.reference AS kitchen_reference FROM payment_transactions t
       LEFT JOIN bookings b ON b.id = t.booking_id LEFT JOIN kitchen_orders k ON k.id = t.kitchen_order_id
      WHERE t.customer_id = ? AND t.status IN ('pending','successful') ORDER BY t.id DESC LIMIT 200`, [customerId]);
  return rows;
}

export async function listForAdmin({ status, provider, type, limit, offset }, conn = pool) {
  const where = [];
  const params = [];
  if (status) { where.push('t.status = ?'); params.push(status); }
  if (provider) { where.push('t.provider = ?'); params.push(provider); }
  if (type) { where.push('t.transaction_type = ?'); params.push(type); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM payment_transactions t ${whereSql}`, params);
  const [rows] = await conn.query(
    `SELECT t.*, b.reference AS booking_reference, k.reference AS kitchen_reference, p.display_name AS customer_name, u.email AS customer_email
       FROM payment_transactions t
       LEFT JOIN bookings b ON b.id = t.booking_id
       LEFT JOIN kitchen_orders k ON k.id = t.kitchen_order_id
       JOIN users u ON u.id = t.customer_id
       LEFT JOIN customer_profiles p ON p.user_id = t.customer_id
      ${whereSql} ORDER BY t.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { total: Number(total), rows };
}

/** Net money received for a booking (charges − refunds − credit issued back, + credit applied). */
export async function paidTotalKoboForBooking(bookingId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(CASE
        WHEN transaction_type IN ('charge','additional_charge','credit_applied') THEN amount
        WHEN transaction_type IN ('refund','credit_issued') THEN -amount ELSE 0 END), 0) AS net
       FROM payment_transactions WHERE booking_id = ? AND status = 'successful'`, [bookingId]);
  return Math.round(Number(row.net) * 100);
}

export async function creditBalanceKobo(customerId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'credit_issued' THEN amount
                              WHEN transaction_type = 'credit_applied' THEN -amount ELSE 0 END), 0) AS bal
       FROM payment_transactions WHERE customer_id = ? AND status = 'successful'`, [customerId]);
  return Math.round(Number(row.bal) * 100);
}

/** Serialise credit spending per customer. */
export async function lockCustomerRow(customerId, conn) {
  await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [customerId]);
}

export async function pendingCount(conn = pool) {
  const [[row]] = await conn.query("SELECT COUNT(*) AS n FROM payment_transactions WHERE status = 'pending' AND provider = 'manual'");
  return Number(row.n);
}

export async function hasPending(bookingId, type, conn = pool) {
  const [[row]] = await conn.query(
    "SELECT COUNT(*) AS n FROM payment_transactions WHERE booking_id = ? AND transaction_type = ? AND status IN ('pending','initiated') AND provider = 'manual'",
    [bookingId, type]);
  return Number(row.n) > 0;
}

// ---------- Kitchen orders ----------

export async function listForKitchenOrder(orderId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM payment_transactions WHERE kitchen_order_id = ? ORDER BY id', [orderId]);
  return rows;
}

export async function paidTotalKoboForKitchenOrder(orderId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(CASE
        WHEN transaction_type IN ('charge','additional_charge','credit_applied') THEN amount
        WHEN transaction_type IN ('refund','credit_issued') THEN -amount ELSE 0 END), 0) AS net
       FROM payment_transactions WHERE kitchen_order_id = ? AND status = 'successful'`, [orderId]);
  return Math.round(Number(row.net) * 100);
}

export async function hasPendingKitchen(orderId, conn = pool) {
  const [[row]] = await conn.query(
    "SELECT COUNT(*) AS n FROM payment_transactions WHERE kitchen_order_id = ? AND status = 'pending' AND provider = 'manual'", [orderId]);
  return Number(row.n) > 0;
}
