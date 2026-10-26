import { pool } from '../db/pool.js';

export async function create(r, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO booking_change_requests (booking_id, request_type, booking_item_id, description, extra_amount, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [r.bookingId, r.type, r.bookingItemId ?? null, r.description, r.extraAmount || 0, r.createdBy]);
  return res.insertId;
}

export async function listForBooking(bookingId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT c.*, bi.item_name FROM booking_change_requests c LEFT JOIN booking_items bi ON bi.id = c.booking_item_id
      WHERE c.booking_id = ? ORDER BY c.id DESC`, [bookingId]);
  return rows;
}

export async function findForUpdate(id, bookingId, conn) {
  const [rows] = await conn.query('SELECT * FROM booking_change_requests WHERE id = ? AND booking_id = ? FOR UPDATE', [id, bookingId]);
  return rows[0] || null;
}

export async function countPending(bookingId, conn = pool) {
  const [[row]] = await conn.query("SELECT COUNT(*) AS n FROM booking_change_requests WHERE booking_id = ? AND status = 'pending'", [bookingId]);
  return Number(row.n);
}

export async function decide(id, { status, decidedBy, customerNote }, conn = pool) {
  await conn.query('UPDATE booking_change_requests SET status = ?, decided_by = ?, customer_note = ?, decided_at = NOW() WHERE id = ?',
    [status, decidedBy, customerNote || null, id]);
}
