import { pool } from '../db/pool.js';

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

export async function getAll(conn = pool) {
  const [rows] = await conn.query('SELECT setting_key, value_json FROM service_settings');
  return Object.fromEntries(rows.map((r) => [r.setting_key, parse(r.value_json)]));
}

export async function upsert(key, value, userId = null, conn = pool) {
  await conn.query(
    `INSERT INTO service_settings (setting_key, value_json, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by = VALUES(updated_by)`,
    [key, JSON.stringify(value), userId]);
}
