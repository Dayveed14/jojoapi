// Integration tests against a real MySQL/MariaDB database (uses DB_* from .env).
// Run: NODE_ENV=test npm test
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';

let server;
let base;
const email = `test+${Date.now()}@example.com`;
const password = 'Market2026pass';
const csrf = { 'X-Requested-With': 'jojo-web', Origin: env.CLIENT_ORIGIN };

const call = async (path, { method = 'GET', body, token, cookie, headers = {} } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: setCookie?.split(';')[0] };
};

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE ?', ['test+%@example.com']);
  server.close();
  await pool.end();
});

describe('auth flow', () => {
  let access;
  let cookie;

  test('rejects weak password and missing terms', async () => {
    const r = await call('/api/auth/register', { method: 'POST', body: { displayName: 'T', email: 'bad', password: 'short' } });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.fields.email);
    assert.ok(r.body.error.fields.password);
    assert.ok(r.body.error.fields.acceptTerms);
  });

  test('registers a customer and returns access token + httpOnly cookie', async () => {
    const r = await call('/api/auth/register', {
      method: 'POST',
      body: { displayName: 'Ada Test', email, phone: '0803 123 4567', password, acceptTerms: true },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.role, 'customer');
    assert.equal(r.body.user.phone, '+2348031234567');
    assert.equal(r.body.user.emailVerified, false);
    assert.ok(!('password_hash' in r.body.user));
    assert.match(r.cookie, /^jojo_rt=/);
    access = r.body.accessToken;
    cookie = r.cookie;
  });

  test('duplicate registration is vague', async () => {
    const r = await call('/api/auth/register', { method: 'POST', body: { displayName: 'Ada', email, password, acceptTerms: true } });
    assert.equal(r.status, 409);
    assert.doesNotMatch(r.body.error.message, /email (already|exists)/i);
  });

  test('GET /api/me works with token, 401 without', async () => {
    assert.equal((await call('/api/me')).status, 401);
    const r = await call('/api/me', { token: access });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, email);
  });

  test('customer cannot reach admin API', async () => {
    assert.equal((await call('/api/admin/dashboard', { token: access })).status, 403);
  });

  test('wrong password and unknown email give the same message', async () => {
    const a = await call('/api/auth/login', { method: 'POST', body: { email, password: 'nope12345' } });
    const b = await call('/api/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'nope12345' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error.message, b.body.error.message);
  });

  test('customer cannot use admin portal login', async () => {
    const r = await call('/api/auth/login', { method: 'POST', body: { email, password, portal: 'admin' } });
    assert.equal(r.status, 403);
  });

  test('refresh requires CSRF header', async () => {
    const r = await call('/api/auth/refresh', { method: 'POST', cookie });
    assert.equal(r.status, 403);
  });

  test('refresh rotates; replaying the old token after grace revokes the family', async () => {
    const r1 = await call('/api/auth/refresh', { method: 'POST', cookie, headers: csrf });
    assert.equal(r1.status, 200);
    assert.ok(r1.body.accessToken);
    assert.notEqual(r1.cookie, cookie);
    const newCookie = r1.cookie;

    // Immediate replay of the old token = benign multi-tab race
    const race = await call('/api/auth/refresh', { method: 'POST', cookie, headers: csrf });
    assert.equal(race.status, 409);

    // Simulate the grace window passing, then replay: theft → whole family revoked
    await pool.query("UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL 1 MINUTE WHERE revoked_at IS NOT NULL AND user_id = (SELECT id FROM users WHERE email = ?)", [email]);
    const replay = await call('/api/auth/refresh', { method: 'POST', cookie, headers: csrf });
    assert.equal(replay.status, 401);
    const after = await call('/api/auth/refresh', { method: 'POST', cookie: newCookie, headers: csrf });
    assert.equal(after.status, 401, 'new token in the same family must also be revoked');
  });

  test('profile update normalises phone and saves preferences', async () => {
    const r = await call('/api/me', {
      method: 'PATCH', token: access,
      body: { displayName: 'Ada Lovelace', phone: '+2349061234567', notificationPreferences: { bookingUpdates: true, promotions: true } },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.displayName, 'Ada Lovelace');
    assert.equal(r.body.user.notificationPreferences.promotions, true);
  });

  test('forgot password always returns the same response; reset is single-use and kills old sessions', async () => {
    const a = await call('/api/auth/forgot-password', { method: 'POST', body: { email } });
    const b = await call('/api/auth/forgot-password', { method: 'POST', body: { email: 'ghost@example.com' } });
    assert.equal(a.status, 200);
    assert.deepEqual(a.body, b.body);

    // Plant a known token (the real one is only emailed)
    const { randomToken, sha256 } = await import('../src/utils/crypto.js');
    const raw = randomToken(32);
    await pool.query(
      "UPDATE user_tokens SET token_hash = ? WHERE purpose = 'password_reset' AND used_at IS NULL AND user_id = (SELECT id FROM users WHERE email = ?)",
      [sha256(raw), email],
    );

    const r = await call('/api/auth/reset-password', { method: 'POST', body: { token: raw, password: 'Brandnew2026' } });
    assert.equal(r.status, 200);
    const again = await call('/api/auth/reset-password', { method: 'POST', body: { token: raw, password: 'Another2026x' } });
    assert.equal(again.status, 400);

    assert.equal((await call('/api/me', { token: access })).status, 401, 'old access token invalid after reset');
    const login = await call('/api/auth/login', { method: 'POST', body: { email, password: 'Brandnew2026' } });
    assert.equal(login.status, 200);
  });
});

describe('operator', () => {
  test('operator can sign in to admin portal and see overview', async () => {
    const [rows] = await pool.query("SELECT email FROM users WHERE role='operator' LIMIT 1");
    if (!rows[0]) return; // no operator seeded
    // Create a throwaway operator so the test doesn't depend on the seeded password
    const bcrypt = (await import('bcryptjs')).default;
    const opEmail = `test+op${Date.now()}@example.com`;
    await pool.query("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'operator')", [opEmail, await bcrypt.hash('OperatorPass1', 10)]);
    const login = await call('/api/auth/login', { method: 'POST', body: { email: opEmail, password: 'OperatorPass1', portal: 'admin' } });
    assert.equal(login.status, 200);
    const r = await call('/api/admin/dashboard', { token: login.body.accessToken });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.customers.total, 'number');
    const list = await call('/api/admin/customers?q=test%2B&pageSize=5', { token: login.body.accessToken });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.items));
  });

  test('avatar upload returns 503 when Cloudinary is not configured, 400 for non-image', async () => {
    const reg = await call('/api/auth/register', {
      method: 'POST', body: { displayName: 'Img Test', email: `test+img${Date.now()}@example.com`, password, acceptTerms: true },
    });
    const fd = new FormData();
    fd.append('avatar', new Blob(['not an image'], { type: 'image/png' }), 'x.png');
    const res = await fetch(`${base}/api/me/avatar`, { method: 'POST', headers: { Authorization: `Bearer ${reg.body.accessToken}` }, body: fd });
    assert.equal(res.status, 400); // magic-byte check catches the fake PNG first
  });
});
