// capacity_days (lock rows), capacity_holds, availability_exceptions
import { pool } from '../db/pool.js';

export async function listExceptions(from, to, conn = pool) {
  const [rows] = await conn.query(
    'SELECT * FROM availability_exceptions WHERE exception_date BETWEEN ? AND ? ORDER BY exception_date', [from, to]);
  return rows;
}

export async function findException(date, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM availability_exceptions WHERE exception_date = ?', [date]);
  return rows[0] || null;
}

export async function upsertException({ date, type, capacityUnits, reason, userId }, conn = pool) {
  await conn.query(
    `INSERT INTO availability_exceptions (exception_date, exception_type, capacity_units, reason, created_by) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE exception_type = VALUES(exception_type), capacity_units = VALUES(capacity_units), reason = VALUES(reason), created_by = VALUES(created_by)`,
    [date, type, capacityUnits ?? null, reason || null, userId]);
}

export async function deleteException(date, conn = pool) {
  await conn.query('DELETE FROM availability_exceptions WHERE exception_date = ?', [date]);
}

/** Units in use per date: active (unexpired) holds + consumed holds. */
export async function usedUnitsByDate(from, to, conn = pool) {
  const [rows] = await conn.query(
    `SELECT service_date, SUM(capacity_units) AS used FROM capacity_holds
      WHERE service_date BETWEEN ? AND ?
        AND (status = 'consumed' OR (status = 'active' AND (expires_at IS NULL OR expires_at > NOW())))
      GROUP BY service_date`, [from, to]);
  return rows;
}

/** Serialise all reservations for one date: insert the lock row if missing, then lock it. */
export async function lockDate(date, conn) {
  // Create the lock row in its own autocommit statement, so concurrent transactions only ever
  // contend on SELECT … FOR UPDATE (inserting it inside the transaction can deadlock).
  await pool.query('INSERT IGNORE INTO capacity_days (service_date) VALUES (?)', [date]);
  await conn.query('SELECT service_date FROM capacity_days WHERE service_date = ? FOR UPDATE', [date]);
}

export async function usedUnitsOn(date, { excludeBookingId = null } = {}, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(capacity_units), 0) AS used FROM capacity_holds
      WHERE service_date = ? ${excludeBookingId ? 'AND booking_id <> ?' : ''}
        AND (status = 'consumed' OR (status = 'active' AND (expires_at IS NULL OR expires_at > NOW())))`,
    excludeBookingId ? [date, excludeBookingId] : [date]);
  return Number(row.used);
}

export async function createHold({ bookingId, date, units, expiresAt }, conn = pool) {
  await conn.query(
    "INSERT INTO capacity_holds (booking_id, service_date, capacity_units, status, expires_at) VALUES (?, ?, ?, 'active', ?)",
    [bookingId, date, units, expiresAt]);
}

export async function extendHold(bookingId, expiresAt, conn = pool) {
  await conn.query("UPDATE capacity_holds SET expires_at = ? WHERE booking_id = ? AND status = 'active'", [expiresAt, bookingId]);
}

export async function consumeHold(bookingId, conn = pool) {
  await conn.query("UPDATE capacity_holds SET status = 'consumed', expires_at = NULL WHERE booking_id = ? AND status = 'active'", [bookingId]);
}

export async function releaseHolds(bookingId, conn = pool) {
  await conn.query("UPDATE capacity_holds SET status = 'released' WHERE booking_id = ? AND status IN ('active','consumed')", [bookingId]);
}

export async function moveHold(bookingId, newDate, conn = pool) {
  await conn.query("UPDATE capacity_holds SET service_date = ? WHERE booking_id = ? AND status IN ('active','consumed')", [newDate, bookingId]);
}

export async function expireStaleHolds(conn = pool) {
  const [res] = await conn.query("UPDATE capacity_holds SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= NOW()");
  return res.affectedRows;
}
