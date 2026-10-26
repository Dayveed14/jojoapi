// Operator review: suggested quote → proposed quote (versioned) → customer accepts or asks for a revision.
import { STATUS as S } from '../config/constants.js';
import { withTransaction } from '../db/pool.js';
import * as Availability from '../models/availability.model.js';
import * as Booking from '../models/booking.model.js';
import * as Market from '../models/market.model.js';
import * as Quote from '../models/quote.model.js';
import { hoursFromNow, isoDate } from '../utils/dates.js';
import { badRequest, conflict } from '../utils/errors.js';
import { money, toKobo, toNaira } from '../utils/money.js';
import * as auditService from './audit.service.js';
import * as availabilityService from './availability.service.js';
import * as mailService from './mail.service.js';
import * as pricingService from './pricing.service.js';
import * as settingsService from './settings.service.js';
import * as statusService from './bookingStatus.service.js';
import * as transportService from './transport.service.js';

/** What the system would charge. The operator can change any figure before sending. */
export async function suggest(b) {
  const { pricing, baseLocation } = await settingsService.getAll();
  const market = await Market.findById(b.market_id);
  const isSample = b.booking_type === 'sample_run';
  const transport = await transportService.estimate({
    base: baseLocation, market, bookingType: b.booking_type, deliveryRequired: Boolean(b.delivery_required), pricing,
    customer: b.addr_lat != null ? { lat: b.addr_lat, lng: b.addr_lng, label: b.addr_area } : null,
  });
  // Goods money collected upfront: the customer's own budget (full shop) or sample-cost cap (sample run).
  const goodsAmount = isSample ? money(b.authorized_goods_limit) : money(b.intended_goods_budget);
  const serviceFee = pricingService.serviceFee(b.booking_type, isSample ? 0 : money(b.goods_estimate_max), pricing);
  return {
    goodsAmount,
    serviceFee,
    transportCost: transport.cost,
    otherCharges: 0,
    upfrontAmount: toNaira(toKobo(goodsAmount) + toKobo(serviceFee) + toKobo(transport.cost)),
    transport, // legs + km: operator only
    assumptions: isSample
      ? 'Sample fee covers the trip and the time to inspect, photograph and price the items. Any sample cost is only spent up to your limit.'
      : 'Goods are bought at the day\'s market price, within your spending limit. Leftover goods money is refunded or kept as credit — your choice.',
  };
}

export async function propose(b, operator, body, ip) {
  const { operations: ops } = await settingsService.getAll();
  const upfrontK = toKobo(body.goodsAmount) + toKobo(body.serviceFee) + toKobo(body.transportCost) + toKobo(body.otherCharges || 0);
  if (upfrontK <= 0) throw badRequest('The quote total must be more than ₦0.');
  if (toKobo(body.goodsAmount) > toKobo(b.authorized_goods_limit)) {
    throw badRequest('Goods money in the quote is above the customer\'s spending limit. Lower it, or ask the customer to raise their limit.');
  }
  const suggestion = await suggest(b);

  const quote = await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    if (![S.SUBMITTED, S.AWAITING_CUSTOMER_APPROVAL].includes(locked.status)) throw conflict('This booking is no longer waiting for a quote.');
    const market = await Market.findById(locked.market_id, conn);

    const newDate = body.serviceDate && body.serviceDate !== isoDate(locked.service_date) ? body.serviceDate : null;
    if (newDate || body.timeWindow) {
      if (newDate) await availabilityService.move(conn, { bookingId: locked.id, date: newDate, bookingType: locked.booking_type, market });
      await Booking.reschedule(locked.id, newDate || isoDate(locked.service_date), body.timeWindow || locked.time_window, conn);
    } else {
      await availabilityService.recheck(conn, { bookingId: locked.id, date: isoDate(locked.service_date), bookingType: locked.booking_type, market });
    }

    await Quote.supersedeProposed(locked.id, conn);
    const validUntil = hoursFromNow(ops.quoteValidHours);
    const id = await Quote.create({
      bookingId: locked.id, version: await Quote.nextVersion(locked.id, conn),
      goodsAmount: body.goodsAmount, serviceFee: body.serviceFee, transportCost: body.transportCost,
      otherCharges: body.otherCharges || 0, otherLabel: body.otherLabel, upfrontAmount: toNaira(upfrontK),
      distanceKm: suggestion.transport.totalKm, distanceMethod: suggestion.transport.method,
      assumptions: body.assumptions || suggestion.assumptions, noteToCustomer: body.noteToCustomer,
      validUntil, createdBy: operator.id,
    }, conn);
    await statusService.transition(conn, locked, S.AWAITING_CUSTOMER_APPROVAL, operator, { reason: newDate ? `Date changed to ${newDate}` : null, expiresAt: validUntil });
    await Availability.extendHold(locked.id, validUntil, conn);
    return Quote.findById(id, conn);
  });

  await auditService.record({ actorUserId: operator.id, action: 'quote.proposed', entityType: 'booking', entityId: b.id, metadata: { version: quote.version_number, upfront: money(quote.upfront_amount) }, ip });
  await mailService.send({ to: b.customer_email, userId: b.customer_id, bookingId: b.id, ...mailService.templates.quoteReady(b, quote) });
  return quote;
}

export async function accept(b, customerId, quoteId, ip) {
  const { operations: ops } = await settingsService.getAll();
  await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    const quote = await Quote.findProposed(locked.id, conn);
    if (!quote || quote.id !== quoteId) throw conflict('This quote has changed. Please review the latest one.');
    if (quote.valid_until && new Date(quote.valid_until) <= new Date()) throw conflict('This quote has expired. Ask Jojo for a new one.');
    const market = await Market.findById(locked.market_id, conn);
    await availabilityService.recheck(conn, { bookingId: locked.id, date: isoDate(locked.service_date), bookingType: locked.booking_type, market });
    await Quote.setStatus(quote.id, 'accepted', conn);
    await Booking.setAcceptedQuote(locked.id, quote.id, conn);
    const payBy = hoursFromNow(ops.paymentWindowHours);
    await statusService.transition(conn, locked, S.AWAITING_PAYMENT, { id: customerId, role: 'customer' }, { expiresAt: payBy });
    await Availability.extendHold(locked.id, payBy, conn);
  });
  await auditService.record({ actorUserId: customerId, action: 'quote.accepted', entityType: 'booking', entityId: b.id, metadata: { quoteId }, ip });
}

export async function requestRevision(b, customerId, reason, ip) {
  const { operations: ops } = await settingsService.getAll();
  await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    const quote = await Quote.findProposed(locked.id, conn);
    if (quote) await Quote.setStatus(quote.id, 'rejected', conn);
    const until = hoursFromNow(ops.reviewHoldHours);
    await statusService.transition(conn, locked, S.SUBMITTED, { id: customerId, role: 'customer' }, { reason, expiresAt: until });
    await Availability.extendHold(locked.id, until, conn);
  });
  await auditService.record({ actorUserId: customerId, action: 'quote.revision_requested', entityType: 'booking', entityId: b.id, reason, ip });
}

export async function decline(b, operator, reason, ip) {
  await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    await statusService.transition(conn, locked, S.DECLINED, operator, { reason, expiresAt: null });
    await Availability.releaseHolds(locked.id, conn);
    const quote = await Quote.findProposed(locked.id, conn);
    if (quote) await Quote.setStatus(quote.id, 'rejected', conn);
  });
  await auditService.record({ actorUserId: operator.id, action: 'booking.declined', entityType: 'booking', entityId: b.id, reason, ip });
  const fresh = await Booking.findById(b.id);
  await mailService.send({ to: fresh.customer_email, userId: fresh.customer_id, bookingId: b.id, ...mailService.templates.declined(fresh) });
}
