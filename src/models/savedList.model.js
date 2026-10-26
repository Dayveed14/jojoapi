import { pool } from '../db/pool.js';

export async function listForCustomer(customerId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT s.*, m.name AS market_name, (SELECT COUNT(*) FROM saved_list_items i WHERE i.saved_list_id = s.id) AS item_count
       FROM saved_lists s LEFT JOIN markets m ON m.id = s.market_id
      WHERE s.customer_id = ? ORDER BY s.updated_at DESC`, [customerId]);
  return rows;
}

export async function findForCustomer(id, customerId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM saved_lists WHERE id = ? AND customer_id = ?', [id, customerId]);
  return rows[0] || null;
}

export async function listItems(listId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM saved_list_items WHERE saved_list_id = ? ORDER BY sort, id', [listId]);
  return rows;
}

export async function create(customerId, { name, marketId }, conn = pool) {
  const [res] = await conn.query('INSERT INTO saved_lists (customer_id, name, market_id) VALUES (?, ?, ?)', [customerId, name, marketId ?? null]);
  return res.insertId;
}

export async function update(id, customerId, { name, marketId }, conn = pool) {
  await conn.query('UPDATE saved_lists SET name = ?, market_id = ?, updated_at = NOW() WHERE id = ? AND customer_id = ?', [name, marketId ?? null, id, customerId]);
}

export async function replaceItems(listId, items, conn = pool) {
  await conn.query('DELETE FROM saved_list_items WHERE saved_list_id = ?', [listId]);
  if (!items.length) return;
  await conn.query(
    `INSERT INTO saved_list_items (saved_list_id, catalog_item_id, option_id, item_name, request_method, quantity, amount, preferences, allow_substitution, sort)
     VALUES ?`,
    [items.map((i, idx) => [listId, i.catalogItemId ?? null, i.optionId ?? null, i.itemName, i.requestMethod, i.quantity ?? null,
      i.amount ?? null, i.preferences || null, i.allowSubstitution ? 1 : 0, idx])]);
}

export async function remove(id, customerId, conn = pool) {
  await conn.query('DELETE FROM saved_lists WHERE id = ? AND customer_id = ?', [id, customerId]);
}
