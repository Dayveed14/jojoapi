// Operator's shopping day: start → record actual items/prices → ask the customer when needed → finish → complete.
// The authorised goods limit is enforced HERE, on the server: the sheet cannot be saved above it.
import { STATUS as S } from '../config/constants.js';
import { withTransaction } from '../db/pool.js';
import * as Attachment from '../models/attachment.model.js';
import * as Booking from '../models/booking.model.js';
import * as ChangeRequest from '../models/changeRequest.model.js';
import * as Purchase from '../models/purchase.model.js';
import * as Quote from '../models/quote.model.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { formatNaira, money, toKobo, toNaira } from '../utils/money.js';
import * as auditService from './audit.service.js';
import * as mailService from './mail.service.js';
import * as reconciliationService from './reconciliation.service.js';
import * as restockService from './restock.service.js';
import * as statusService from './bookingStatus.service.js';
import * as uploadService from './upload.service.js';

const EDITABLE = [S.SHOPPING_IN_PROGRESS, S.AWAITING_CUSTOMER_DECISION, S.READY_FOR_DELIVERY];

export async function start(b, operator, ip) {
  await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    await statusService.transition(conn, locked, S.SHOPPING_IN_PROGRESS, operator);
    if (!(await Purchase.findByBooking(locked.id, conn))) {
      const quote = locked.accepted_quote_id ? await Quote.findById(locked.accepted_quote_id, conn) : null;
      const recordId = await Purchase.createRecord(locked.id, operator.id, {
        serviceFee: quote?.service_fee || 0, transportCost: quote?.transport_cost || 0,
      }, conn);
      // Pre-fill the sheet from what the customer asked for; actual amounts start at ₦0.
      const items = await Booking.listItems(locked.id, conn);
      await Purchase.replaceItems(recordId, items.map((i) => ({
        bookingItemId: i.id, catalogItemId: i.catalog_item_id, optionId: i.option_id, itemName: i.item_name, optionLabel: i.option_label,
        outcome: locked.booking_type === 'sample_run' ? 'sampled' : 'bought', actualAmount: 0,
      })), conn);
    }
  });
  await auditService.record({ actorUserId: operator.id, action: 'shopping.started', entityType: 'booking', entityId: b.id, ip });
}

/** Save the whole shopping sheet. Rejects totals above the authorised limit. */
export async function saveSheet(b, operator, body, ip) {
  const result = await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    if (!EDITABLE.includes(locked.status)) throw conflict('The shopping record can only be edited while shopping is in progress.');
    const record = await Purchase.findByBooking(locked.id, conn);
    if (!record) throw conflict('Start shopping first.');

    const bookingItems = await Booking.listItems(locked.id, conn);
    const validIds = new Set(bookingItems.map((i) => i.id));
    for (const line of body.items) {
      if (line.bookingItemId && !validIds.has(line.bookingItemId)) throw badRequest('One of the lines does not belong to this booking.');
    }

    const goodsK = body.items.reduce((a, l) => a + toKobo(l.actualAmount), 0);
    const limitK = toKobo(locked.authorized_goods_limit);
    if (goodsK > limitK) {
      const overBy = toNaira(goodsK - limitK);
      throw conflict(`Goods total ${formatNaira(toNaira(goodsK))} is ${formatNaira(overBy)} above the customer's limit of ${formatNaira(toNaira(limitK))}. Ask the customer to approve the extra amount first.`);
    }

    const finalK = goodsK + toKobo(body.serviceFee) + toKobo(body.transportCost) + toKobo(body.otherCosts || 0);
    await Purchase.replaceItems(record.id, body.items.map((l) => {
      const bi = bookingItems.find((i) => i.id === l.bookingItemId);
      return {
        bookingItemId: l.bookingItemId ?? null, catalogItemId: bi?.catalog_item_id ?? null, optionId: bi?.option_id ?? null,
        itemName: l.itemName || bi?.item_name || 'Item', optionLabel: l.optionLabel ?? bi?.option_label ?? null,
        outcome: l.outcome, actualQuantity: l.actualQuantity ?? null, quantityNote: l.quantityNote || null,
        actualAmount: money(l.actualAmount), observedPrice: l.observedPrice ?? null, notes: l.notes || null,
      };
    }), conn);
    await Purchase.updateRecord(record.id, {
      goodsTotal: toNaira(goodsK), serviceFee: body.serviceFee, transportCost: body.transportCost, otherCosts: body.otherCosts || 0,
      otherLabel: body.otherLabel, finalTotal: toNaira(finalK), summaryNote: body.summaryNote, internalNotes: body.internalNotes,
    }, conn);
    return { goodsTotal: toNaira(goodsK), finalTotal: toNaira(finalK), limit: money(locked.authorized_goods_limit) };
  });
  await auditService.record({ actorUserId: operator.id, action: 'shopping.sheet_saved', entityType: 'booking', entityId: b.id, metadata: { goodsTotal: result.goodsTotal }, ip });
  return result;
}

/** Ask the customer to approve extra spending or a substitution. Shopping pauses until they answer. */
export async function requestChange(b, operator, body, ip) {
  await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    if (![S.SHOPPING_IN_PROGRESS, S.AWAITING_CUSTOMER_DECISION].includes(locked.status)) throw conflict('You can only ask the customer while shopping.');
    if (body.bookingItemId) {
      const items = await Booking.listItems(locked.id, conn);
      if (!items.some((i) => i.id === body.bookingItemId)) throw badRequest('That item is not on this booking.');
    }
    if (body.type === 'extra_spend' && !(body.extraAmount > 0)) throw badRequest('Enter the extra amount needed.');
    await ChangeRequest.create({ bookingId: locked.id, type: body.type, bookingItemId: body.bookingItemId, description: body.description, extraAmount: body.type === 'extra_spend' ? body.extraAmount : 0, createdBy: operator.id }, conn);
    if (locked.status === S.SHOPPING_IN_PROGRESS) await statusService.transition(conn, locked, S.AWAITING_CUSTOMER_DECISION, operator, { reason: body.description });
  });
  await auditService.record({ actorUserId: operator.id, action: 'shopping.change_requested', entityType: 'booking', entityId: b.id, metadata: { type: body.type, extraAmount: body.extraAmount || 0 }, ip });
  await mailService.send({ to: b.customer_email, userId: b.customer_id, bookingId: b.id, ...mailService.templates.decisionNeeded(b) });
}

/** Customer approves/rejects. Approving extra spend raises the authorised limit by exactly that amount. */
export async function decideChange(b, customerId, requestId, { decision, note }, ip) {
  const outcome = await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    const reqRow = await ChangeRequest.findForUpdate(requestId, locked.id, conn);
    if (!reqRow) throw notFound('Request not found');
    if (reqRow.status !== 'pending') throw conflict('You have already answered this request.');
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await ChangeRequest.decide(reqRow.id, { status, decidedBy: customerId, customerNote: note }, conn);
    if (status === 'approved' && reqRow.request_type === 'extra_spend') {
      await Booking.raiseAuthorizedLimit(locked.id, reqRow.extra_amount, conn);
    }
    if (locked.status === S.AWAITING_CUSTOMER_DECISION && (await ChangeRequest.countPending(locked.id, conn)) === 0) {
      await statusService.transition(conn, locked, S.SHOPPING_IN_PROGRESS, { id: customerId, role: 'customer' }, { reason: `Customer ${status} request` });
    }
    return { status, type: reqRow.request_type, amount: money(reqRow.extra_amount) };
  });
  await auditService.record({
    actorUserId: customerId, action: outcome.status === 'approved' && outcome.type === 'extra_spend' ? 'booking.extra_spend_approved' : `booking.change_${outcome.status}`,
    entityType: 'booking', entityId: b.id, metadata: { requestId, amount: outcome.amount }, ip,
  });
  return outcome;
}

export async function withdrawChange(b, operator, requestId) {
  await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    const reqRow = await ChangeRequest.findForUpdate(requestId, locked.id, conn);
    if (!reqRow || reqRow.status !== 'pending') throw conflict('Only pending requests can be withdrawn.');
    await ChangeRequest.decide(reqRow.id, { status: 'withdrawn', decidedBy: operator.id }, conn);
    if (locked.status === S.AWAITING_CUSTOMER_DECISION && (await ChangeRequest.countPending(locked.id, conn)) === 0) {
      await statusService.transition(conn, locked, S.SHOPPING_IN_PROGRESS, operator, { reason: 'Request withdrawn' });
    }
  });
}

export async function finish(b, operator, ip) {
  await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    if ((await ChangeRequest.countPending(locked.id, conn)) > 0) throw conflict('Wait for the customer to answer the open request first.');
    const record = await Purchase.findByBooking(locked.id, conn);
    const items = record ? await Purchase.listItems(record.id, conn) : [];
    if (!items.length) throw conflict('Record at least one line before finishing.');
    await statusService.transition(conn, locked, S.READY_FOR_DELIVERY, operator);
    await Purchase.markShoppingCompleted(record.id, conn);
  });
  await auditService.record({ actorUserId: operator.id, action: 'shopping.finished', entityType: 'booking', entityId: b.id, ip });
  await mailService.send({ to: b.customer_email, userId: b.customer_id, bookingId: b.id, ...mailService.templates.shoppingDone(b) });
}

export async function reopen(b, operator) {
  await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    await statusService.transition(conn, locked, S.SHOPPING_IN_PROGRESS, operator, { reason: 'Shopping record reopened for correction' });
  });
}

/** Delivered / handed over → reconcile money → estimate restocking. */
export async function complete(b, operator, ip) {
  const rec = await withTransaction(async (conn) => {
    const locked = await Booking.lockById(b.id, conn);
    const record = await Purchase.findByBooking(locked.id, conn);
    if (!record) throw conflict('No shopping record found.');
    await statusService.transition(conn, locked, S.COMPLETED, operator, { expiresAt: null });
    await Purchase.markDelivered(record.id, conn);
    return reconciliationService.reconcile(conn, locked, record, operator);
  });
  await auditService.record({ actorUserId: operator.id, action: 'booking.completed', entityType: 'booking', entityId: b.id, metadata: { refundDue: rec.refundDue, additionalDue: rec.additionalDue }, ip });
  if (b.booking_type === 'full_purchase') await restockService.generateFromBooking(b.id).catch((err) => console.error('restock estimate failed:', err.message));
  const fresh = await Booking.findById(b.id);
  await mailService.send({
    to: fresh.customer_email, userId: fresh.customer_id, bookingId: b.id,
    ...mailService.templates.completed(fresh, { actual_final_total: rec.finalTotal, paid_total: rec.paidTotal, refund_due: rec.refundDue, additional_due: rec.additionalDue }),
  });
  return rec;
}

// ---------- Receipts & photos (private) ----------

export async function addAttachment(b, operator, file, { kind, caption }) {
  const format = uploadService.detectImageFormat(file.buffer);
  const result = await uploadService.uploadPrivateImage(file.buffer, { folder: `bookings/${b.reference}` });
  const id = await Attachment.create({ bookingId: b.id, uploadedBy: operator.id, kind, publicId: result.public_id, format: result.format || format, bytes: result.bytes || file.size, caption });
  return { id };
}

export async function removeAttachment(b, attachmentId) {
  const a = await Attachment.findForBooking(attachmentId, b.id);
  if (!a) throw notFound('Attachment not found');
  await Attachment.remove(a.id);
  await uploadService.deleteImage(a.public_id, { privateAsset: true });
}

/** Signed, short-lived link. Caller must already have checked the user may see this booking. */
export async function attachmentUrl(b, attachmentId) {
  const a = await Attachment.findForBooking(attachmentId, b.id);
  if (!a) throw notFound('Attachment not found');
  return uploadService.privateImageUrl(a.public_id, a.format);
}
