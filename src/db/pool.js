import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
  dateStrings: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
  decimalNumbers: false, // keep DECIMAL money values as strings
});

const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/**
 * Run fn inside a transaction; commits on success, rolls back on throw.
 * Deadlocks are retried (up to 3 attempts) — fn must not have side effects outside the database.
 */
export async function withTransaction(fn, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (RETRYABLE.has(err.code) && attempt < attempts) {
        await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 50));
        continue;
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}
