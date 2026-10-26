// bookings, booking_items, booking_status_events
import { pool } from '../db/pool.js';

const BOOKING_SELECT = `
  SELECT b.*, m.name AS market_name, m.area AS market_area, m.slug AS market_slug,
         p.display_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
    FROM bookings b
    JOIN markets m ON m.id = b.market_id
    JOIN users u ON u.id = b.customer_id
    LEFT JOIN customer_profiles p ON p.user_id = b.customer_id`;

export async function create(b, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO bookings (reference, customer_id, market_id, booking_type, status, service_date, time_window, delivery_required,
        delivery_address_id, addr_label, addr_recipient, addr_phone, addr_line, addr_area, addr_landmark, addr_instructions, addr_lat, addr_lng,
        goods_estimate_min, goods_estimate_max, intended_goods_budget, authorized_goods_limit, customer_notes, source_booking_id,
        submitted_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
    [b.reference, b.customerId, b.marketId, b.bookingType, b.status, b.serviceDate, b.timeWindow, b.deliveryRequired ? 1 : 0,
      b.address?.id ?? null, b.address?.label ?? null, b.address?.recipient_name ?? null, b.address?.recipient_phone ?? null,
      b.address?.address_line ?? null, b.address?.area_name ?? null, b.address?.landmark ?? null, b.address?.delivery_instructions ?? null,
      b.address?.area_lat ?? null, b.address?.area_lng ?? null,
      b.goodsEstimateMin, b.goodsEstimateMax, b.intendedGoodsBudget, b.authorizedGoodsLimit, b.customerNotes || null,
      b.sourceBookingId ?? null, b.expiresAt]);
  return res.insertId;
}

export async function insertItems(bookingId, items, conn = pool) {
  if (!items.length) return;
  await conn.query(
    `INSERT INTO booking_items (booking_id, catalog_item_id, option_id, item_name, option_label, price_type, price_snapshot,
        price_min_snapshot, price_max_snapshot, request_method, quantity, amount, estimate_min, estimate_max, preferences, allow_substitution, sort)
     VALUES ?`,
    [items.map((i, idx) => [bookingId, i.catalogItemId, i.optionId, i.itemName, i.optionLabel, i.priceType, i.price, i.priceMin, i.priceMax,
      i.requestMethod, i.quantity, i.amount, i.estimateMin, i.estimateMax, i.preferences || null, i.allowSubstitution ? 1 : 0, idx])]);
}

export async function findByReference(reference, conn = pool) {
  const [rows] = await conn.query(`${BOOKING_SELECT} WHERE b.reference = ?`, [reference]);
  return rows[0] || null;
}

/** Customer-scoped lookup: ownership is enforced in SQL. */
export async function findByReferenceForCustomer(reference, customerId, conn = pool) {
  const [rows] = await conn.query(`${BOOKING_SELECT} WHERE b.reference = ? AND b.customer_id = ?`, [reference, customerId]);
  return rows[0] || null;
}

export async function findById(id, conn = pool) {
  const [rows] = await conn.query(`${BOOKING_SELECT} WHERE b.id = ?`, [id]);
  return rows[0] || null;
}

export async function lockById(id, conn) {
  const [rows] = await conn.query('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [id]);
  return rows[0] || null;
}

export async function listItems(bookingId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM booking_items WHERE booking_id = ? ORDER BY sort, id', [bookingId]);
  return rows;
}

export async function listForCustomer(customerId, { statuses, limit = 50 } = {}, conn = pool) {
  const params = [customerId];
  let extra = '';
  if (statuses?.length) { extra = 'AND b.status IN (?)'; params.push(statuses); }
  const [rows] = await conn.query(
    `${BOOKING_SELECT} WHERE b.customer_id = ? ${extra} ORDER BY b.service_date DESC, b.id DESC LIMIT ?`, [...params, limit]);
  return rows;
}

export async function listForAdmin({ statuses, type, marketId, from, to, q, limit, offset }, conn = pool) {
  const where = [];
  const params = [];
  if (statuses?.length) { where.push('b.status IN (?)'); params.push(statuses); }
  if (type) { where.push('b.booking_type = ?'); params.push(type); }
  if (marketId) { where.push('b.market_id = ?'); params.push(marketId); }
  if (from) { where.push('b.service_date >= ?'); params.push(from); }
  if (to) { where.push('b.service_date <= ?'); params.push(to); }
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    where.push('(b.reference LIKE ? OR p.display_name LIKE ? OR u.email LIKE ?)');
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await conn.query(
    `SELECT COUNT(*) AS total FROM bookings b JOIN users u ON u.id = b.customer_id
       LEFT JOIN customer_profiles p ON p.user_id = b.customer_id ${whereSql}`, params);
  const [rows] = await conn.query(
    `${BOOKING_SELECT} ${whereSql} ORDER BY b.service_date ASC, b.id ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { total: Number(total), rows };
}

export async function countByStatus({ customerId } = {}, conn = pool) {
  const [rows] = await conn.query(
    `SELECT status, COUNT(*) AS n FROM bookings ${customerId ? 'WHERE customer_id = ?' : ''} GROUP BY status`,
    customerId ? [customerId] : []);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export async function listOnDate(date, conn = pool) {
  const [rows] = await conn.query(`${BOOKING_SELECT} WHERE b.service_date = ? ORDER BY b.time_window, b.id`, [date]);
  return rows;
}

export async function listInRange(from, to, statuses, conn = pool) {
  const [rows] = await conn.query(
    `SELECT b.id, b.reference, b.service_date, b.time_window, b.booking_type, b.status, m.name AS market_name, p.display_name AS customer_name
       FROM bookings b JOIN markets m ON m.id = b.market_id LEFT JOIN customer_profiles p ON p.user_id = b.customer_id
      WHERE b.service_date BETWEEN ? AND ? AND b.status IN (?) ORDER BY b.service_date, b.time_window`, [from, to, statuses]);
  return rows;
}

const TIMESTAMP_FOR = {
  awaiting_customer_approval: 'quoted_at',
  awaiting_payment: 'accepted_at',
  paid: 'paid_at',
  completed: 'completed_at',
  cancelled: 'cancelled_at',
};

export async function setStatus(id, status, { reason = null, expiresAt } = {}, conn = pool) {
  const ts = TIMESTAMP_FOR[status];
  const sets = ['status = ?', 'status_reason = ?'];
  const vals = [status, reason];
  if (ts) sets.push(`${ts} = NOW()`);
  if (expiresAt !== undefined) { sets.push('expires_at = ?'); vals.push(expiresAt); }
  await conn.query(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
}

export async function setAcceptedQuote(id, quoteId, conn = pool) {
  await conn.query('UPDATE bookings SET accepted_quote_id = ? WHERE id = ?', [quoteId, id]);
}

export async function raiseAuthorizedLimit(id, byAmount, conn = pool) {
  await conn.query('UPDATE bookings SET authorized_goods_limit = authorized_goods_limit + ? WHERE id = ?', [byAmount, id]);
}

export async function reschedule(id, date, timeWindow, conn = pool) {
  await conn.query('UPDATE bookings SET service_date = ?, time_window = ? WHERE id = ?', [date, timeWindow, id]);
}

export async function insertEvent({ bookingId, fromStatus, toStatus, actorUserId, reason }, conn = pool) {
  await conn.query(
    'INSERT INTO booking_status_events (booking_id, from_status, to_status, actor_user_id, reason) VALUES (?, ?, ?, ?, ?)',
    [bookingId, fromStatus, toStatus, actorUserId, reason || null]);
}

export async function listEvents(bookingId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT e.from_status, e.to_status, e.reason, e.created_at, u.role AS actor_role
       FROM booking_status_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.booking_id = ? ORDER BY e.id`, [bookingId]);
  return rows;
}

/** Bookings past their response/payment deadline. */
export async function findExpired(statuses, conn = pool) {
  const [rows] = await conn.query(
    'SELECT id, reference, status, customer_id FROM bookings WHERE status IN (?) AND expires_at IS NOT NULL AND expires_at <= NOW()',
    [statuses]);
  return rows;
}

/** Linked follow-on bookings (e.g. a full purchase created from a sample run). */
export async function listLinked(sourceBookingId, conn = pool) {
  const [rows] = await conn.query('SELECT reference, booking_type, status FROM bookings WHERE source_booking_id = ?', [sourceBookingId]);
  return rows;
}

/** Catalogue item ids in a customer's open bookings (used to silence stale restock reminders). */
export async function openItemIdsForCustomer(customerId, statuses, conn = pool) {
  const [rows] = await conn.query(
    `SELECT DISTINCT bi.catalog_item_id FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
      WHERE b.customer_id = ? AND b.status IN (?) AND bi.catalog_item_id IS NOT NULL`, [customerId, statuses]);
  return rows.map((r) => r.catalog_item_id);
}
