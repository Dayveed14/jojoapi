// Jojo's Kitchen: lead-time rules (pure), then the order lifecycle against the real database.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';

process.env.PAYSTACK_SECRET_KEY = 'sk_test_jojo_dummy_key';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { env } = await import('../src/config/env.js');
const paymentService = await import('../src/services/payment.service.js');
const settingsService = await import('../src/services/settings.service.js');
const schedule = await import('../src/services/kitchenSchedule.service.js');
const expireJob = await import('../src/jobs/expireBookings.job.js');
const bcrypt = (await import('bcryptjs')).default;

const fakePaystack = {
  sessions: new Map(),
  async initialize({ amountKobo, reference }) { this.sessions.set(reference, amountKobo); return { authorizationUrl: `https://pay.test/${reference}` }; },
  async verify(reference) { return { status: 'success', amountKobo: this.sessions.get(reference), currency: 'NGN', channel: 'card', id: 1 }; },
  verifySignature(raw, sig) { return crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(raw).digest('hex') === sig; },
};
paymentService.setProvider(fakePaystack);

const cfg = settingsService.DEFAULTS.kitchen;
// Lagos is UTC+1: 09:00 Lagos on Tue 4 Nov 2025 = 08:00Z.
const lagos = (date, hhmm) => new Date(`${date}T${hhmm}:00+01:00`);

describe('lead-time rules', () => {
  test('before 10am → tomorrow, from the same time (morning window still open)', () => {
    const e = schedule.earliestDelivery(lagos('2025-11-04', '09:00'), cfg);
    assert.equal(e.date, '2025-11-05');
    assert.equal(e.rule, 'next_day');
    assert.deepEqual(schedule.windowsFor(e.date, e, cfg).map((w) => w.key), ['morning', 'afternoon', 'evening']);
  });
  test('10am–noon → tomorrow + 4 hours', () => {
    const e = schedule.earliestDelivery(lagos('2025-11-04', '11:00'), cfg);
    assert.equal(e.date, '2025-11-05');
    assert.equal(e.minutes, 15 * 60);
    assert.deepEqual(schedule.windowsFor(e.date, e, cfg).map((w) => w.key), ['evening']);
    // the day after has every window
    assert.equal(schedule.windowsFor('2025-11-06', e, cfg).length, 3);
  });
  test('from noon → the day after tomorrow, any window', () => {
    for (const t of ['12:00', '17:30', '23:59']) {
      const e = schedule.earliestDelivery(lagos('2025-11-04', t), cfg);
      assert.equal(e.date, '2025-11-06', t);
      assert.equal(schedule.windowsFor(e.date, e, cfg).length, 3);
    }
    assert.deepEqual(schedule.windowsFor('2025-11-05', schedule.earliestDelivery(lagos('2025-11-04', '12:00'), cfg), cfg), []);
  });
  test('bulk orders get an extra day', () => {
    const e = schedule.earliestDelivery(lagos('2025-11-04', '09:00'), cfg, { isBulk: true });
    assert.equal(e.date, '2025-11-06');
    assert.match(schedule.leadTimeMessage(e, cfg, true), /Bulk orders need 1 extra day/);
  });
  test('Sundays are closed by default; a capacity override opens them', () => {
    assert.equal(schedule.capacityFor('2025-11-09', cfg, null), 0);
    assert.equal(schedule.capacityFor('2025-11-09', cfg, { override_type: 'capacity', capacity_portions: 10 }), 10);
    assert.equal(schedule.capacityFor('2025-11-10', cfg, { override_type: 'blocked' }), 0);
  });
  test('express time checks: notice, hours', () => {
    const now = lagos('2025-11-04', '09:00');
    assert.match(schedule.checkExpressTime(lagos('2025-11-04', '10:00'), now, cfg), /3 hours/);
    assert.match(schedule.checkExpressTime(lagos('2025-11-04', '21:30'), now, cfg), /between/);
    assert.equal(schedule.checkExpressTime(lagos('2025-11-04', '14:30'), now, cfg), null);
  });
});

let server; let base;
const stamp = Date.now();
const call = async (path, { method = 'GET', body, token, headers = {}, raw } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const ctx = {};

describe('kitchen orders', () => {
  before(async () => {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    const reg = async (n) => (await call('/api/auth/register', { method: 'POST', body: { displayName: `Cook ${n}`, email: `cook+${n}${stamp}@example.com`, password: 'Market2026x', acceptTerms: true } })).body.accessToken;
    ctx.cust = await reg('a');
    ctx.other = await reg('b');
    const opEmail = `cook+op${stamp}@example.com`;
    await pool.query("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'operator')", [opEmail, await bcrypt.hash('OperatorPass1', 10)]);
    ctx.op = (await call('/api/auth/login', { method: 'POST', body: { email: opEmail, password: 'OperatorPass1', portal: 'admin' } })).body.accessToken;
    const areas = (await call('/api/areas')).body.items;
    await call('/api/me/addresses', { method: 'POST', token: ctx.cust, body: { label: 'Home', recipientName: 'Cook A', recipientPhone: '08031112222', addressLine: '12 Adeniran Ogunsanya St', areaId: areas.find((a) => a.name === 'Surulere').id } });
    ctx.addr = (await call('/api/me/addresses', { token: ctx.cust })).body.items[0].id;
    const menu = (await call('/api/kitchen/menu')).body;
    ctx.jollof = menu.meals.find((m) => m.slug === 'party-jollof');
    ctx.egusi = menu.meals.find((m) => m.slug === 'egusi');
    ctx.plate = ctx.jollof.options.find((o) => o.label === 'Plate');
    ctx.cooler = ctx.jollof.options.find((o) => o.isBulk);
  });

  after(async () => {
    const [users] = await pool.query("SELECT id FROM users WHERE email LIKE 'cook+%'");
    const ids = users.map((u) => u.id);
    if (ids.length) {
      await pool.query('DELETE FROM payment_transactions WHERE customer_id IN (?)', [ids]);
      await pool.query('DELETE FROM kitchen_orders WHERE customer_id IN (?)', [ids]);
      await pool.query('DELETE FROM users WHERE id IN (?)', [ids]);
    }
    if (ctx.blocked) await pool.query('DELETE FROM kitchen_day_overrides WHERE override_date = ?', [ctx.blocked]);
    server.close();
    await pool.end();
  });

  test('menu is public and lists dishes with sizes and allowed exclusions', () => {
    assert.ok(ctx.jollof && ctx.plate && ctx.cooler);
    assert.ok(ctx.jollof.exclusions.some((e) => e.key === 'no_garlic'));
  });

  test('quote prices the order, flags bulk and returns bookable days', async () => {
    const q = await call('/api/kitchen/quote', { method: 'POST', token: ctx.cust, body: { addressId: ctx.addr, items: [{ mealId: ctx.jollof.id, optionId: ctx.plate.id, quantity: 2, exclusions: ['no_garlic', 'no_ginger'], spiceLevel: 'mild' }] } });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.subtotal, 7000);
    assert.equal(q.body.isBulk, false);
    assert.ok(q.body.deliveryFee > 0);
    assert.ok(q.body.days.some((d) => d.available));
    ctx.day = q.body.days.find((d) => d.available);
    const bulk = await call('/api/kitchen/quote', { method: 'POST', token: ctx.cust, body: { items: [{ mealId: ctx.jollof.id, optionId: ctx.cooler.id, quantity: 1 }] } });
    assert.equal(bulk.body.isBulk, true);
    assert.ok(bulk.body.earliest.date > q.body.earliest.date);
  });

  test('exclusions a dish does not support are rejected', async () => {
    const r = await call('/api/kitchen/quote', { method: 'POST', token: ctx.cust, body: { items: [{ mealId: ctx.egusi.id, optionId: ctx.egusi.options[0].id, quantity: 1, exclusions: ['no_nuts'] }] } });
    assert.equal(r.status, 400);
    const unknown = await call('/api/kitchen/quote', { method: 'POST', token: ctx.cust, body: { items: [{ mealId: ctx.egusi.id, optionId: ctx.egusi.options[0].id, quantity: 1, exclusions: ['no_love'] }] } });
    assert.equal(unknown.status, 400);
  });

  test('regular order: awaits payment, pays online, becomes confirmed; others cannot see it', async () => {
    const r = await call('/api/kitchen/orders', { method: 'POST', token: ctx.cust, body: {
      orderType: 'regular', addressId: ctx.addr, deliveryDate: ctx.day.date, deliveryWindow: ctx.day.windows.at(-1).key, acceptTerms: true,
      items: [{ mealId: ctx.jollof.id, optionId: ctx.plate.id, quantity: 2, exclusions: ['no_garlic'], spiceLevel: 'mild' }], allergyNotes: 'No groundnut oil please',
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ctx.ref = r.body.reference;
    assert.match(ctx.ref, /^JK-/);
    const d = (await call(`/api/kitchen/orders/${ctx.ref}`, { token: ctx.cust })).body.order;
    assert.equal(d.status, 'awaiting_payment');
    assert.equal(d.amountDue.amount, d.total);
    assert.deepEqual(d.items[0].exclusions, ['No garlic']);
    assert.equal((await call(`/api/kitchen/orders/${ctx.ref}`, { token: ctx.other })).status, 404);
    assert.equal((await call(`/api/kitchen/orders/${ctx.ref}/pay/online`, { method: 'POST', token: ctx.other })).status, 404);

    const start = await call(`/api/kitchen/orders/${ctx.ref}/pay/online`, { method: 'POST', token: ctx.cust });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const v = await call('/api/payments/verify', { method: 'POST', token: ctx.cust, body: { reference: start.body.reference } });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.equal(v.body.kitchenReference, ctx.ref);
    const after = (await call(`/api/kitchen/orders/${ctx.ref}`, { token: ctx.cust })).body.order;
    assert.equal(after.status, 'confirmed');
    assert.equal(after.amountDue.amount, 0);
    assert.equal(after.canCancel, false);
  });

  test('operator moves it through preparing → cooking → out for delivery → delivered (no skipping back)', async () => {
    for (const to of ['preparing', 'cooking', 'out_for_delivery', 'delivered']) {
      const r = await call(`/api/admin/kitchen/orders/${ctx.ref}/advance`, { method: 'POST', token: ctx.op, body: { to } });
      assert.equal(r.status, 200, `${to}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.order.status, to);
    }
    const back = await call(`/api/admin/kitchen/orders/${ctx.ref}/advance`, { method: 'POST', token: ctx.op, body: { to: 'cooking' } });
    assert.equal(back.status, 409);
    assert.equal((await call(`/api/admin/kitchen/orders/${ctx.ref}`, { token: ctx.cust })).status, 403);
  });

  test('express: request → Jojo approves with fee → pay → confirmed', async () => {
    // a valid express time: 2 days ahead, 2:30pm Lagos
    const d = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const when = `${d}T14:30:00+01:00`;
    const r = await call('/api/kitchen/orders', { method: 'POST', token: ctx.cust, body: {
      orderType: 'express', addressId: ctx.addr, requestedDeliveryAt: when, acceptTerms: true,
      items: [{ mealId: ctx.egusi.id, optionId: ctx.egusi.options[0].id, quantity: 1, exclusions: ['no_crayfish'] }],
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const ref = r.body.reference;
    let o = (await call(`/api/kitchen/orders/${ref}`, { token: ctx.cust })).body.order;
    assert.equal(o.status, 'express_requested');
    assert.equal(o.amountDue.amount, 0); // nothing to pay until Jojo approves
    assert.equal((await call(`/api/kitchen/orders/${ref}/pay/online`, { method: 'POST', token: ctx.cust })).status, 409);

    const list = await call('/api/admin/kitchen/orders?scope=express', { token: ctx.op });
    assert.ok(list.body.items.some((x) => x.reference === ref));
    const ap = await call(`/api/admin/kitchen/orders/${ref}/approve`, { method: 'POST', token: ctx.op, body: { expressFee: 5000, deliveryFee: 2500, note: 'Fresh catfish today' } });
    assert.equal(ap.status, 200, JSON.stringify(ap.body));
    assert.equal(ap.body.order.status, 'awaiting_payment');
    assert.equal(ap.body.order.total, 12000 + 5000 + 2500);

    const start = await call(`/api/kitchen/orders/${ref}/pay/online`, { method: 'POST', token: ctx.cust });
    await call('/api/payments/verify', { method: 'POST', token: ctx.cust, body: { reference: start.body.reference } });
    o = (await call(`/api/kitchen/orders/${ref}`, { token: ctx.cust })).body.order;
    assert.equal(o.status, 'confirmed');
    assert.match(o.deliveryText, /2:30pm/);
  });

  test('declined express request cannot be paid', async () => {
    const d = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const r = await call('/api/kitchen/orders', { method: 'POST', token: ctx.cust, body: {
      orderType: 'express', addressId: ctx.addr, requestedDeliveryAt: `${d}T12:00:00+01:00`, acceptTerms: true,
      items: [{ mealId: ctx.jollof.id, optionId: ctx.plate.id, quantity: 1 }],
    } });
    const dec = await call(`/api/admin/kitchen/orders/${r.body.reference}/decline`, { method: 'POST', token: ctx.op, body: { reason: 'Already fully booked that afternoon' } });
    assert.equal(dec.body.order.status, 'declined');
    assert.equal((await call(`/api/kitchen/orders/${r.body.reference}/pay/online`, { method: 'POST', token: ctx.cust })).status, 409);
  });

  test('a blocked or full day cannot be booked', async () => {
    ctx.blocked = ctx.day.date;
    await call('/api/admin/kitchen/calendar', { method: 'POST', token: ctx.op, body: { date: ctx.blocked, type: 'blocked', reason: 'Wedding catering' } });
    const q = await call('/api/kitchen/quote', { method: 'POST', token: ctx.cust, body: { items: [{ mealId: ctx.jollof.id, optionId: ctx.plate.id, quantity: 1 }] } });
    const day = q.body.days.find((x) => x.date === ctx.blocked);
    assert.equal(day.available, false);
    const r = await call('/api/kitchen/orders', { method: 'POST', token: ctx.cust, body: {
      orderType: 'regular', addressId: ctx.addr, deliveryDate: ctx.blocked, deliveryWindow: 'evening', acceptTerms: true,
      items: [{ mealId: ctx.jollof.id, optionId: ctx.plate.id, quantity: 1 }],
    } });
    assert.equal(r.status, 409);
    await call('/api/admin/kitchen/calendar', { method: 'POST', token: ctx.op, body: { date: ctx.blocked, type: 'capacity', capacityPortions: 3 } });
    const big = await call('/api/kitchen/orders', { method: 'POST', token: ctx.cust, body: {
      orderType: 'regular', addressId: ctx.addr, deliveryDate: ctx.blocked, deliveryWindow: 'evening', acceptTerms: true,
      items: [{ mealId: ctx.jollof.id, optionId: ctx.plate.id, quantity: 4 }],
    } });
    assert.equal(big.status, 409);
    assert.match(big.body.error.message, /fully booked/);
  });

  test('customer can cancel an unpaid order; unpaid orders expire', async () => {
    await call('/api/admin/kitchen/calendar', { method: 'POST', token: ctx.op, body: { date: ctx.blocked, type: 'clear' } });
    const mk = async () => (await call('/api/kitchen/orders', { method: 'POST', token: ctx.cust, body: {
      orderType: 'regular', addressId: ctx.addr, deliveryDate: ctx.day.date, deliveryWindow: ctx.day.windows.at(-1).key, acceptTerms: true,
      items: [{ mealId: ctx.jollof.id, optionId: ctx.plate.id, quantity: 1 }],
    } })).body.reference;
    const a = await mk();
    const c = await call(`/api/kitchen/orders/${a}/cancel`, { method: 'POST', token: ctx.cust, body: {} });
    assert.equal(c.body.order.status, 'cancelled');
    const b = await mk();
    await pool.query('UPDATE kitchen_orders SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE reference = ?', [b]);
    await expireJob.run();
    assert.equal((await call(`/api/kitchen/orders/${b}`, { token: ctx.cust })).body.order.status, 'expired');
  });

  test('cooking sheet groups the day’s dishes with their exclusions', async () => {
    const r = await call(`/api/admin/kitchen/sheet?date=${ctx.day.date}`, { token: ctx.op });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(Array.isArray(r.body.orders));
  });
});
