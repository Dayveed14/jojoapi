import { pool } from '../db/pool.js';

export async function nextVersion(bookingId, conn = pool) {
  const [[row]] = await conn.query('SELECT COALESCE(MAX(version_number), 0) + 1 AS v FROM booking_quotes WHERE booking_id = ?', [bookingId]);
  return Number(row.v);
}

export async function supersedeProposed(bookingId, conn = pool) {
  await conn.query("UPDATE booking_quotes SET status = 'superseded', decided_at = NOW() WHERE booking_id = ? AND status = 'proposed'", [bookingId]);
}

export async function create(q, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO booking_quotes (booking_id, version_number, goods_amount, service_fee, transport_cost, other_charges, other_label,
        upfront_amount, distance_km, distance_method, assumptions, note_to_customer, status, valid_until, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
    [q.bookingId, q.version, q.goodsAmount, q.serviceFee, q.transportCost, q.otherCharges, q.otherLabel || null, q.upfrontAmount,
      q.distanceKm ?? null, q.distanceMethod || null, q.assumptions || null, q.noteToCustomer || null, q.validUntil, q.createdBy]);
  return res.insertId;
}

export async function listForBooking(bookingId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM booking_quotes WHERE booking_id = ? ORDER BY version_number DESC', [bookingId]);
  return rows;
}

export async function findProposed(bookingId, conn = pool) {
  const [rows] = await conn.query("SELECT * FROM booking_quotes WHERE booking_id = ? AND status = 'proposed' ORDER BY version_number DESC LIMIT 1 FOR UPDATE", [bookingId]);
  return rows[0] || null;
}

export async function findById(id, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM booking_quotes WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function setStatus(id, status, conn = pool) {
  await conn.query('UPDATE booking_quotes SET status = ?, decided_at = NOW() WHERE id = ?', [status, id]);
}
