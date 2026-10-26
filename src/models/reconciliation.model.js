import { pool } from '../db/pool.js';

export async function findByBooking(bookingId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM financial_reconciliations WHERE booking_id = ?', [bookingId]);
  return rows[0] || null;
}

export async function lockByBooking(bookingId, conn) {
  const [rows] = await conn.query('SELECT * FROM financial_reconciliations WHERE booking_id = ? FOR UPDATE', [bookingId]);
  return rows[0] || null;
}

export async function upsert(r, conn = pool) {
  await conn.query(
    `INSERT INTO financial_reconciliations (booking_id, purchase_record_id, quoted_total, paid_total, actual_final_total, refund_due,
        additional_due, resolution_status, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE purchase_record_id = VALUES(purchase_record_id), quoted_total = VALUES(quoted_total),
        paid_total = VALUES(paid_total), actual_final_total = VALUES(actual_final_total), refund_due = VALUES(refund_due),
        additional_due = VALUES(additional_due), resolution_status = VALUES(resolution_status), notes = VALUES(notes)`,
    [r.bookingId, r.purchaseRecordId, r.quotedTotal, r.paidTotal, r.actualFinalTotal, r.refundDue, r.additionalDue,
      r.resolutionStatus, r.notes || null, r.createdBy]);
}

export async function setResolution(bookingId, { resolutionStatus, customerChoice }, conn = pool) {
  const sets = ['resolution_status = ?'];
  const vals = [resolutionStatus];
  if (customerChoice !== undefined) { sets.push('customer_choice = ?'); vals.push(customerChoice); }
  await conn.query(`UPDATE financial_reconciliations SET ${sets.join(', ')} WHERE booking_id = ?`, [...vals, bookingId]);
}

export async function openCount(conn = pool) {
  const [[row]] = await conn.query(
    "SELECT COUNT(*) AS n FROM financial_reconciliations WHERE resolution_status IN ('awaiting_customer','refund_pending','additional_due','disputed')");
  return Number(row.n);
}

export async function listOpen(conn = pool) {
  const [rows] = await conn.query(
    `SELECT r.*, b.reference, p.display_name AS customer_name FROM financial_reconciliations r
       JOIN bookings b ON b.id = r.booking_id LEFT JOIN customer_profiles p ON p.user_id = b.customer_id
      WHERE r.resolution_status IN ('awaiting_customer','refund_pending','additional_due','disputed') ORDER BY r.updated_at DESC`);
  return rows;
}
