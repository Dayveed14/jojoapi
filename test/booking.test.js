// End-to-end booking lifecycle against a real MySQL/MariaDB database (run `npm run seed` first).
// Covers: pricing rules, ownership, quote → payment → shopping → limit enforcement → reconciliation → credit,
// double-booking under concurrency, Paystack webhook idempotency, expiry, and restock reminders.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';

process.env.PAYSTACK_SECRET_KEY = 'sk_test_jojo_dummy_key'; // enables the online path; provider is faked below

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { env } = await import('../src/config/env.js');
const paymentService = await import('../src/services/payment.service.js');
const pricing = await import('../src/services/pricing.service.js');
const restockService = await import('../src/services/restock.service.js');
const expireJob = await import('../src/jobs/expireBookings.job.js');
const bcrypt = (await import('bcryptjs')).default;

// Fake Paystack: remembers what was initialised, and "verifies" it as paid.
const fakePaystack = {
  sessions: new Map(),
  async initialize({ amountKobo, reference }) { this.sessions.set(reference, amountKobo); return { authorizationUrl: `https://pay.test/${reference}` }; },
  async verify(reference) { return { status: 'success', amountKobo: this.sessions.get(reference), currency: 'NGN', channel: 'card', id: 1 }; },
  verifySignature(raw, sig) { return crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(raw).digest('hex') === sig; },
};
paymentService.setProvider(fakePaystack);

let server; let base;
const stamp = Date.now();
const csrf = { 'X-Requested-With': 'jojo-web', Origin: env.CLIENT_ORIGIN };

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

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = async (n) => (await call('/api/auth/register', { method: 'POST', body: { displayName: `Flow ${n}`, email: `flow+${n}${stamp}@example.com`, password: 'Market2026x', acceptTerms: true } })).body.accessToken;
  ctx.cust = await reg('a');
  ctx.other = await reg('b');
  const opEmail = `flow+op${stamp}@example.com`;
  await pool.query("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'operator')", [opEmail, await bcrypt.hash('OperatorPass1', 10)]);
  ctx.op = (await call('/api/auth/login', { method: 'POST', body: { email: opEmail, password: 'OperatorPass1', portal: 'admin' } })).body.accessToken;

  const markets = (await call('/api/markets')).body.items;
  ctx.mile12 = markets.find((m) => m.slug === 'mile-12');
  const cat = (await call(`/api/markets/${ctx.mile12.id}/catalog`)).body;
  ctx.tomatoes = cat.items.find((i) => i.name === 'Tomatoes');
  ctx.rice = cat.items.find((i) => i.name === 'Rice');
  ctx.ugwu = cat.items.find((i) => i.name.startsWith('Ugwu'));
  ctx.basket = ctx.tomatoes.options.find((o) => o.unitLabel === 'Basket');
  ctx.basmati = ctx.rice.options.find((o) => o.variant === 'Basmati' && o.unitLabel.startsWith('Bag'));
  const areas = (await call('/api/areas')).body.items;
  ctx.surulere = areas.find((a) => a.name === 'Surulere');
});

after(async () => {
  const [users] = await pool.query("SELECT id FROM users WHERE email LIKE 'flow+%'");
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await pool.query('DELETE FROM payment_transactions WHERE customer_id IN (?)', [ids]);
    await pool.query('DELETE FROM bookings WHERE customer_id IN (?)', [ids]);
    await pool.query('DELETE FROM users WHERE id IN (?)', [ids]);
  }
  if (ctx.blockedDate) await pool.query('DELETE FROM availability_exceptions WHERE exception_date = ?', [ctx.blockedDate]);
  server.close();
  await pool.end();
});

async function firstDates(n, type = 'full_purchase') {
  const r = await call(`/api/availability?bookingType=${type}&marketId=${ctx.mile12.id}`);
  return r.body.days.filter((d) => d.available).map((d) => d.date).slice(0, n);
}

const tomatoLine = (over = {}) => ({ catalogItemId: ctx.tomatoes.id, optionId: ctx.basket.id, requestMethod: 'quantity', quantity: 2, ...over });

describe('pricing rules (fixed / range / open)', () => {
  test('catalogue shows a fixed basket price for tomatoes and a range for basmati rice', () => {
    assert.deepEqual(ctx.basket.price, { type: 'fixed', price: 20000 });
    assert.equal(ctx.basmati.price.type, 'range');
    assert.ok(ctx.basmati.price.min < ctx.basmati.price.max);
    assert.equal(ctx.ugwu.options[0].price.type, 'none');
  });

  test('quantity × fixed price, amount-only for tomatoes, range for rice, open amount for ugwu', async () => {
    const r = await call('/api/bookings/estimate', {
      method: 'POST', token: ctx.cust,
      body: {
        bookingType: 'full_purchase', marketId: ctx.mile12.id,
        items: [
          tomatoLine(),                                                                       // 2 baskets
          { catalogItemId: ctx.tomatoes.id, optionId: ctx.basket.id, requestMethod: 'amount', amount: 7000 }, // "₦7,000 of tomatoes"
          { catalogItemId: ctx.rice.id, optionId: ctx.basmati.id, requestMethod: 'quantity', quantity: 1 },
          { catalogItemId: ctx.ugwu.id, optionId: ctx.ugwu.options[0].id, requestMethod: 'amount', amount: 1500 },
          { customName: 'Ofada sauce ingredients', requestMethod: 'amount', amount: 5000 },
        ],
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [two, seven, rice, ugwu, custom] = r.body.lines;
    assert.equal(two.estimateMin, 40000); assert.equal(two.estimateMax, 40000);
    assert.equal(seven.estimateMin, 7000); assert.equal(seven.quantity, null); // no fraction of a basket implied
    assert.equal(rice.estimateMin, ctx.basmati.price.min); assert.equal(rice.estimateMax, ctx.basmati.price.max);
    assert.equal(ugwu.estimateMax, 1500);
    assert.equal(custom.estimateMax, 5000);
    assert.equal(r.body.goodsMin, 40000 + 7000 + ctx.basmati.price.min + 1500 + 5000);
    assert.ok(r.body.serviceFee > 0);
    assert.equal(r.body.transportEstimate, null, 'no address yet → no transport figure');
    assert.ok(!('legs' in r.body) && !('totalKm' in r.body), 'customers never see route legs');
  });

  test('cannot buy an open-price item by quantity', () => {
    const item = { id: 1, name: 'Ugwu', active: 1, allow_open_amount: 1, allow_substitutions: 1, options: [{ id: 9, active: 1, price_type: 'none', allow_quantity: 0, unit_label: 'By amount' }] };
    assert.throws(() => pricing.priceLine({ catalogItemId: 1, optionId: 9, requestMethod: 'quantity', quantity: 3 }, item, 'full_purchase'), /bought by amount/);
  });

  test('service fee is clamped and rounded', () => {
    const p = { fullPurchaseFeeFixed: 3000, fullPurchaseFeePercent: 5, fullPurchaseFeeMin: 3000, fullPurchaseFeeMax: 25000, sampleRunFee: 2500 };
    assert.equal(pricing.serviceFee('full_purchase', 80000, p), 7000);
    assert.equal(pricing.serviceFee('full_purchase', 10_000_000, p), 25000);
    assert.equal(pricing.serviceFee('sample_run', 0, p), 2500);
  });
});

describe('full purchase lifecycle', () => {
  test('customer saves an address', async () => {
    const r = await call('/api/me/addresses', {
      method: 'POST', token: ctx.cust,
      body: { label: 'Home', recipientName: 'Flow A', recipientPhone: '08031112222', addressLine: '12 Adeniran Ogunsanya St', areaId: ctx.surulere.id },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.address.isDefault, true);
    assert.ok(!('area_lat' in r.body.address) && !('lat' in r.body.address));
    ctx.addressId = r.body.address.id;
  });

  test('another customer cannot use that address', async () => {
    const [date] = await firstDates(1);
    const r = await call('/api/bookings', { method: 'POST', token: ctx.other, body: { bookingType: 'full_purchase', marketId: ctx.mile12.id, items: [tomatoLine()], addressId: ctx.addressId, serviceDate: date, acceptPolicies: true } });
    assert.equal(r.status, 404);
  });

  test('limit below the lowest estimate is refused (no silent overspending)', async () => {
    const [date] = await firstDates(1);
    const r = await call('/api/bookings', { method: 'POST', token: ctx.cust, body: { bookingType: 'full_purchase', marketId: ctx.mile12.id, items: [tomatoLine()], addressId: ctx.addressId, serviceDate: date, intendedGoodsBudget: 30000, authorizedGoodsLimit: 30000, acceptPolicies: true } });
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /lowest estimate/);
  });

  test('submit → only the owner can see it', async () => {
    const [date] = await firstDates(1);
    const r = await call('/api/bookings', {
      method: 'POST', token: ctx.cust,
      body: {
        bookingType: 'full_purchase', marketId: ctx.mile12.id, serviceDate: date, timeWindow: 'morning', addressId: ctx.addressId,
        items: [tomatoLine(), { catalogItemId: ctx.rice.id, optionId: ctx.basmati.id, requestMethod: 'quantity', quantity: 1 }],
        intendedGoodsBudget: 40000 + ctx.basmati.price.max, authorizedGoodsLimit: 40000 + ctx.basmati.price.max, acceptPolicies: true,
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ctx.ref = r.body.reference;
    assert.match(ctx.ref, /^JM-[A-Z0-9]{6}$/);
    assert.equal((await call(`/api/bookings/${ctx.ref}`, { token: ctx.other })).status, 404);
    const mine = await call(`/api/bookings/${ctx.ref}`, { token: ctx.cust });
    assert.equal(mine.body.booking.status, 'submitted');
    assert.equal((await call(`/api/admin/bookings/${ctx.ref}`, { token: ctx.cust })).status, 403);
  });

  test('operator sees a suggested quote with route legs; customer never does', async () => {
    const r = await call(`/api/admin/bookings/${ctx.ref}`, { token: ctx.op });
    assert.equal(r.status, 200);
    const s = r.body.booking.quoteSuggestion;
    assert.equal(s.transport.legs.length, 3, 'base → market → customer → base');
    ctx.suggestion = s;
    const c = await call(`/api/bookings/${ctx.ref}`, { token: ctx.cust });
    assert.ok(!JSON.stringify(c.body).includes('legs'));
  });

  test('quote → accept → bank transfer → operator confirms → paid', async () => {
    const s = ctx.suggestion;
    const q = await call(`/api/admin/bookings/${ctx.ref}/quote`, { method: 'POST', token: ctx.op, body: { goodsAmount: s.goodsAmount, serviceFee: s.serviceFee, transportCost: s.transportCost, noteToCustomer: 'See you Saturday!' } });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const quote = q.body.booking.quote;
    assert.equal(quote.upfrontAmount, s.goodsAmount + s.serviceFee + s.transportCost);

    // Customer can't pay before accepting
    assert.equal((await call(`/api/bookings/${ctx.ref}/pay/manual`, { method: 'POST', token: ctx.cust, body: { payerNote: 'Flow A GTB' } })).status, 409);

    const a = await call(`/api/bookings/${ctx.ref}/accept-quote`, { method: 'POST', token: ctx.cust, body: { quoteId: quote.id } });
    assert.equal(a.body.booking.status, 'awaiting_payment');
    assert.equal(a.body.booking.amountDue.amount, quote.upfrontAmount);

    const m = await call(`/api/bookings/${ctx.ref}/pay/manual`, { method: 'POST', token: ctx.cust, body: { payerNote: 'Flow A GTB' } });
    assert.equal(m.status, 200);
    assert.equal(m.body.booking.status, 'awaiting_payment', 'a transfer notice alone is not payment');
    const pending = m.body.booking.payments.find((p) => p.status === 'pending');
    const c = await call(`/api/admin/bookings/${ctx.ref}/payments/${pending.id}/confirm`, { method: 'POST', token: ctx.op });
    assert.equal(c.body.booking.status, 'paid');
    // confirming twice is harmless
    assert.equal((await call(`/api/admin/bookings/${ctx.ref}/payments/${pending.id}/confirm`, { method: 'POST', token: ctx.op })).status, 200);
    ctx.paid = quote.upfrontAmount;
  });

  test('shopping: sheet above the limit is blocked until the customer approves extra', async () => {
    const st = await call(`/api/admin/bookings/${ctx.ref}/start`, { method: 'POST', token: ctx.op });
    assert.equal(st.body.booking.status, 'shopping_in_progress');
    const lines = st.body.booking.purchase.items;
    const limit = st.body.booking.authorizedGoodsLimit;
    const sheet = (tomatoAmt, riceAmt) => ({
      items: [
        { bookingItemId: lines[0].bookingItemId, outcome: 'bought', actualQuantity: 2, actualAmount: tomatoAmt },
        { bookingItemId: lines[1].bookingItemId, outcome: 'bought', actualQuantity: 1, actualAmount: riceAmt },
      ],
      serviceFee: ctx.suggestion.serviceFee, transportCost: ctx.suggestion.transportCost,
    });
    const over = await call(`/api/admin/bookings/${ctx.ref}/sheet`, { method: 'PUT', token: ctx.op, body: sheet(45000, limit - 40000) });
    assert.equal(over.status, 409);
    assert.match(over.body.error.message, /above the customer's limit/);

    const ch = await call(`/api/admin/bookings/${ctx.ref}/changes`, { method: 'POST', token: ctx.op, body: { type: 'extra_spend', bookingItemId: lines[0].bookingItemId, description: 'Tomatoes are ₦22,500 a basket today', extraAmount: 5000 } });
    assert.equal(ch.body.booking.status, 'awaiting_customer_decision');
    const reqId = ch.body.booking.changeRequests[0].id;
    const ok = await call(`/api/bookings/${ctx.ref}/changes/${reqId}`, { method: 'POST', token: ctx.cust, body: { decision: 'approve' } });
    assert.equal(ok.body.booking.status, 'shopping_in_progress');
    assert.equal(ok.body.booking.authorizedGoodsLimit, limit + 5000);

    // Now buy for less than budgeted overall: tomatoes 45,000, rice ₦10,000 under its max
    const saved = await call(`/api/admin/bookings/${ctx.ref}/sheet`, { method: 'PUT', token: ctx.op, body: sheet(45000, ctx.basmati.price.max - 10000) });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    ctx.final = 45000 + ctx.basmati.price.max - 10000 + ctx.suggestion.serviceFee + ctx.suggestion.transportCost;
    assert.equal(saved.body.totals.finalTotal, ctx.final);
  });

  test('finish → complete → reconciliation → customer takes the surplus as credit', async () => {
    assert.equal((await call(`/api/admin/bookings/${ctx.ref}/finish`, { method: 'POST', token: ctx.op })).body.booking.status, 'ready_for_delivery');
    const done = await call(`/api/admin/bookings/${ctx.ref}/complete`, { method: 'POST', token: ctx.op });
    assert.equal(done.body.booking.status, 'completed');
    const rec = done.body.booking.reconciliation;
    assert.equal(rec.paidTotal, ctx.paid);
    assert.equal(rec.finalTotal, ctx.final);
    assert.equal(rec.refundDue, ctx.paid - ctx.final);
    assert.equal(rec.status, 'awaiting_customer');

    const ch = await call(`/api/bookings/${ctx.ref}/refund-choice`, { method: 'POST', token: ctx.cust, body: { choice: 'credit' } });
    assert.equal(ch.body.booking.reconciliation.status, 'credited');
    const me = await call('/api/me', { token: ctx.cust });
    assert.equal(me.body.user.creditBalance, ctx.paid - ctx.final);
    // can't choose twice
    assert.equal((await call(`/api/bookings/${ctx.ref}/refund-choice`, { method: 'POST', token: ctx.cust, body: { choice: 'credit' } })).status, 409);
  });

  test('restocking estimates are created and can be corrected', async () => {
    const r = await call('/api/me/restocking', { token: ctx.cust });
    const labels = r.body.items.map((i) => i.label);
    assert.ok(labels.some((l) => l.startsWith('Tomatoes')));
    assert.ok(labels.some((l) => l.startsWith('Rice')));
    const tom = r.body.items.find((i) => i.label.startsWith('Tomatoes'));
    assert.equal(tom.estimatedDurationDays, 20, '2 baskets × 10 days for a household of 4');
    const u = await call(`/api/me/restocking/${tom.id}`, { method: 'PATCH', token: ctx.cust, body: { status: 'still_available' } });
    assert.equal(u.body.item.status, 'still_available');
    const adj = await call(`/api/me/restocking/${tom.id}`, { method: 'PATCH', token: ctx.cust, body: { estimatedDurationDays: 30 } });
    assert.equal(adj.body.item.estimatedDurationDays, 30);
    assert.equal(adj.body.item.customerAdjusted, true);
  });

  test('restock reminder emails are sent once per cycle', async () => {
    await pool.query("UPDATE customer_item_estimates e JOIN users u ON u.id = e.customer_id SET e.remind_on = CURDATE() - INTERVAL 1 DAY, e.last_reminded_at = NULL, e.customer_status = 'unknown' WHERE u.email LIKE 'flow+a%'");
    const first = await restockService.sendDueReminders();
    assert.ok(first.sent >= 1);
    const second = await restockService.sendDueReminders();
    assert.equal(second.sent, 0);
  });

  test('credit pays for the next booking', async () => {
    const [date] = await firstDates(1);
    const b = await call('/api/bookings', { method: 'POST', token: ctx.cust, body: { bookingType: 'full_purchase', marketId: ctx.mile12.id, items: [tomatoLine({ quantity: 1 })], addressId: ctx.addressId, serviceDate: date, acceptPolicies: true } });
    const ref = b.body.reference;
    const op = await call(`/api/admin/bookings/${ref}`, { token: ctx.op });
    const s = op.body.booking.quoteSuggestion;
    const q = await call(`/api/admin/bookings/${ref}/quote`, { method: 'POST', token: ctx.op, body: { goodsAmount: s.goodsAmount, serviceFee: s.serviceFee, transportCost: s.transportCost } });
    await call(`/api/bookings/${ref}/accept-quote`, { method: 'POST', token: ctx.cust, body: { quoteId: q.body.booking.quote.id } });
    const before = (await call('/api/me', { token: ctx.cust })).body.user.creditBalance;
    const pc = await call(`/api/bookings/${ref}/pay/credit`, { method: 'POST', token: ctx.cust });
    assert.equal(pc.status, 200);
    assert.equal(pc.body.used, Math.min(before, q.body.booking.quote.upfrontAmount));
    assert.equal(pc.body.booking.amountDue.amount, q.body.booking.quote.upfrontAmount - pc.body.used);
    ctx.creditRef = ref;
  });
});

describe('Paystack (faked provider)', () => {
  test('webhook with a bad signature is rejected; a good one marks paid exactly once', async () => {
    const start = await call(`/api/bookings/${ctx.creditRef}/pay/online`, { method: 'POST', token: ctx.cust });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const payload = JSON.stringify({ event: 'charge.success', data: { reference: start.body.reference } });
    const bad = await call('/api/payments/paystack/webhook', { method: 'POST', raw: payload, headers: { 'x-paystack-signature': 'nope' } });
    assert.equal(bad.status, 401);
    const sig = crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(payload).digest('hex');
    for (let i = 0; i < 3; i++) {
      assert.equal((await call('/api/payments/paystack/webhook', { method: 'POST', raw: payload, headers: { 'x-paystack-signature': sig } })).status, 200);
    }
    // the browser callback afterwards is also harmless
    const v = await call('/api/payments/verify', { method: 'POST', token: ctx.cust, body: { reference: start.body.reference } });
    assert.equal(v.body.status, 'successful');
    const d = await call(`/api/bookings/${ctx.creditRef}`, { token: ctx.cust });
    assert.equal(d.body.booking.status, 'paid');
    assert.equal(d.body.booking.payments.filter((p) => p.provider === 'paystack' && p.status === 'successful').length, 1);
    const paidEvents = d.body.booking.timeline.filter((e) => e.to === 'paid');
    assert.equal(paidEvents.length, 1);
    // another customer can't verify someone else's reference
    assert.equal((await call('/api/payments/verify', { method: 'POST', token: ctx.other, body: { reference: start.body.reference } })).status, 404);
  });
});

describe('capacity & expiry', () => {
  test('two customers racing for the last slot: exactly one wins', async () => {
    const dates = await firstDates(20);
    ctx.blockedDate = dates[dates.length - 1];
    await call('/api/admin/calendar/exceptions', { method: 'POST', token: ctx.op, body: { date: ctx.blockedDate, type: 'capacity', capacityUnits: 2, reason: 'test' } });
    await call('/api/me/addresses', { method: 'POST', token: ctx.other, body: { label: 'Home', recipientName: 'Flow B', recipientPhone: '08031113333', addressLine: '5 Herbert Macaulay Way', areaId: ctx.surulere.id } });
    const otherAddr = (await call('/api/me/addresses', { token: ctx.other })).body.items[0].id;
    const body = (addressId) => ({ bookingType: 'full_purchase', marketId: ctx.mile12.id, items: [tomatoLine({ quantity: 1 })], addressId, serviceDate: ctx.blockedDate, acceptPolicies: true });
    const [a, b] = await Promise.all([
      call('/api/bookings', { method: 'POST', token: ctx.cust, body: body(ctx.addressId) }),
      call('/api/bookings', { method: 'POST', token: ctx.other, body: body(otherAddr) }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    ctx.raceRef = (a.status === 201 ? a : b).body.reference;
    ctx.raceToken = a.status === 201 ? ctx.cust : ctx.other;
  });

  test('an unreviewed request expires and frees the date', async () => {
    await pool.query("UPDATE bookings SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE reference = ?", [ctx.raceRef]);
    await pool.query("UPDATE capacity_holds h JOIN bookings b ON b.id = h.booking_id SET h.expires_at = NOW() - INTERVAL 1 MINUTE WHERE b.reference = ?", [ctx.raceRef]);
    const r = await expireJob.run();
    assert.ok(r.expired >= 1);
    const d = await call(`/api/bookings/${ctx.raceRef}`, { token: ctx.raceToken });
    assert.equal(d.body.booking.status, 'expired');
    const days = (await call(`/api/availability?bookingType=full_purchase&marketId=${ctx.mile12.id}`)).body.days;
    assert.equal(days.find((x) => x.date === ctx.blockedDate).available, true);
  });

  test('customers cannot cancel after shopping starts; can cancel before', async () => {
    const [date] = await firstDates(1);
    const b = await call('/api/bookings', { method: 'POST', token: ctx.cust, body: { bookingType: 'sample_run', marketId: ctx.mile12.id, items: [{ catalogItemId: ctx.rice.id, requestMethod: 'amount', preferences: 'Check Basmati brands and prices' }], serviceDate: date, acceptPolicies: true } });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    const c = await call(`/api/bookings/${b.body.reference}/cancel`, { method: 'POST', token: ctx.cust, body: { reason: 'Changed my mind' } });
    assert.equal(c.body.booking.status, 'cancelled');
    assert.equal((await call(`/api/bookings/${ctx.ref}/cancel`, { method: 'POST', token: ctx.cust, body: {} })).status, 409);
  });
});

describe('restock estimate units', () => {
  const rice = {
    options: [
      { id: 1, unit_label: 'Bag (50kg)', variant: 'Nigerian (local)', price_type: 'range', price_min: 70000, price_max: 85000, is_standard: 1 },
      { id: 2, unit_label: 'Bag (50kg)', variant: 'Basmati', price_type: 'range', price_min: 95000, price_max: 140000, is_standard: 0 },
      { id: 3, unit_label: 'Cup (mudu)', variant: 'Basmati', price_type: 'range', price_min: 2500, price_max: 3500, is_standard: 0 },
    ],
  };
  const tomatoes = { options: [{ id: 9, unit_label: 'Basket', variant: null, price_type: 'fixed', price: 20000, is_standard: 1 }] };

  test('a bag is a bag, whatever the variant', () => {
    assert.equal(restockService.standardUnits({ option_id: 2, actual_quantity: 1, actual_amount: 118000 }, rice), 1);
  });
  test('cups convert to bags using the same variant', () => {
    const u = restockService.standardUnits({ option_id: 3, actual_quantity: 10, actual_amount: 30000 }, rice);
    assert.ok(u > 0.2 && u < 0.3, `10 Basmati cups ≈ a quarter bag, got ${u}`);
  });
  test('"₦7,000 of tomatoes" counts as a fraction of a basket for the estimate only', () => {
    assert.equal(restockService.standardUnits({ option_id: 9, actual_quantity: null, actual_amount: 7000 }, tomatoes), 0.35);
  });
});
