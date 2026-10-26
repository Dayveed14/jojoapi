// Final accounting: what was quoted, what was paid, what it actually cost.
// Surplus → customer chooses refund or Jojo Market credit. Shortfall → only from approved extra spending.
// Successful payments are never edited; adjustments are new transactions.
import { withTransaction } from '../db/pool.js';
import * as Booking from '../models/booking.model.js';
import * as Payment from '../models/payment.model.js';
import * as Quote from '../models/quote.model.js';
import * as Reconciliation from '../models/reconciliation.model.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { money, toKobo, toNaira } from '../utils/money.js';
import * as auditService from './audit.service.js';
import * as mailService from './mail.service.js';

/** Runs inside the completion transaction. */
export async function reconcile(conn, booking, record, operator) {
  const quote = booking.accepted_quote_id ? await Quote.findById(booking.accepted_quote_id, conn) : null;
  const paidK = await Payment.paidTotalKoboForBooking(booking.id, conn);
  const finalK = toKobo(record.final_total);
  const diff = paidK - finalK;
  const row = {
    bookingId: booking.id,
    purchaseRecordId: record.id,
    quotedTotal: money(quote?.upfront_amount || 0),
    paidTotal: toNaira(paidK),
    actualFinalTotal: toNaira(finalK),
    refundDue: diff > 0 ? toNaira(diff) : 0,
    additionalDue: diff < 0 ? toNaira(-diff) : 0,
    resolutionStatus: diff > 0 ? 'awaiting_customer' : diff < 0 ? 'additional_due' : 'settled',
    createdBy: operator.id,
  };
  await Reconciliation.upsert(row, conn);
  return { refundDue: row.refundDue, additionalDue: row.additionalDue, finalTotal: row.actualFinalTotal, paidTotal: row.paidTotal, status: row.resolutionStatus };
}

/** Customer picks how to receive leftover money. */
export async function chooseRefundOrCredit(b, customerId, choice, ip) {
  const result = await withTransaction(async (conn) => {
    const rec = await Reconciliation.lockByBooking(b.id, conn);
    if (!rec || rec.resolution_status !== 'awaiting_customer') throw conflict('There is no balance waiting for your choice.');
    if (choice === 'credit') {
      await Payment.create({
        bookingId: b.id, customerId, provider: 'credit', type: 'credit_issued', amount: rec.refund_due, status: 'successful',
        verifiedAt: new Date(), idempotencyKey: `credit-issue-${b.id}`,
      }, conn);
      await Reconciliation.setResolution(b.id, { resolutionStatus: 'credited', customerChoice: 'credit' }, conn);
    } else {
      await Reconciliation.setResolution(b.id, { resolutionStatus: 'refund_pending', customerChoice: 'refund' }, conn);
    }
    return { amount: money(rec.refund_due) };
  });
  await auditService.record({ actorUserId: customerId, action: `reconciliation.${choice}_chosen`, entityType: 'booking', entityId: b.id, metadata: result, ip });
  return result;
}

/** Operator records that the refund has been sent (bank transfer or provider refund). */
export async function recordRefund(b, operator, { method, reference, note }, ip) {
  const amount = await withTransaction(async (conn) => {
    const rec = await Reconciliation.lockByBooking(b.id, conn);
    if (!rec) throw notFound('No reconciliation for this booking.');
    if (rec.resolution_status !== 'refund_pending') throw conflict('This booking has no refund pending.');
    if (!(toKobo(rec.refund_due) > 0)) throw badRequest('Nothing to refund.');
    await Payment.create({
      bookingId: b.id, customerId: b.customer_id, provider: method === 'paystack' ? 'paystack' : 'manual',
      providerReference: method === 'paystack' ? reference : null, type: 'refund', amount: rec.refund_due, status: 'successful',
      payerNote: [reference && method !== 'paystack' ? `Ref: ${reference}` : null, note].filter(Boolean).join(' · ') || null,
      verifiedAt: new Date(), verifiedBy: operator.id, idempotencyKey: `refund-${b.id}`,
    }, conn);
    await Reconciliation.setResolution(b.id, { resolutionStatus: 'refunded' }, conn);
    return money(rec.refund_due);
  });
  await auditService.record({ actorUserId: operator.id, action: 'reconciliation.refund_sent', entityType: 'booking', entityId: b.id, metadata: { amount, method }, ip });
  const fresh = await Booking.findById(b.id);
  await mailService.send({ to: fresh.customer_email, userId: fresh.customer_id, bookingId: b.id, ...mailService.templates.refundSent(fresh, amount) });
}

/** Operator overrides (e.g. waives a small balance or marks a dispute). Always audited with a reason. */
export async function setStatusManually(b, operator, { status, reason }, ip) {
  await withTransaction(async (conn) => {
    const rec = await Reconciliation.lockByBooking(b.id, conn);
    if (!rec) throw notFound('No reconciliation for this booking.');
    await Reconciliation.setResolution(b.id, { resolutionStatus: status }, conn);
  });
  await auditService.record({ actorUserId: operator.id, action: 'reconciliation.status_set', entityType: 'booking', entityId: b.id, reason, metadata: { status }, ip });
}

export const listOpen = () => Reconciliation.listOpen();
