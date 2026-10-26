import { pool } from '../db/pool.js';

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

function shape(row, categories = []) {
  return row && { ...row, open_days: parse(row.open_days), category_ids: categories };
}

async function categoryMap(marketIds, conn) {
  if (!marketIds.length) return {};
  const [rows] = await conn.query('SELECT market_id, category_id FROM market_categories WHERE market_id IN (?)', [marketIds]);
  const map = {};
  for (const r of rows) (map[r.market_id] ||= []).push(r.category_id);
  return map;
}

export async function list({ includeInactive = false } = {}, conn = pool) {
  const [rows] = await conn.query(`SELECT * FROM markets ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, name`);
  const cats = await categoryMap(rows.map((r) => r.id), conn);
  return rows.map((r) => shape(r, cats[r.id] || []));
}

export async function findById(id, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM markets WHERE id = ?', [id]);
  if (!rows[0]) return null;
  const cats = await categoryMap([id], conn);
  return shape(rows[0], cats[id] || []);
}

export async function create(m, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO markets (slug, name, area, city, lat, lng, public_description, open_days, opens_at, closes_at, internal_notes, active, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.slug, m.name, m.area, m.city || 'Lagos', m.lat, m.lng, m.publicDescription || null, JSON.stringify(m.openDays),
      m.opensAt, m.closesAt, m.internalNotes || null, m.active ? 1 : 0, m.sort || 0]);
  return res.insertId;
}

export async function update(id, m, conn = pool) {
  await conn.query(
    `UPDATE markets SET slug = ?, name = ?, area = ?, city = ?, lat = ?, lng = ?, public_description = ?, open_days = ?,
            opens_at = ?, closes_at = ?, internal_notes = ?, active = ?, sort = ? WHERE id = ?`,
    [m.slug, m.name, m.area, m.city || 'Lagos', m.lat, m.lng, m.publicDescription || null, JSON.stringify(m.openDays),
      m.opensAt, m.closesAt, m.internalNotes || null, m.active ? 1 : 0, m.sort || 0, id]);
}

export async function setCategories(marketId, categoryIds, conn = pool) {
  await conn.query('DELETE FROM market_categories WHERE market_id = ?', [marketId]);
  if (categoryIds.length) {
    await conn.query('INSERT INTO market_categories (market_id, category_id) VALUES ?', [categoryIds.map((c) => [marketId, c])]);
  }
}
