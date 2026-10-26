import { pool } from '../db/pool.js';

export async function listActive(conn = pool) {
  const [rows] = await conn.query('SELECT id, name, lga, state FROM areas WHERE active = 1 ORDER BY name');
  return rows;
}

/** Includes coordinates — server-side use only (transport estimates). */
export async function findById(id, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM areas WHERE id = ?', [id]);
  return rows[0] || null;
}
