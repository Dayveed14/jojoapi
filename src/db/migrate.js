// Applies db/migrations/*.sql in order and records each in schema_migrations.
//
// If you imported a migration by hand (e.g. in phpMyAdmin), this notices its tables already exist
// and just records it as applied instead of running it twice.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { dbSsl, env } from '../config/env.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// A table each migration creates. If it already exists, the migration was imported manually.
const MARKER_TABLE = {
  '001_identity.sql': 'users',
  '002_operations.sql': 'bookings',
  '003_kitchen.sql': 'kitchen_orders',
};

const conn = await mysql.createConnection({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  ssl: dbSsl,
  multipleStatements: true, // migrations only; the app pool never enables this
});

await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

const [rows] = await conn.query('SELECT name FROM schema_migrations');
const applied = new Set(rows.map((r) => r.name));
const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) continue;
  const marker = MARKER_TABLE[file];
  if (marker) {
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [env.DB_NAME, marker]);
    if (Number(n) > 0) {
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      console.log(`${file}: tables already exist (imported manually?) — marked as applied`);
      continue;
    }
  }
  const sql = await fs.readFile(path.join(dir, file), 'utf8');
  process.stdout.write(`Applying ${file} ... `);
  await conn.query(sql);
  await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
  console.log('done');
}

console.log('Migrations up to date.');
await conn.end();
