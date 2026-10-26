// Operator booking workflow: review → quote → payment → shopping → completion → reconciliation.
import { STATUS as S } from '../../config/constants.js';
import * as adminService from '../../services/admin.service.js';
import * as availabilityService from '../../services/availability.service.js';
import * as bookingService from '../../services/booking.service.js';
import * as paymentService from '../../services/payment.service.js';
import * as quoteService from '../../services/quote.service.js';
import * as reconciliationService from '../../services/reconciliation.service.js';
import * as shoppingService from '../../services/shopping.service.js';
import * as catalogService from '../../services/catalog.service.js';
import { badRequest } from '../../utils/errors.js';

const load = (req) => bookingService.getForOperator(req.params.reference);
const operator = (req) => ({ id: req.user.id, role: 'operator' });

async function respond(req, res, extra = {}) {
  const b = await load(req);
  const booking = await bookingService.presentDetail(b, 'operator');
  if ([S.SUBMITTED, S.AWAITING_CUSTOMER_APPROVAL].includes(b.status)) {
    booking.quoteSuggestion = await quoteService.suggest(b);
    const market = await catalogService.getActiveMarket(b.market_id).catch(() => null);
    booking.rescheduleDays = (await availabilityService.calendar({ bookingType: b.booking_type, market }))
      .filter((d) => d.available).map((d) => d.date);
  }
  res.json({ booking, ...extra });
}

export async function list(req, res) {
  res.json(await adminService.listBookings(req.validatedQuery));
}

export const get = (req, res) => respond(req, res);

export async function propose(req, res) {
  await quoteService.propose(await load(req), operator(req), req.body, req.ip);
  await respond(req, res);
}

export async function decline(req, res) {
  await quoteService.decline(await load(req), operator(req), req.body.reason, req.ip);
  await respond(req, res);
}

export async function cancel(req, res) {
  await bookingService.cancel(await load(req), operator(req), req.body.reason, req.ip);
  await respond(req, res);
}

export async function startShopping(req, res) {
  await shoppingService.start(await load(req), operator(req), req.ip);
  await respond(req, res);
}

export async function saveSheet(req, res) {
  const totals = await shoppingService.saveSheet(await load(req), operator(req), req.body, req.ip);
  await respond(req, res, { totals });
}

export async function requestChange(req, res) {
  await shoppingService.requestChange(await load(req), operator(req), req.body, req.ip);
  await respond(req, res);
}

export async function withdrawChange(req, res) {
  await shoppingService.withdrawChange(await load(req), operator(req), Number(req.params.requestId));
  await respond(req, res);
}

export async function finish(req, res) {
  await shoppingService.finish(await load(req), operator(req), req.ip);
  await respond(req, res);
}

export async function reopen(req, res) {
  await shoppingService.reopen(await load(req), operator(req));
  await respond(req, res);
}

export async function complete(req, res) {
  await shoppingService.complete(await load(req), operator(req), req.ip);
  await respond(req, res);
}

export async function uploadAttachment(req, res) {
  if (!req.file) throw badRequest('Choose a photo to upload.');
  await shoppingService.addAttachment(await load(req), operator(req), req.file, req.body);
  await respond(req, res);
}

export async function deleteAttachment(req, res) {
  await shoppingService.removeAttachment(await load(req), Number(req.params.attachmentId));
  await respond(req, res);
}

export async function attachmentUrl(req, res) {
  res.json({ url: await shoppingService.attachmentUrl(await load(req), Number(req.params.attachmentId)) });
}

export async function recordRefund(req, res) {
  await reconciliationService.recordRefund(await load(req), operator(req), req.body, req.ip);
  await respond(req, res);
}

export async function setReconciliationStatus(req, res) {
  await reconciliationService.setStatusManually(await load(req), operator(req), req.body, req.ip);
  await respond(req, res);
}

export async function confirmPayment(req, res) {
  await paymentService.confirmManual(Number(req.params.paymentId), operator(req), req.ip);
  await respond(req, res);
}

export async function rejectPayment(req, res) {
  await paymentService.rejectManual(Number(req.params.paymentId), operator(req), req.body.reason, req.ip);
  await respond(req, res);
}
