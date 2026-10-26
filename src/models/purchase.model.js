// purchase_records + purchase_items: what was actually bought (or found, on a sample run)
import { pool } from '../db/pool.js';

export async function findByBooking(bookingId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM purchase_records WHERE booking_id = ?', [bookingId]);
  return rows[0] || null;
}

export async function createRecord(bookingId, operatorId, defaults, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO purchase_records (booking_id, operator_id, service_fee_actual, transport_cost_actual, shopping_started_at)
     VALUES (?, ?, ?, ?, NOW())`, [bookingId, operatorId, defaults.serviceFee, defaults.transportCost]);
  return res.insertId;
}

export async function updateRecord(id, r, conn = pool) {
  await conn.query(
    `UPDATE purchase_records SET goods_total = ?, service_fee_actual = ?, transport_cost_actual = ?, other_costs = ?, other_label = ?,
            final_total = ?, summary_note = ?, internal_notes = ? WHERE id = ?`,
    [r.goodsTotal, r.serviceFee, r.transportCost, r.otherCosts, r.otherLabel || null, r.finalTotal, r.summaryNote || null, r.internalNotes || null, id]);
}

export async function markShoppingCompleted(id, conn = pool) {
  await conn.query('UPDATE purchase_records SET shopping_completed_at = COALESCE(shopping_completed_at, NOW()) WHERE id = ?', [id]);
}

export async function markDelivered(id, conn = pool) {
  await conn.query('UPDATE purchase_records SET delivered_at = COALESCE(delivered_at, NOW()) WHERE id = ?', [id]);
}

export async function listItems(recordId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM purchase_items WHERE purchase_record_id = ? ORDER BY sort, id', [recordId]);
  return rows;
}

/** Replace the line items in one go (the operator edits the whole sheet). */
export async function replaceItems(recordId, items, conn = pool) {
  await conn.query('DELETE FROM purchase_items WHERE purchase_record_id = ?', [recordId]);
  if (!items.length) return;
  await conn.query(
    `INSERT INTO purchase_items (purchase_record_id, booking_item_id, catalog_item_id, option_id, item_name, option_label, outcome,
        actual_quantity, quantity_note, actual_amount, observed_price, notes, sort) VALUES ?`,
    [items.map((i, idx) => [recordId, i.bookingItemId ?? null, i.catalogItemId ?? null, i.optionId ?? null, i.itemName, i.optionLabel ?? null,
      i.outcome, i.actualQuantity ?? null, i.quantityNote ?? null, i.actualAmount, i.observedPrice ?? null, i.notes ?? null, idx])]);
}

/** Completed purchases for a customer, newest first. */
export async function listCompletedForCustomer(customerId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT b.reference, b.booking_type, b.service_date, b.completed_at, m.name AS market_name,
            pr.goods_total, pr.final_total, (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_record_id = pr.id) AS item_count
       FROM purchase_records pr JOIN bookings b ON b.id = pr.booking_id JOIN markets m ON m.id = b.market_id
      WHERE b.customer_id = ? AND b.status = 'completed' ORDER BY b.completed_at DESC`, [customerId]);
  return rows;
}

export async function listCompletedForAdmin({ limit, offset }, conn = pool) {
  const [rows] = await conn.query(
    `SELECT b.reference, b.booking_type, b.service_date, b.completed_at, m.name AS market_name, p.display_name AS customer_name,
            pr.goods_total, pr.final_total, r.resolution_status, r.refund_due, r.additional_due
       FROM purchase_records pr JOIN bookings b ON b.id = pr.booking_id JOIN markets m ON m.id = b.market_id
       LEFT JOIN customer_profiles p ON p.user_id = b.customer_id
       LEFT JOIN financial_reconciliations r ON r.booking_id = b.id
      WHERE b.status = 'completed' ORDER BY b.completed_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
  return rows;
}
