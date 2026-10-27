// Jojo's Kitchen: cooked-to-order meals, delivery only.
//   Regular: dishes → quantity → a date/window allowed by the lead-time rules and capacity → pay → confirmed.
//   Express: dishes → quantity → requested time → Jojo approves (sets the express fee) → pay → confirmed.
// Then: preparing → cooking → out for delivery → delivered.
import { env } from '../config/env.js';
import { KITCHEN_ACTIVE_STATUSES, KITCHEN_EXCLUSIONS, KITCHEN_STATUS as K, KITCHEN_STATUS_LABELS, MEAL_CATEGORIES } from '../config/constants.js';
import { withTransaction } from '../db/pool.js';
import * as Availability from '../models/availability.model.js';
import * as KitchenOrder from '../models/kitchenOrder.model.js';
import * as Meal from '../models/meal.model.js';
import * as Payment from '../models/payment.model.js';
import { addDays, hoursFromNow, isoDate } from '../utils/dates.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { money, roundUpTo, toKobo, toNaira } from '../utils/money.js';
import * as addressService from './address.service.js';
import * as auditService from './audit.service.js';
import * as kitchenNotify from './kitchenNotify.service.js';
import * as schedule from './kitchenSchedule.service.js';
import * as kitchenStatus from './kitchenStatus.service.js';
import * as paymentService from './payment.service.js';
import * as settingsService from './settings.service.js';
import { haversineKm } from './transport.service.js';
import crypto from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const kitchenReference = () => `JK-${[...crypto.randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;

const kitchenCfg = async () => (await settingsService.getAll()).kitchen;

// ---------- Menu ----------

export function presentMeal(m, { internal = false } = {}) {
  const opts = m.options.filter((o) => internal || o.active);
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    category: m.category,
    categoryLabel: MEAL_CATEGORIES[m.category],
    description: m.description,
    illustration: m.illustration,
    imageUrl: m.image_url,
    contains: m.contains,
    featured: Boolean(m.featured),
    spiceLevels: Boolean(m.spice_levels),
    exclusions: m.allowed_exclusions.map((k) => ({ key: k, label: KITCHEN_EXCLUSIONS[k] || k })),
    priceFrom: opts.length ? Math.min(...opts.map((o) => Number(o.price))) : null,
    options: opts.map((o) => ({
      id: o.id, label: o.label, serves: o.serves, price: money(o.price), portions: Number(o.portions), isBulk: Boolean(o.is_bulk),
      ...(internal ? { active: Boolean(o.active), sort: o.sort } : {}),
    })),
    ...(internal ? { active: Boolean(m.active), sort: m.sort, allowedExclusions: m.allowed_exclusions } : {}),
  };
}

export async function menu() {
  const cfg = await kitchenCfg();
  const meals = (await Meal.list()).filter((m) => m.options.length);
  return {
    enabled: cfg.enabled,
    meals: meals.map((m) => presentMeal(m)),
    categories: Object.entries(MEAL_CATEGORIES).map(([key, label]) => ({ key, label })),
    rules: {
      fullDayCutoff: cfg.fullDayCutoff, extraHoursCutoff: cfg.extraHoursCutoff, extraHours: cfg.extraHours,
      bulkPortionThreshold: cfg.bulkPortionThreshold, bulkExtraDays: cfg.bulkExtraDays,
      expressEnabled: cfg.expressEnabled, expressSurchargePercent: cfg.expressSurchargePercent, expressMinFee: cfg.expressMinFee,
      expressMinHoursAhead: cfg.expressMinHoursAhead, expressEarliestTime: cfg.expressEarliestTime, expressLatestTime: cfg.expressLatestTime,
      deliveryWindows: cfg.deliveryWindows.map((w) => ({ key: w.key, label: w.label })),
    },
  };
}

// ---------- Pricing ----------

async function priceItems(items) {
  const meals = await Meal.findManyWithOptions([...new Set(items.map((i) => i.mealId))]);
  const priced = items.map((line, idx) => {
    const where = `Dish ${idx + 1}`;
    const meal = meals.get(line.mealId);
    if (!meal || !meal.active) throw badRequest(`${where}: that dish is no longer on the menu.`);
    const opt = meal.options.find((o) => o.id === line.optionId && o.active);
    if (!opt) throw badRequest(`${where}: please choose a size for ${meal.name} again.`);
    const bad = (line.exclusions || []).filter((k) => !meal.allowed_exclusions.includes(k));
    if (bad.length) throw badRequest(`${where}: ${meal.name} can’t be made ${bad.map((k) => (KITCHEN_EXCLUSIONS[k] || k).toLowerCase()).join(', ')}.`);
    if (line.spiceLevel && !meal.spice_levels) throw badRequest(`${where}: ${meal.name} doesn’t come with a pepper level.`);
    const lineK = toKobo(opt.price) * line.quantity;
    return {
      mealId: meal.id, optionId: opt.id, mealName: meal.name, optionLabel: opt.label, unitPrice: money(opt.price), quantity: line.quantity,
      portions: Number(opt.portions) * line.quantity, isBulk: Boolean(opt.is_bulk), lineTotal: toNaira(lineK),
      exclusions: [...new Set(line.exclusions || [])], spiceLevel: meal.spice_levels ? (line.spiceLevel || null) : null, instructions: line.instructions || null,
    };
  });
  const subtotal = toNaira(priced.reduce((a, l) => a + toKobo(l.lineTotal), 0));
  const portions = Math.round(priced.reduce((a, l) => a + l.portions, 0) * 100) / 100;
  return { items: priced, subtotal, portions };
}

export function deliveryFee(cfg, base, area) {
  if (area?.area_lat == null) return null;
  const km = haversineKm({ lat: Number(base.lat), lng: Number(base.lng) }, { lat: Number(area.area_lat), lng: Number(area.area_lng) }) * 2 * env.ROAD_FACTOR;
  return roundUpTo(Number(cfg.deliveryBaseFee) + km * Number(cfg.deliveryPerKm), 100);
}

export const expressFeeFor = (cfg, subtotal) => roundUpTo(Math.max(Number(cfg.expressMinFee), Number(subtotal) * Number(cfg.expressSurchargePercent) / 100), 100);

/** Price + schedule preview used by the order page as the customer builds the order. */
export async function quote(customerId, body) {
  const { kitchen: cfg, baseLocation } = await settingsService.getAll();
  const { items, subtotal, portions } = await priceItems(body.items);
  const isBulk = items.some((i) => i.isBulk) || portions >= cfg.bulkPortionThreshold;
  const address = body.addressId ? await addressService.getOwned(body.addressId, customerId) : null;
  const fee = address ? deliveryFee(cfg, baseLocation, address) : null;
  const cal = await schedule.calendar({ cfg, portions, isBulk });
  const expressFee = expressFeeFor(cfg, subtotal);
  return {
    items: items.map((i) => ({ mealName: i.mealName, optionLabel: i.optionLabel, quantity: i.quantity, lineTotal: i.lineTotal })),
    subtotal, portions, isBulk, deliveryFee: fee,
    total: fee == null ? null : toNaira(toKobo(subtotal) + toKobo(fee)),
    expressFeeEstimate: expressFee,
    expressTotalEstimate: fee == null ? null : toNaira(toKobo(subtotal) + toKobo(fee) + toKobo(expressFee)),
    earliest: cal.earliest,
    days: cal.days,
  };
}

// ---------- Placing an order ----------

export async function create(customerId, body, ip) {
  const { kitchen: cfg, baseLocation } = await settingsService.getAll();
  if (!cfg.enabled) throw conflict('Jojo’s Kitchen isn’t taking orders right now.');
  const { items, subtotal, portions } = await priceItems(body.items);
  const isBulk = items.some((i) => i.isBulk) || portions >= cfg.bulkPortionThreshold;
  const address = await addressService.getOwned(body.addressId, customerId);
  const fee = deliveryFee(cfg, baseLocation, address) ?? Number(cfg.deliveryBaseFee);
  const now = new Date();

  let order;
  if (body.orderType === 'express') {
    if (!cfg.expressEnabled) throw conflict('Express orders aren’t available right now.');
    const when = new Date(body.requestedDeliveryAt);
    const err = schedule.checkExpressTime(when, now, cfg);
    if (err) throw badRequest(err, { fields: { requestedDeliveryAt: err } });
    const { date } = schedule.lagosParts(when);
    // Expire unanswered requests after expressReplyHours, but never later than 1 hour before the requested time.
    const expiresAt = new Date(Math.min(hoursFromNow(cfg.expressReplyHours).getTime(), when.getTime() - 3_600_000));
    order = await insert({
      customerId, orderType: 'express', status: K.EXPRESS_REQUESTED, deliveryDate: date, requestedDeliveryAt: when,
      address, portions, isBulk, subtotal, deliveryFee: fee, expressFee: expressFeeFor(cfg, subtotal), items,
      customerNotes: body.customerNotes, allergyNotes: body.allergyNotes, expiresAt,
    });
  } else {
    order = await withTransaction(async (conn) => {
      await Availability.lockDate(body.deliveryDate, conn); // serialise all orders for this day
      const err = await schedule.assertRegularSlot({ now, cfg, date: body.deliveryDate, windowKey: body.deliveryWindow, portions, isBulk }, conn);
      if (err) throw conflict(err);
      return insert({
        customerId, orderType: 'regular', status: K.AWAITING_PAYMENT, deliveryDate: body.deliveryDate, deliveryWindow: body.deliveryWindow,
        address, portions, isBulk, subtotal, deliveryFee: fee, expressFee: 0, items,
        customerNotes: body.customerNotes, allergyNotes: body.allergyNotes, expiresAt: hoursFromNow(cfg.paymentWindowHours),
      }, conn);
    });
  }

  await auditService.record({ actorUserId: customerId, action: 'kitchen.order_placed', entityType: 'kitchen_order', entityId: order.id, metadata: { reference: order.reference, type: order.order_type }, ip });
  if (order.order_type === 'express') {
    await kitchenNotify.customer(order.id, 'kitchenExpressReceived');
    await kitchenNotify.operatorsExpress(order.id);
  } else {
    await kitchenNotify.customer(order.id, 'kitchenAwaitingPayment');
  }
  return order;
}

async function insert(o, conn) {
  const run = async (c) => {
    let reference;
    for (let i = 0; i < 5; i++) {
      reference = kitchenReference();
      if (!(await KitchenOrder.findByReference(reference, c))) break;
    }
    const total = toNaira(toKobo(o.subtotal) + toKobo(o.deliveryFee) + (o.orderType === 'express' ? toKobo(o.expressFee) : 0));
    const id = await KitchenOrder.create({ ...o, reference, total }, c);
    await KitchenOrder.insertItems(id, o.items, c);
    await KitchenOrder.insertEvent({ orderId: id, fromStatus: null, toStatus: o.status, actorUserId: o.customerId }, c);
    return KitchenOrder.findById(id, c);
  };
  return conn ? run(conn) : withTransaction(run);
}

// ---------- Reading ----------

export async function getForCustomer(reference, customerId) {
  const o = await KitchenOrder.findByReferenceForCustomer(reference, customerId);
  if (!o) throw notFound('Order not found');
  return o;
}

export async function getForOperator(reference) {
  const o = await KitchenOrder.findByReference(reference);
  if (!o) throw notFound('Order not found');
  return o;
}

export async function presentSummary(o) {
  return {
    reference: o.reference,
    orderType: o.order_type,
    status: o.status,
    statusLabel: KITCHEN_STATUS_LABELS[o.status],
    deliveryDate: isoDate(o.delivery_date),
    deliveryWindow: o.delivery_window,
    requestedDeliveryAt: o.requested_delivery_at,
    deliveryText: await kitchenNotify.deliveryText(o),
    total: money(o.total),
    portions: Number(o.portions),
    isBulk: Boolean(o.is_bulk),
    customerName: o.customer_name,
    createdAt: o.created_at,
  };
}

export async function presentDetail(o, audience) {
  const internal = audience === 'operator';
  const [items, events, payments] = await Promise.all([kitchenNotify.itemsWithLabels(o.id), KitchenOrder.listEvents(o.id), Payment.listForKitchenOrder(o.id)]);
  const due = await paymentService.kitchenAmountDue(o);
  const { payments: pay } = await settingsService.getAll();
  const creditBalance = toNaira(await Payment.creditBalanceKobo(o.customer_id));
  return {
    ...(await presentSummary(o)),
    subtotal: money(o.subtotal),
    deliveryFee: money(o.delivery_fee),
    expressFee: money(o.express_fee),
    customerNotes: o.customer_notes,
    allergyNotes: o.allergy_notes,
    operatorNote: o.operator_note,
    statusReason: o.status_reason,
    expiresAt: o.expires_at,
    refundDue: money(o.refund_due),
    refundStatus: o.refund_status,
    address: { label: o.addr_label, recipientName: o.addr_recipient, recipientPhone: o.addr_phone, addressLine: o.addr_line, area: o.addr_area, landmark: o.addr_landmark, instructions: o.addr_instructions },
    items: items.map((i) => ({
      id: i.id, mealId: i.meal_id, mealName: i.meal_name, optionLabel: i.option_label, unitPrice: money(i.unit_price), quantity: i.quantity,
      lineTotal: money(i.line_total), exclusions: i.exclusionLabels, spiceLevel: i.spice_level, instructions: i.instructions,
    })),
    timeline: events.map((e) => ({ to: e.to_status, label: KITCHEN_STATUS_LABELS[e.to_status], reason: e.reason, at: e.created_at, by: e.actor_role || 'system' })),
    payments: payments.filter((t) => internal || t.status !== 'initiated').map((t) => ({
      id: t.id, provider: t.provider, type: t.transaction_type, amount: money(t.amount), status: t.status, payerNote: t.payer_note, createdAt: t.created_at,
    })),
    amountDue: due,
    creditBalance,
    onlinePayment: paymentService.onlineEnabled(),
    manualPayment: pay.allowManualTransfer && due.amount > 0 ? { bankName: pay.bankName, accountName: pay.accountName, accountNumber: pay.accountNumber, instructions: pay.instructions } : null,
    canCancel: [K.EXPRESS_REQUESTED, K.AWAITING_PAYMENT].includes(o.status) && !payments.some((t) => ['pending', 'successful'].includes(t.status)),
    ...(internal ? {
      customer: { id: o.customer_id, name: o.customer_name, email: o.customer_email, phone: o.customer_phone },
      nextStep: kitchenStatus.nextStepFor[o.status] || null,
    } : {}),
  };
}

export async function listForCustomer(customerId, scope) {
  const statuses = scope === 'active' ? KITCHEN_ACTIVE_STATUSES : scope === 'past' ? [K.DELIVERED, K.DECLINED, K.CANCELLED, K.EXPIRED] : null;
  return Promise.all((await KitchenOrder.listForCustomer(customerId, statuses)).map(presentSummary));
}

// ---------- Customer actions ----------

export async function cancelByCustomer(o, customerId, reason, ip) {
  const payments = await Payment.listForKitchenOrder(o.id);
  if (payments.some((t) => ['pending', 'successful'].includes(t.status))) throw conflict('You’ve already paid or sent a transfer — please contact Jojo to cancel.');
  await withTransaction(async (conn) => {
    const locked = await KitchenOrder.lockById(o.id, conn);
    await kitchenStatus.transition(conn, locked, K.CANCELLED, { id: customerId, role: 'customer' }, { reason, expiresAt: null });
  });
  await auditService.record({ actorUserId: customerId, action: 'kitchen.cancelled', entityType: 'kitchen_order', entityId: o.id, reason, ip });
}

// ---------- Operator actions ----------

/** Capacity picture for the day an express order is wanted (shown to Jojo before she approves). */
export async function dayLoad(date) {
  const cfg = await kitchenCfg();
  const [usage, overrides] = await Promise.all([
    KitchenOrder.usageByDate(date, date, ['awaiting_payment', 'confirmed', 'preparing', 'cooking', 'out_for_delivery', 'delivered']),
    KitchenOrder.listOverrides(date, date),
  ]);
  return { date, portions: Number(usage[0]?.portions || 0), orders: Number(usage[0]?.orders || 0), capacity: schedule.capacityFor(date, cfg, overrides[0]), maxOrders: cfg.maxOrdersPerDay };
}

export async function approveExpress(o, operator, body, ip) {
  const cfg = await kitchenCfg();
  await withTransaction(async (conn) => {
    const locked = await KitchenOrder.lockById(o.id, conn);
    if (locked.status !== K.EXPRESS_REQUESTED) throw conflict('This request is no longer waiting for approval.');
    const total = toNaira(toKobo(locked.subtotal) + toKobo(body.deliveryFee) + toKobo(body.expressFee));
    await KitchenOrder.setPricing(locked.id, { deliveryFee: body.deliveryFee, expressFee: body.expressFee, total, operatorNote: body.note }, conn);
    await kitchenStatus.transition(conn, locked, K.AWAITING_PAYMENT, operator, { expiresAt: hoursFromNow(cfg.paymentWindowHours) });
  });
  await auditService.record({ actorUserId: operator.id, action: 'kitchen.express_approved', entityType: 'kitchen_order', entityId: o.id, metadata: { expressFee: body.expressFee }, ip });
  await kitchenNotify.customer(o.id, 'kitchenExpressApproved');
}

export async function declineExpress(o, operator, reason, ip) {
  await withTransaction(async (conn) => {
    const locked = await KitchenOrder.lockById(o.id, conn);
    await kitchenStatus.transition(conn, locked, K.DECLINED, operator, { reason, expiresAt: null });
  });
  await auditService.record({ actorUserId: operator.id, action: 'kitchen.express_declined', entityType: 'kitchen_order', entityId: o.id, reason, ip });
  await kitchenNotify.customer(o.id, 'kitchenExpressDeclined');
}

/** Move to the next cooking stage. Customers are emailed when it's on its way and when delivered. */
export async function advance(o, operator, to, ip) {
  await withTransaction(async (conn) => {
    const locked = await KitchenOrder.lockById(o.id, conn);
    await kitchenStatus.transition(conn, locked, to, operator);
  });
  await auditService.record({ actorUserId: operator.id, action: `kitchen.${to}`, entityType: 'kitchen_order', entityId: o.id, ip });
  if (to === K.OUT_FOR_DELIVERY) await kitchenNotify.customer(o.id, 'kitchenOutForDelivery');
  if (to === K.DELIVERED) await kitchenNotify.customer(o.id, 'kitchenDelivered');
}

/** Operator cancel. If money was received: return it as credit now, or mark a refund to send. */
export async function cancelByOperator(o, operator, { reason, refundMethod }, ip) {
  await withTransaction(async (conn) => {
    const locked = await KitchenOrder.lockById(o.id, conn);
    await kitchenStatus.transition(conn, locked, K.CANCELLED, operator, { reason, expiresAt: null });
    const paidK = await Payment.paidTotalKoboForKitchenOrder(o.id, conn);
    if (paidK > 0) {
      if (refundMethod === 'credit') {
        await Payment.create({ kitchenOrderId: o.id, customerId: o.customer_id, provider: 'credit', type: 'credit_issued', amount: toNaira(paidK), status: 'successful', verifiedAt: new Date(), verifiedBy: operator.id, idempotencyKey: `kitchen-credit-${o.id}` }, conn);
        await KitchenOrder.setRefund(o.id, { refundDue: toNaira(paidK), refundStatus: 'credited' }, conn);
      } else {
        await KitchenOrder.setRefund(o.id, { refundDue: toNaira(paidK), refundStatus: 'refund_pending' }, conn);
      }
    }
  });
  await auditService.record({ actorUserId: operator.id, action: 'kitchen.cancelled', entityType: 'kitchen_order', entityId: o.id, reason, metadata: { refundMethod }, ip });
  await kitchenNotify.customer(o.id, 'kitchenCancelled');
}

export async function recordRefund(o, operator, { reference, note }, ip) {
  await withTransaction(async (conn) => {
    const locked = await KitchenOrder.lockById(o.id, conn);
    if (locked.refund_status !== 'refund_pending') throw conflict('No refund is pending on this order.');
    await Payment.create({ kitchenOrderId: o.id, customerId: o.customer_id, provider: 'manual', type: 'refund', amount: locked.refund_due, status: 'successful', payerNote: [reference && `Ref: ${reference}`, note].filter(Boolean).join(' · ') || null, verifiedAt: new Date(), verifiedBy: operator.id, idempotencyKey: `kitchen-refund-${o.id}` }, conn);
    await KitchenOrder.setRefund(o.id, { refundDue: locked.refund_due, refundStatus: 'refunded' }, conn);
  });
  await auditService.record({ actorUserId: operator.id, action: 'kitchen.refund_sent', entityType: 'kitchen_order', entityId: o.id, ip });
}

export async function adminList({ scope, q, page, pageSize }) {
  const scopes = {
    express: [K.EXPRESS_REQUESTED],
    payment: [K.AWAITING_PAYMENT],
    upcoming: [K.CONFIRMED, K.PREPARING, K.COOKING, K.OUT_FOR_DELIVERY],
    delivered: [K.DELIVERED],
    closed: [K.DECLINED, K.CANCELLED, K.EXPIRED],
  };
  const { total, rows } = await KitchenOrder.listForAdmin({ statuses: scope ? scopes[scope] : undefined, q, limit: pageSize, offset: (page - 1) * pageSize });
  return { items: await Promise.all(rows.map(presentSummary)), total, page, pageSize };
}

/** The cooking list for one day: every dish to make, merged across orders. */
export async function cookingSheet(date) {
  const orders = await KitchenOrder.listForDay(date, [K.CONFIRMED, K.PREPARING, K.COOKING, K.OUT_FOR_DELIVERY, K.DELIVERED]);
  const dishes = new Map();
  const detailed = [];
  for (const o of orders) {
    const items = await kitchenNotify.itemsWithLabels(o.id);
    for (const i of items) {
      const key = `${i.meal_name}|${i.option_label}`;
      const d = dishes.get(key) || { meal: i.meal_name, option: i.option_label, quantity: 0, special: 0 };
      d.quantity += i.quantity;
      if (i.exclusions.length || i.instructions || i.spice_level) d.special += 1;
      dishes.set(key, d);
    }
    detailed.push({ ...(await presentSummary(o)), area: o.addr_area, items: items.map((i) => ({ meal: i.meal_name, option: i.option_label, quantity: i.quantity, exclusions: i.exclusionLabels, spice: i.spice_level, instructions: i.instructions })), allergyNotes: o.allergy_notes });
  }
  return { date, dishes: [...dishes.values()], orders: detailed, load: await dayLoad(date) };
}

export async function counts() {
  return KitchenOrder.countByStatus();
}

// ---------- Menu admin ----------

export async function adminMenu() {
  return (await Meal.list({ includeInactive: true })).map((m) => presentMeal(m, { internal: true }));
}

export async function saveMeal(id, body, user, ip) {
  const result = await withTransaction(async (conn) => {
    let mealId = id;
    const existing = id ? await Meal.findById(id, conn) : null;
    if (id && !existing) throw notFound('Dish not found');
    const bad = body.allowedExclusions.filter((k) => !KITCHEN_EXCLUSIONS[k]);
    if (bad.length) throw badRequest(`Unknown exclusion: ${bad.join(', ')}`);
    try {
      if (existing) await Meal.update(id, body, conn);
      else mealId = await Meal.create(body, conn);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw conflict('Another dish already uses that short name.');
      throw err;
    }
    for (const [i, o] of body.options.entries()) {
      if (o.id) {
        if (!existing.options.some((x) => x.id === o.id)) throw badRequest('Option does not belong to this dish.');
        await Meal.updateOption(o.id, mealId, { ...o, sort: i }, conn);
      } else {
        await Meal.createOption(mealId, { ...o, sort: i }, conn);
      }
    }
    const keep = new Set(body.options.filter((o) => o.id).map((o) => o.id));
    for (const prev of existing?.options || []) if (!keep.has(prev.id)) await Meal.deactivateOption(prev.id, conn);
    return Meal.findById(mealId, conn);
  });
  await auditService.record({ actorUserId: user.id, action: id ? 'kitchen.meal_updated' : 'kitchen.meal_created', entityType: 'meal', entityId: result.id, metadata: { name: body.name }, ip });
  return presentMeal(result, { internal: true });
}

export async function setMealPhoto(id, buffer, uploadService) {
  const meal = await Meal.findById(id);
  if (!meal) throw notFound('Dish not found');
  uploadService.detectImageFormat(buffer);
  const res = await uploadService.uploadPublicImage(buffer, {
    folder: 'kitchen', publicId: `${meal.slug}-${Date.now().toString(36)}`,
    transformation: [{ width: 1200, height: 900, crop: 'fill', gravity: 'auto' }, { quality: 'auto', fetch_format: 'auto' }],
  });
  await Meal.setImage(id, res.secure_url, res.public_id);
  if (meal.image_public_id) await uploadService.deleteImage(meal.image_public_id);
  return presentMeal(await Meal.findById(id), { internal: true });
}

export async function removeMealPhoto(id, uploadService) {
  const meal = await Meal.findById(id);
  if (!meal) throw notFound('Dish not found');
  await Meal.setImage(id, null, null);
  await uploadService.deleteImage(meal.image_public_id);
  return presentMeal(await Meal.findById(id), { internal: true });
}

export async function calendarAdmin(days = 21) {
  const cfg = await kitchenCfg();
  const today = schedule.lagosParts().date;
  const end = addDays(today, days - 1);
  const [usage, overrides] = await Promise.all([
    KitchenOrder.usageByDate(today, end, ['awaiting_payment', 'confirmed', 'preparing', 'cooking', 'out_for_delivery', 'delivered']),
    KitchenOrder.listOverrides(today, end),
  ]);
  const u = new Map(usage.map((x) => [isoDate(x.delivery_date), x]));
  const ov = new Map(overrides.map((x) => [isoDate(x.override_date), x]));
  const out = [];
  for (let d = today; d <= end; d = addDays(d, 1)) {
    out.push({
      date: d, capacity: schedule.capacityFor(d, cfg, ov.get(d)), portions: Number(u.get(d)?.portions || 0), orders: Number(u.get(d)?.orders || 0),
      maxOrders: cfg.maxOrdersPerDay, override: ov.get(d) ? { type: ov.get(d).override_type, capacity: ov.get(d).capacity_portions, reason: ov.get(d).reason } : null,
    });
  }
  return out;
}

export async function setOverride(body, user) {
  if (body.type === 'clear') await KitchenOrder.deleteOverride(body.date);
  else await KitchenOrder.upsertOverride({ date: body.date, type: body.type, capacityPortions: body.capacityPortions, reason: body.reason, userId: user.id });
}
