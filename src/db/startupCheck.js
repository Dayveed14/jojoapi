// Runs once when the API starts and prints plain-English warnings in the logs (e.g. on Render).
import { env, isProd } from '../config/env.js';
import { pool } from './pool.js';

export async function startupCheck() {
  console.log(`Allowed site origin(s): ${env.CLIENT_ORIGINS.join(', ')}`);
  console.log(`Cookies: secure=${env.COOKIE_SECURE} sameSite=${env.COOKIE_SAMESITE} · trust proxy=${env.TRUST_PROXY}`);
  if (isProd && env.CLIENT_ORIGINS.some((o) => o.includes('localhost'))) {
    console.warn('⚠ CLIENT_ORIGIN still points at localhost. Set it to your live site, e.g. https://jojo-market.vercel.app');
  }
  if (isProd && env.TRUST_PROXY === 0) {
    console.warn('⚠ TRUST_PROXY=0 behind a host proxy: every visitor looks like one IP, so sign-in rate limits hit everyone. Use 1 on Render, 2 if Vercel proxies /api to Render.');
  }
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(`✗ Cannot connect to MySQL at ${env.DB_HOST}:${env.DB_PORT} (${err.code || err.message}). Check DB_HOST/DB_USER/DB_PASSWORD/DB_NAME${env.DB_SSL ? '' : ', and DB_SSL=true if your provider requires TLS'}.`);
    return;
  }
  try {
    const [[t]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('users','bookings','markets')", [env.DB_NAME]);
    if (Number(t.n) < 3) {
      console.warn('⚠ Database tables are missing. Run `npm run setup` against this database.');
      return;
    }
    const [[c]] = await pool.query("SELECT (SELECT COUNT(*) FROM users WHERE role = 'operator') AS operators, (SELECT COUNT(*) FROM markets WHERE active = 1) AS markets");
    if (!Number(c.markets)) console.warn('⚠ No markets in the database. Run `npm run seed` against this database.');
    if (!Number(c.operators)) console.warn('⚠ No operator account yet, so nobody can sign in to /admin. Run `npm run seed:admin` against this database.');
  } catch (err) {
    console.warn('startup check skipped:', err.message);
  }
}
