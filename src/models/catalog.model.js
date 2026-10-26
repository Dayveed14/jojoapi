// catalog_categories, catalog_items, catalog_item_options, option_price_history
import { pool } from '../db/pool.js';

export async function listCategories({ includeInactive = false } = {}, conn = pool) {
  const [rows] = await conn.query(`SELECT * FROM catalog_categories ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, name`);
  return rows;
}

export async function createCategory(c, conn = pool) {
  const [res] = await conn.query('INSERT INTO catalog_categories (slug, name, icon, sort, active) VALUES (?, ?, ?, ?, ?)',
    [c.slug, c.name, c.icon || null, c.sort || 0, c.active ? 1 : 0]);
  return res.insertId;
}

export async function updateCategory(id, c, conn = pool) {
  await conn.query('UPDATE catalog_categories SET slug = ?, name = ?, icon = ?, sort = ?, active = ? WHERE id = ?',
    [c.slug, c.name, c.icon || null, c.sort || 0, c.active ? 1 : 0, id]);
}

/** Items with their options. Filter by category ids (e.g. the categories a market supports). */
export async function listItems({ categoryIds, includeInactive = false, q } = {}, conn = pool) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('i.active = 1');
  if (categoryIds) {
    if (!categoryIds.length) return [];
    where.push('i.category_id IN (?)');
    params.push(categoryIds);
  }
  if (q) {
    where.push('(i.name LIKE ? OR i.search_terms LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const [items] = await conn.query(
    `SELECT i.*, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon
       FROM catalog_items i JOIN catalog_categories c ON c.id = i.category_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.sort, i.sort, i.name`, params);
  if (!items.length) return [];
  const [options] = await conn.query(
    `SELECT * FROM catalog_item_options WHERE item_id IN (?) ${includeInactive ? '' : 'AND active = 1'} ORDER BY sort, id`,
    [items.map((i) => i.id)]);
  const byItem = {};
  for (const o of options) (byItem[o.item_id] ||= []).push(o);
  return items.map((i) => ({ ...i, options: byItem[i.id] || [] }));
}

export async function findItem(id, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM catalog_items WHERE id = ?', [id]);
  if (!rows[0]) return null;
  const [options] = await conn.query('SELECT * FROM catalog_item_options WHERE item_id = ? ORDER BY sort, id', [id]);
  return { ...rows[0], options };
}

/** Bulk-load items + options by id (for pricing a booking). */
export async function findItemsWithOptions(itemIds, conn = pool) {
  if (!itemIds.length) return new Map();
  const [items] = await conn.query('SELECT * FROM catalog_items WHERE id IN (?)', [itemIds]);
  const [options] = await conn.query('SELECT * FROM catalog_item_options WHERE item_id IN (?)', [itemIds]);
  const map = new Map(items.map((i) => [i.id, { ...i, options: [] }]));
  for (const o of options) map.get(o.item_id)?.options.push(o);
  return map;
}

export async function createItem(i, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO catalog_items (category_id, name, description, search_terms, allow_open_amount, allow_substitutions, restock_days, active, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [i.categoryId, i.name, i.description || null, i.searchTerms || null, i.allowOpenAmount ? 1 : 0,
      i.allowSubstitutions ? 1 : 0, i.restockDays || null, i.active ? 1 : 0, i.sort || 0]);
  return res.insertId;
}

export async function updateItem(id, i, conn = pool) {
  await conn.query(
    `UPDATE catalog_items SET category_id = ?, name = ?, description = ?, search_terms = ?, allow_open_amount = ?,
            allow_substitutions = ?, restock_days = ?, active = ?, sort = ? WHERE id = ?`,
    [i.categoryId, i.name, i.description || null, i.searchTerms || null, i.allowOpenAmount ? 1 : 0,
      i.allowSubstitutions ? 1 : 0, i.restockDays || null, i.active ? 1 : 0, i.sort || 0, id]);
}

export async function createOption(itemId, o, userId, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO catalog_item_options (item_id, unit_label, variant, price_type, price, price_min, price_max, allow_quantity, is_standard, sort, active, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [itemId, o.unitLabel, o.variant || null, o.priceType, o.price ?? null, o.priceMin ?? null, o.priceMax ?? null,
      o.allowQuantity ? 1 : 0, o.isStandard ? 1 : 0, o.sort || 0, o.active ? 1 : 0, userId]);
  return res.insertId;
}

export async function updateOption(id, o, userId, priceChanged, conn = pool) {
  await conn.query(
    `UPDATE catalog_item_options SET unit_label = ?, variant = ?, price_type = ?, price = ?, price_min = ?, price_max = ?,
            allow_quantity = ?, is_standard = ?, sort = ?, active = ?, updated_by = ?
            ${priceChanged ? ', price_updated_at = NOW()' : ''}
      WHERE id = ?`,
    [o.unitLabel, o.variant || null, o.priceType, o.price ?? null, o.priceMin ?? null, o.priceMax ?? null,
      o.allowQuantity ? 1 : 0, o.isStandard ? 1 : 0, o.sort || 0, o.active ? 1 : 0, userId, id]);
}

export async function findOption(id, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM catalog_item_options WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function insertPriceHistory(optionId, o, userId, conn = pool) {
  await conn.query(
    'INSERT INTO option_price_history (option_id, price_type, price, price_min, price_max, changed_by) VALUES (?, ?, ?, ?, ?, ?)',
    [optionId, o.priceType, o.price ?? null, o.priceMin ?? null, o.priceMax ?? null, userId]);
}

export async function clearStandard(itemId, conn = pool) {
  await conn.query('UPDATE catalog_item_options SET is_standard = 0 WHERE item_id = ?', [itemId]);
}
