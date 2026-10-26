// Payments. A booking is marked paid ONLY after:
//   • Paystack confirms the transaction server-side (verify API, amount + currency checked), or
//   • the operator confirms a bank transfer she has actually received.
// A "success" message in the browser is never proof of payment. Every step is idempotent.
import { env, paystackEnabled } from '../config/env.js';
import { STATUS as S } from '../config/constants.js';
import { withTransaction } from '../db/pool.js';
import * as Availability from '../models/availability.model.js';
import * as Booking from '../models/booking.model.js';
import * as Payment from '../models/payment.model.js';
import * as Quote from '../models/quote.model.js';
import * as Reconciliation from '../models/reconciliation.model.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import { money, toKobo, toNaira } from '../utils/money.js';
import { paymentReference } from '../utils/reference.js';
import * as auditService from './audit.service.js';
import * as mailService from './mail.service.js';
import * as paystack from './providers/paystack.provider.js';
import * as statusService from './bookingStatus.service.js';

export const onlineEnabled = () => paystackEnabled;
let provider = paystack;
export const setProvider = (p) => { provider = p; }; // tests

/** What the customer owes right now, and for what. */
export async function amountDue(b, { accepted, reconciliation } = {}, conn) {
  if (b.status === S.AWAITING_PAYMENT) {
    const quote = accepted || (b.accepted_quote_id ? await Quote.findById(b.accepted_quote_id, conn) : null);
    if (!quote) return { amount: 0, kind: null };
    const dueK = toKobo(quote.upfront_amount) - (await Payment.paidTotalKoboForBooking(b.id, conn));
    return { amount: toNaira(Math.max(0, dueK)), kind: 'charge', label: 'Upfront payment' };
  }
  const rec = reconciliation === undefined ? await Reconciliation.findByBooking(b.id, conn) : reconciliation;
  if (rec?.resolution_status === 'additional_due') {
    const dueK = toKobo(rec.actual_final_total) - (await Payment.paidTotalKoboForBooking(b.id, conn));
    return { amount: toNaira(Math.max(0, dueK)), kind: 'additional_charge', label: 'Balance for extra items you approved' };
  }
  return { amount: 0, kind: null };
}

/** After money lands: move the booking forward if it's now fully paid. Runs inside the caller's transaction. */
async function applyEffects(conn, bookingId, actor) {
  const b = await Booking.lockById(bookingId, conn);
  const due = await amountDue(b, {}, conn);
  if (due.amount > 0) return { booking: b, fullyPaid: false };

  if (b.status === S.AWAITING_PAYMENT) {
    await statusService.transition(conn, b, S.PAID, actor, { expiresAt: null });
    await Availability.consumeHold(b.id, conn);
    return { booking: b, fullyPaid: true, newlyPaid: true };
  }
  const rec = await Reconciliation.lockByBooking(b.id, conn);
  if (rec?.resolution_status === 'additional_due') {
    await Reconciliation.setResolution(b.id, { resolutionStatus: 'settled' }, conn);
  }
  return { booking: b, fullyPaid: true };
}

async function notifyPaid(bookingId, amount) {
  const b = await Booking.findById(bookingId);
  await mailService.send({ to: b.customer_email, userId: b.customer_id, bookingId, ...mailService.templates.paymentConfirmed(b, amount) });
}

// ---------- Online (Paystack) ----------

export async function startOnline(b, customer) {
  if (!paystackEnabled) throw new AppError(503, 'Online payment is not available yet. Please pay by bank transfer.', 'ONLINE_DISABLED');
  const due = await amountDue(b);
  if (!(due.amount > 0)) throw conflict('Nothing to pay on this booking right now.');
  const reference = paymentReference(b.reference);
  await Payment.create({
    bookingId: b.id, customerId: b.customer_id, provider: 'paystack', providerReference: reference, type: due.kind,
    amount: due.amount, status: 'initiated', metadata: { booking: b.reference },
  });
  const { authorizationUrl } = await provider.initialize({
    email: customer.email, amountKobo: toKobo(due.amount), reference,
    callbackUrl: `${env.CLIENT_ORIGIN}/app/payments/callback`,
    metadata: { booking_reference: b.reference, kind: due.kind },
  });
  return { authorizationUrl, reference };
}

/**
 * Confirm a Paystack payment (from the callback page or the webhook). Safe to call any number of times.
 * @param expectedCustomerId when called from the browser, the reference must belong to this customer
 */
export async function confirmOnline(reference, { expectedCustomerId = null } = {}) {
  if (!paystackEnabled) throw new AppError(503, 'Online payment is not configured.', 'ONLINE_DISABLED');
  const verified = await provider.verify(reference); // network call outside the DB transaction

  const result = await withTransaction(async (conn) => {
    const tx = await Payment.findByProviderRefForUpdate('paystack', reference, conn);
    if (!tx || (expectedCustomerId && tx.customer_id !== expectedCustomerId)) throw notFound('Payment not found');
    if (tx.status === 'successful') return { tx, alreadyDone: true };

    if (verified.status !== 'success') {
      if (['failed', 'abandoned', 'reversed'].includes(verified.status)) await Payment.markStatus(tx.id, 'failed', {}, conn);
      return { tx, failed: true, providerStatus: verified.status };
    }
    if (verified.amountKobo !== toKobo(tx.amount) || verified.currency !== 'NGN') {
      await Payment.markStatus(tx.id, 'failed', { metadata: { mismatch: true, paidKobo: verified.amountKobo, currency: verified.currency } }, conn);
      return { tx, failed: true, providerStatus: 'amount_mismatch' };
    }
    await Payment.markStatus(tx.id, 'successful', { metadata: { channel: verified.channel, paystack_id: verified.id } }, conn);
    const effects = await applyEffects(conn, tx.booking_id, { id: null, role: 'system' });
    return { tx, effects };
  });

  if (result.failed && result.providerStatus === 'amount_mismatch') {
    await auditService.record({ action: 'payment.amount_mismatch', entityType: 'payment', entityId: result.tx.id, metadata: { reference } });
  }
  if (result.effects) {
    await auditService.record({ action: 'payment.verified', entityType: 'payment', entityId: result.tx.id, metadata: { reference, amount: money(result.tx.amount) } });
    await notifyPaid(result.tx.booking_id, money(result.tx.amount));
  }
  const booking = await Booking.findById(result.tx.booking_id);
  return { status: result.failed ? 'failed' : 'successful', bookingReference: booking.reference, providerStatus: result.providerStatus };
}

export async function handleWebhook(rawBody, signature) {
  if (!provider.verifySignature(rawBody, signature)) throw new AppError(401, 'Invalid signature', 'BAD_SIGNATURE');
  const event = JSON.parse(rawBody.toString('utf8'));
  if (event?.event === 'charge.success' && event.data?.reference) {
    try {
      await confirmOnline(event.data.reference);
    } catch (err) {
      if (err.status !== 404) throw err; // unknown reference: acknowledge so Paystack stops retrying
    }
  }
}

// ---------- Bank transfer (manual) ----------

export async function submitManual(b, customerId, payerNote) {
  const due = await amountDue(b);
  if (!(due.amount > 0)) throw conflict('Nothing to pay on this booking right now.');
  if (await Payment.hasPending(b.id, due.kind)) throw conflict('We already have your transfer notice — Jojo will confirm it shortly.');
  await Payment.create({
    bookingId: b.id, customerId, provider: 'manual', type: due.kind, amount: due.amount, status: 'pending', payerNote: payerNote || null,
  });
  return { amount: due.amount };
}

export async function confirmManual(txId, operator, ip) {
  const result = await withTransaction(async (conn) => {
    const tx = await Payment.findByIdForUpdate(txId, conn);
    if (!tx || tx.provider !== 'manual') throw notFound('Payment not found');
    if (tx.status === 'successful') return { tx, alreadyDone: true };
    if (tx.status !== 'pending') throw conflict('Only pending transfers can be confirmed.');
    await Payment.markStatus(tx.id, 'successful', { verifiedBy: operator.id }, conn);
    const effects = await applyEffects(conn, tx.booking_id, { id: operator.id, role: 'operator' });
    return { tx, effects };
  });
  if (!result.alreadyDone) {
    await auditService.record({ actorUserId: operator.id, action: 'payment.manual_confirmed', entityType: 'payment', entityId: txId, metadata: { amount: money(result.tx.amount) }, ip });
    await notifyPaid(result.tx.booking_id, money(result.tx.amount));
  }
}

export async function rejectManual(txId, operator, reason, ip) {
  await withTransaction(async (conn) => {
    const tx = await Payment.findByIdForUpdate(txId, conn);
    if (!tx || tx.provider !== 'manual') throw notFound('Payment not found');
    if (tx.status !== 'pending') throw conflict('Only pending transfers can be rejected.');
    await Payment.markStatus(tx.id, 'failed', { metadata: { reason } }, conn);
  });
  await auditService.record({ actorUserId: operator.id, action: 'payment.manual_rejected', entityType: 'payment', entityId: txId, reason, ip });
}

// ---------- Jojo Market credit ----------

export async function payWithCredit(b, customerId, ip) {
  const result = await withTransaction(async (conn) => {
    await Payment.lockCustomerRow(customerId, conn); // one credit spend at a time per customer
    const locked = await Booking.lockById(b.id, conn);
    const due = await amountDue(locked, {}, conn);
    if (!(due.amount > 0)) throw conflict('Nothing to pay on this booking right now.');
    const balanceK = await Payment.creditBalanceKobo(customerId, conn);
    if (balanceK <= 0) throw badRequest('You have no Jojo Market credit.');
    const useK = Math.min(balanceK, toKobo(due.amount));
    await Payment.create({ bookingId: b.id, customerId, provider: 'credit', type: 'credit_applied', amount: toNaira(useK), status: 'successful', verifiedAt: new Date() }, conn);
    const effects = await applyEffects(conn, b.id, { id: null, role: 'system' });
    return { used: toNaira(useK), effects };
  });
  await auditService.record({ actorUserId: customerId, action: 'payment.credit_applied', entityType: 'booking', entityId: b.id, metadata: { amount: result.used }, ip });
  if (result.effects.newlyPaid) await notifyPaid(b.id, result.used);
  return { used: result.used, fullyPaid: result.effects.fullyPaid };
}

// ---------- Lists ----------

export async function listForCustomer(customerId) {
  const rows = await Payment.listForCustomer(customerId);
  return {
    creditBalance: toNaira(await Payment.creditBalanceKobo(customerId)),
    items: rows.map((t) => ({
      id: t.id, bookingReference: t.booking_reference, provider: t.provider, type: t.transaction_type,
      amount: money(t.amount), status: t.status, createdAt: t.created_at, verifiedAt: t.verified_at,
    })),
  };
}
