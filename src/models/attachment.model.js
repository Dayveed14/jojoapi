import { pool } from '../db/pool.js';

export async function create(a, conn = pool) {
  const [res] = await conn.query(
    'INSERT INTO booking_attachments (booking_id, uploaded_by, kind, public_id, format, bytes, caption) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [a.bookingId, a.uploadedBy, a.kind, a.publicId, a.format, a.bytes, a.caption || null]);
  return res.insertId;
}

export async function listForBooking(bookingId, conn = pool) {
  const [rows] = await conn.query('SELECT id, kind, format, bytes, caption, created_at FROM booking_attachments WHERE booking_id = ? ORDER BY id', [bookingId]);
  return rows;
}

export async function findForBooking(id, bookingId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM booking_attachments WHERE id = ? AND booking_id = ?', [id, bookingId]);
  return rows[0] || null;
}

export async function remove(id, conn = pool) {
  await conn.query('DELETE FROM booking_attachments WHERE id = ?', [id]);
}
