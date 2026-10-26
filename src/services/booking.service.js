// Customer booking flow: estimate → submit → (quote, pay, shop, complete in other services).
import { CAPACITY_STATUSES, CUSTOMER_CANCELLABLE, STATUS as S, STATUS_LABELS } from '../config/constants.js';
import { withTransaction } from '../db/pool.js';
import * as Attachment from '../models/attachment.model.js';
import * as Booking from '../models/booking.model.js';
import * as Catalog from '../models/catalog.model.js';
import * as ChangeRequest from '../models/changeRequest.model.js';
import * as Payment from '../models/payment.model.js';
import * as Purchase from '../models/purchase.model.js';
import * as Quote from '../models/quote.model.js';
import * as Reconciliation from '../models/reconciliation.model.js';
import * as Availability from '../models/availability.model.js';
import { hoursFromNow, isoDate } from '../utils/dates.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { money, toKobo, toNaira } from '../utils/money.js';
import { bookingReference } from '../utils/reference.js';
import * as addressService from './address.service.js';
import * as auditService from './audit.service.js';
import * as availabilityService from './availability.service.js';
import * as catalogService from './catalog.service.js';
import * as mailService from './mail.service.js';
import * as paymentService from './payment.service.js';
import * as pricingService from './pricing.service.js';
import * as settingsService from './settings.service.js';
import * as statusService from './bookingStatus.service.js';
import * as transportService from './transport.service.js';

// ---------- Estimate (used by the wizard's review step and on submit) ----------

async function priceRequest(body) {
  const market = await catalogService.getActiveMarket(body.marketId);
  const itemIds = [...new Set(body.items.map((i) => i.catalogItemId).filter(Boolean))];
  const itemsById = await Catalog.findItemsWithOptions(itemIds);
  for (const id of itemIds) {
    const it = itemsById.get(id);
    if (it && !market.category_ids.includes(it.category_id)) {
      throw badRequest(`${it.name} isn't something Jojo buys at ${market.name}. Remove it or choose another market.`);
    }
  }
  const priced = pricingService.priceLines(body.items, itemsById, body.bookingType);
  return { market, ...priced };
}

async function transportFor({ market, address, bookingType, deliveryRequired }) {
  const { pricing, baseLocation } = await settingsService.getAll();
  return transportService.estimate({
    base: baseLocation, market, bookingType, deliveryRequired, pricing,
    customer: address ? { lat: address.area_lat, lng: address.area_lng, label: address.area_name } : null,
  });
}

export async function estimate(customerId, body) {
  const { pricing } = await settingsService.getAll();
  const { market, lines, goodsMin, goodsMax } = await priceRequest(body);
  const address = body.addressId ? await addressService.getOwned(body.addressId, customerId) : null;
  const deliveryRequired = body.bookingType === 'full_purchase' ? true : Boolean(body.deliveryRequired);
  const transport = address || body.bookingType === 'sample_run'
    ? await transportFor({ market, address, bookingType: body.bookingType, deliveryRequired })
    : null;

  const goodsForFee = body.bookingType === 'sample_run' ? 0 : goodsMax;
  const fee = pricingService.serviceFee(body.bookingType, goodsForFee, pricing);
  const sampleLimit = body.bookingType === 'sample_run' ? money(body.authorizedGoodsLimit || 0) : 0;
  const goodsUpfront = body.bookingType === 'sample_run' ? sampleLimit : goodsMax;

  return {
    lines: lines.map((l) => ({ itemName: l.itemName, optionLabel: l.optionLabel, requestMethod: l.requestMethod, quantity: l.quantity, amount: l.amount, estimateMin: l.estimateMin, estimateMax: l.estimateMax, priceType: l.priceType })),
    goodsMin,
    goodsMax,
    serviceFee: fee,
    transportEstimate: transport ? transport.cost : null, // naira only — no distances or base location
    estimatedTotalMin: toNaira(toKobo(body.bookingType === 'sample_run' ? sampleLimit : goodsMin) + toKobo(fee) + toKobo(transport?.cost || 0)),
    estimatedTotalMax: toNaira(toKobo(goodsUpfront) + toKobo(fee) + toKobo(transport?.cost || 0)),
    suggestedLimit: body.bookingType === 'sample_run' ? sampleLimit : pricingService.suggestedLimit(goodsMax, pricing),
    market: { id: market.id, name: market.name },
    assumptions: [
      'Market prices change daily. All goods figures are estimates until Jojo shops.',
      'Fixed prices are for the standard unit shown (for example, one basket). An amount like "₦7,000 of tomatoes" buys what that money gets on the day.',
      'Transport is estimated by road from Jojo\'s base to the market and to your area, and confirmed in the quote.',
      'You pay only after Jojo accepts and sends a quote. Any money left over is refunded or kept as credit — your choice.',
    ],
  };
}

// ---------- Submit ----------

export async function create(customerId, body, ip) {
  const { operations: ops } = await settingsService.getAll();
  const { market, lines, goodsMin, goodsMax } = await priceRequest(body);
  const isSample = body.bookingType === 'sample_run';
  const deliveryRequired = isSample ? Boolean(body.deliveryRequired) : true;

  let address = null;
  if (deliveryRequired) {
    if (!body.addressId) throw badRequest('Choose a delivery address.', { fields: { addressId: 'Choose a delivery address' } });
    address = await addressService.getOwned(body.addressId, customerId);
  }

  // Budget vs authorised limit are separate numbers (spec §6.4). We never infer permission to overspend.
  let intended = money(body.intendedGoodsBudget ?? goodsMax);
  let limit = money(body.authorizedGoodsLimit ?? intended);
  if (isSample) {
    intended = 0;
    limit = money(body.authorizedGoodsLimit || 0); // optional cap for buying small samples
  } else {
    if (!(intended > 0)) throw badRequest('Enter your goods budget.', { fields: { intendedGoodsBudget: 'Enter your goods budget' } });
    if (toKobo(limit) < toKobo(intended)) throw badRequest('Your spending limit must be at least your budget.', { fields: { authorizedGoodsLimit: 'Must be at least your budget' } });
    if (toKobo(limit) < toKobo(goodsMin)) {
      throw badRequest(`Your spending limit is below the lowest estimate for your list (₦${goodsMin.toLocaleString('en-NG')}). Raise it or trim the list.`, { fields: { authorizedGoodsLimit: 'Below the lowest estimate' } });
    }
  }

  let sourceBookingId = null;
  if (body.sourceReference) {
    const src = await Booking.findByReferenceForCustomer(body.sourceReference, customerId);
    if (!src) throw badRequest('The linked booking was not found.');
    sourceBookingId = src.id;
  }

  const expiresAt = hoursFromNow(ops.reviewHoldHours);
  const booking = await withTransaction(async (conn) => {
    await availabilityService.lockAndCheck(conn, { date: body.serviceDate, bookingType: body.bookingType, market });
    let reference;
    for (let i = 0; i < 5; i++) { // references are random; retry on the rare collision
      reference = bookingReference();
      if (!(await Booking.findByReference(reference, conn))) break;
    }
    const bookingId = await Booking.create({
      reference, customerId, marketId: market.id, bookingType: body.bookingType, status: S.SUBMITTED,
      serviceDate: body.serviceDate, timeWindow: body.timeWindow, deliveryRequired, address,
      goodsEstimateMin: goodsMin, goodsEstimateMax: goodsMax, intendedGoodsBudget: intended, authorizedGoodsLimit: limit,
      customerNotes: body.customerNotes, sourceBookingId, expiresAt,
    }, conn);
    await availabilityService.hold(conn, { bookingId, date: body.serviceDate, bookingType: body.bookingType, expiresAt });
    await Booking.insertItems(bookingId, lines, conn);
    await Booking.insertEvent({ bookingId, fromStatus: null, toStatus: S.SUBMITTED, actorUserId: customerId }, conn);
    return Booking.findById(bookingId, conn);
  });

  await auditService.record({ actorUserId: customerId, action: 'booking.submitted', entityType: 'booking', entityId: booking.id, metadata: { reference: booking.reference, type: booking.booking_type }, ip });
  await mailService.send({ to: booking.customer_email, userId: customerId, bookingId: booking.id, ...mailService.templates.bookingReceived(booking) });
  return booking;
}

// ---------- Read ----------

export async function getForCustomer(reference, customerId) {
  const b = await Booking.findByReferenceForCustomer(reference, customerId);
  if (!b) throw notFound('Booking not found');
  return b;
}

export async function getForOperator(reference) {
  const b = await Booking.findByReference(reference);
  if (!b) throw notFound('Booking not found');
  return b;
}

export function presentSummary(b) {
  return {
    reference: b.reference,
    bookingType: b.booking_type,
    status: b.status,
    statusLabel: STATUS_LABELS[b.status] || b.status,
    serviceDate: isoDate(b.service_date),
    timeWindow: b.time_window,
    market: { id: b.market_id, name: b.market_name, area: b.market_area },
    goodsEstimateMin: money(b.goods_estimate_min),
    goodsEstimateMax: money(b.goods_estimate_max),
    authorizedGoodsLimit: money(b.authorized_goods_limit),
    submittedAt: b.submitted_at,
    completedAt: b.completed_at,
    expiresAt: b.expires_at,
    customerName: b.customer_name,
  };
}

const presentQuote = (q, { internal = false } = {}) => q && ({
  id: q.id,
  version: q.version_number,
  goodsAmount: money(q.goods_amount),
  serviceFee: money(q.service_fee),
  transportCost: money(q.transport_cost),
  otherCharges: money(q.other_charges),
  otherLabel: q.other_label,
  upfrontAmount: money(q.upfront_amount),
  assumptions: q.assumptions,
  noteToCustomer: q.note_to_customer,
  status: q.status,
  validUntil: q.valid_until,
  createdAt: q.created_at,
  ...(internal ? { distanceKm: q.distance_km == null ? null : Number(q.distance_km), distanceMethod: q.distance_method } : {}),
});

const presentItem = (i) => ({
  id: i.id,
  catalogItemId: i.catalog_item_id,
  optionId: i.option_id,
  itemName: i.item_name,
  optionLabel: i.option_label,
  priceType: i.price_type,
  price: money(i.price_snapshot),
  priceMin: money(i.price_min_snapshot),
  priceMax: money(i.price_max_snapshot),
  requestMethod: i.request_method,
  quantity: i.quantity == null ? null : Number(i.quantity),
  amount: money(i.amount),
  estimateMin: money(i.estimate_min),
  estimateMax: money(i.estimate_max),
  preferences: i.preferences,
  allowSubstitution: Boolean(i.allow_substitution),
});

const presentPurchaseItem = (p) => ({
  id: p.id,
  bookingItemId: p.booking_item_id,
  itemName: p.item_name,
  optionLabel: p.option_label,
  outcome: p.outcome,
  actualQuantity: p.actual_quantity == null ? null : Number(p.actual_quantity),
  quantityNote: p.quantity_note,
  actualAmount: money(p.actual_amount),
  observedPrice: money(p.observed_price),
  notes: p.notes,
});

const presentTransaction = (t) => ({
  id: t.id,
  provider: t.provider,
  type: t.transaction_type,
  amount: money(t.amount),
  status: t.status,
  reference: t.provider_reference,
  payerNote: t.payer_note,
  createdAt: t.created_at,
  verifiedAt: t.verified_at,
});

/** Full booking view. `audience` = 'customer' | 'operator' controls what is exposed. */
export async function presentDetail(b, audience) {
  const internal = audience === 'operator';
  const [items, quotes, events, payments, changes, record, attachments, reconciliation, linked] = await Promise.all([
    Booking.listItems(b.id), Quote.listForBooking(b.id), Booking.listEvents(b.id), Payment.listForBooking(b.id),
    ChangeRequest.listForBooking(b.id), Purchase.findByBooking(b.id), Attachment.listForBooking(b.id),
    Reconciliation.findByBooking(b.id), Booking.listLinked(b.id),
  ]);
  const purchaseItems = record ? await Purchase.listItems(record.id) : [];
  const proposed = quotes.find((q) => q.status === 'proposed');
  const accepted = quotes.find((q) => q.id === b.accepted_quote_id);
  const due = await paymentService.amountDue(b, { accepted, reconciliation });
  const creditBalance = toNaira(await Payment.creditBalanceKobo(b.customer_id));
  const { payments: paySettings } = await settingsService.getAll();
  const source = b.source_booking_id ? await Booking.findById(b.source_booking_id) : null;

  // Customers see the shopping sheet once shopping has started; amounts are final only at completion.
  const showPurchase = record && [S.SHOPPING_IN_PROGRESS, S.AWAITING_CUSTOMER_DECISION, S.READY_FOR_DELIVERY, S.COMPLETED].includes(b.status);

  const detail = {
    ...presentSummary(b),
    deliveryRequired: Boolean(b.delivery_required),
    address: b.delivery_required ? {
      label: b.addr_label, recipientName: b.addr_recipient, recipientPhone: b.addr_phone, addressLine: b.addr_line,
      area: b.addr_area, landmark: b.addr_landmark, instructions: b.addr_instructions,
    } : null,
    intendedGoodsBudget: money(b.intended_goods_budget),
    customerNotes: b.customer_notes,
    statusReason: b.status_reason,
    items: items.map(presentItem),
    quote: presentQuote(proposed || accepted, { internal }),
    quotes: internal ? quotes.map((q) => presentQuote(q, { internal })) : quotes.filter((q) => ['proposed', 'accepted'].includes(q.status)).map((q) => presentQuote(q)),
    timeline: events.map((e) => ({ from: e.from_status, to: e.to_status, label: STATUS_LABELS[e.to_status], reason: e.reason, at: e.created_at, by: e.actor_role || 'system' })),
    payments: payments.filter((t) => internal || t.status !== 'initiated').map(presentTransaction),
    amountDue: due,
    creditBalance,
    manualPayment: paySettings.allowManualTransfer && (due.amount > 0) ? {
      bankName: paySettings.bankName, accountName: paySettings.accountName, accountNumber: paySettings.accountNumber, instructions: paySettings.instructions,
    } : null,
    onlinePayment: paymentService.onlineEnabled(),
    changeRequests: changes.map((c) => ({
      id: c.id, type: c.request_type, itemName: c.item_name, description: c.description, extraAmount: money(c.extra_amount),
      status: c.status, customerNote: c.customer_note, createdAt: c.created_at, decidedAt: c.decided_at,
    })),
    purchase: showPurchase || (internal && record) ? {
      goodsTotal: money(record.goods_total),
      serviceFee: money(record.service_fee_actual),
      transportCost: money(record.transport_cost_actual),
      otherCosts: money(record.other_costs),
      otherLabel: record.other_label,
      finalTotal: money(record.final_total),
      summaryNote: record.summary_note,
      shoppingStartedAt: record.shopping_started_at,
      shoppingCompletedAt: record.shopping_completed_at,
      deliveredAt: record.delivered_at,
      items: purchaseItems.map(presentPurchaseItem),
      ...(internal ? { internalNotes: record.internal_notes } : {}),
    } : null,
    attachments: attachments.map((a) => ({ id: a.id, kind: a.kind, caption: a.caption, createdAt: a.created_at })),
    reconciliation: reconciliation ? {
      quotedTotal: money(reconciliation.quoted_total), paidTotal: money(reconciliation.paid_total),
      finalTotal: money(reconciliation.actual_final_total), refundDue: money(reconciliation.refund_due),
      additionalDue: money(reconciliation.additional_due), customerChoice: reconciliation.customer_choice,
      status: reconciliation.resolution_status, notes: reconciliation.notes,
    } : null,
    source: source ? { reference: source.reference, bookingType: source.booking_type } : null,
    linked: linked.map((l) => ({ reference: l.reference, bookingType: l.booking_type, status: l.status })),
    actions: {
      canCancel: CUSTOMER_CANCELLABLE.includes(b.status),
      canAcceptQuote: b.status === S.AWAITING_CUSTOMER_APPROVAL && Boolean(proposed),
      canPay: due.amount > 0,
      canChooseRefund: reconciliation?.resolution_status === 'awaiting_customer',
      canProceedFromSample: b.booking_type === 'sample_run' && [S.READY_FOR_DELIVERY, S.COMPLETED].includes(b.status),
    },
  };

  if (internal) {
    detail.customer = { id: b.customer_id, name: b.customer_name, email: b.customer_email, phone: b.customer_phone };
    detail.addressAreaKnown = b.addr_lat != null;
  }
  return detail;
}

export async function listForCustomer(customerId, scope) {
  const scopes = {
    active: CAPACITY_STATUSES,
    completed: [S.COMPLETED],
    closed: [S.DECLINED, S.CANCELLED, S.EXPIRED],
  };
  const rows = await Booking.listForCustomer(customerId, { statuses: scopes[scope] });
  return rows.map(presentSummary);
}

export async function dashboardForCustomer(customerId) {
  const counts = await Booking.countByStatus({ customerId });
  const active = await Booking.listForCustomer(customerId, { statuses: CAPACITY_STATUSES, limit: 5 });
  const recent = await Booking.listForCustomer(customerId, { statuses: [S.COMPLETED], limit: 3 });
  const waiting = (counts[S.AWAITING_CUSTOMER_APPROVAL] || 0) + (counts[S.AWAITING_PAYMENT] || 0) + (counts[S.AWAITING_CUSTOMER_DECISION] || 0);
  return {
    counts: {
      upcoming: CAPACITY_STATUSES.reduce((a, s) => a + (counts[s] || 0), 0),
      waitingOnYou: waiting,
      completed: counts[S.COMPLETED] || 0,
    },
    active: active.map(presentSummary),
    recent: recent.map(presentSummary),
  };
}

// ---------- Customer actions ----------

export async function cancelByCustomer(reference, customerId, reason, ip) {
  const b = await getForCustomer(reference, customerId);
  if (!CUSTOMER_CANCELLABLE.includes(b.status)) throw conflict('This booking can no longer be cancelled online — shopping has started. Please contact Jojo.');
  await cancel(b, { id: customerId, role: 'customer' }, reason, ip);
}

/** Cancel (customer or operator). Releases the date; if money was received, opens a refund/credit. */
export async function cancel(b, actor, reason, ip) {
  await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    await statusService.transition(conn, locked, S.CANCELLED, actor, { reason: reason || null, expiresAt: null });
    await Availability.releaseHolds(b.id, conn);
    const proposed = await Quote.findProposed(b.id, conn);
    if (proposed) await Quote.setStatus(proposed.id, 'rejected', conn);
    const paidK = await Payment.paidTotalKoboForBooking(b.id, conn);
    if (paidK > 0) {
      await Reconciliation.upsert({
        bookingId: b.id, purchaseRecordId: null, quotedTotal: toNaira(paidK), paidTotal: toNaira(paidK), actualFinalTotal: 0,
        refundDue: toNaira(paidK), additionalDue: 0, resolutionStatus: 'awaiting_customer',
        notes: 'Cancelled before shopping — full amount returned.', createdBy: actor.id ?? b.customer_id,
      }, conn);
    }
  });
  await auditService.record({ actorUserId: actor.id ?? null, action: 'booking.cancelled', entityType: 'booking', entityId: b.id, reason, ip });
}

/** Items to prefill a new booking from a past one (prices are re-checked against today's catalogue). */
export async function repeatSource(reference, customerId) {
  const b = await getForCustomer(reference, customerId);
  const items = await Booking.listItems(b.id);
  return {
    marketId: b.market_id,
    bookingType: b.booking_type === 'sample_run' ? 'full_purchase' : b.booking_type,
    sourceReference: b.booking_type === 'sample_run' ? b.reference : null,
    items: items.map((i) => ({
      catalogItemId: i.catalog_item_id, optionId: i.option_id, customName: i.catalog_item_id ? null : i.item_name,
      requestMethod: i.request_method, quantity: i.quantity == null ? null : Number(i.quantity), amount: money(i.amount),
      preferences: i.preferences, allowSubstitution: Boolean(i.allow_substitution),
    })),
  };
}
