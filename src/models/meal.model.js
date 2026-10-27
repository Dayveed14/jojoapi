// meals + meal_options
import { pool } from '../db/pool.js';

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

async function attachOptions(meals, { includeInactive }, conn) {
  if (!meals.length) return [];
  const [opts] = await conn.query(
    `SELECT * FROM meal_options WHERE meal_id IN (?) ${includeInactive ? '' : 'AND active = 1'} ORDER BY sort, price`, [meals.map((m) => m.id)]);
  const by = {};
  for (const o of opts) (by[o.meal_id] ||= []).push(o);
  return meals.map((m) => ({ ...m, allowed_exclusions: parse(m.allowed_exclusions) || [], options: by[m.id] || [] }));
}

export async function list({ includeInactive = false } = {}, conn = pool) {
  const [rows] = await conn.query(`SELECT * FROM meals ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, name`);
  return attachOptions(rows, { includeInactive }, conn);
}

export async function findById(id, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM meals WHERE id = ?', [id]);
  return rows[0] ? (await attachOptions(rows, { includeInactive: true }, conn))[0] : null;
}

export async function findManyWithOptions(ids, conn = pool) {
  if (!ids.length) return new Map();
  const [rows] = await conn.query('SELECT * FROM meals WHERE id IN (?)', [ids]);
  const full = await attachOptions(rows, { includeInactive: true }, conn);
  return new Map(full.map((m) => [m.id, m]));
}

export async function create(m, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO meals (slug, name, category, description, illustration, allowed_exclusions, spice_levels, contains, featured, active, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.slug, m.name, m.category, m.description || null, m.illustration || null, JSON.stringify(m.allowedExclusions || []),
      m.spiceLevels ? 1 : 0, m.contains || null, m.featured ? 1 : 0, m.active ? 1 : 0, m.sort || 0]);
  return res.insertId;
}

export async function update(id, m, conn = pool) {
  await conn.query(
    `UPDATE meals SET slug = ?, name = ?, category = ?, description = ?, illustration = ?, allowed_exclusions = ?, spice_levels = ?,
            contains = ?, featured = ?, active = ?, sort = ? WHERE id = ?`,
    [m.slug, m.name, m.category, m.description || null, m.illustration || null, JSON.stringify(m.allowedExclusions || []),
      m.spiceLevels ? 1 : 0, m.contains || null, m.featured ? 1 : 0, m.active ? 1 : 0, m.sort || 0, id]);
}

export async function setImage(id, url, publicId, conn = pool) {
  await conn.query('UPDATE meals SET image_url = ?, image_public_id = ? WHERE id = ?', [url, publicId, id]);
}

export async function createOption(mealId, o, conn = pool) {
  await conn.query('INSERT INTO meal_options (meal_id, label, serves, price, portions, is_bulk, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [mealId, o.label, o.serves || null, o.price, o.portions, o.isBulk ? 1 : 0, o.active ? 1 : 0, o.sort || 0]);
}

export async function updateOption(id, mealId, o, conn = pool) {
  await conn.query('UPDATE meal_options SET label = ?, serves = ?, price = ?, portions = ?, is_bulk = ?, active = ?, sort = ? WHERE id = ? AND meal_id = ?',
    [o.label, o.serves || null, o.price, o.portions, o.isBulk ? 1 : 0, o.active ? 1 : 0, o.sort || 0, id, mealId]);
}

export async function deactivateOption(id, conn = pool) {
  await conn.query('UPDATE meal_options SET active = 0 WHERE id = ?', [id]);
}
