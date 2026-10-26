// Customer booking endpoints. Every lookup is scoped to req.user.id.
import * as User from '../models/user.model.js';
import * as bookingService from '../services/booking.service.js';
import * as paymentService from '../services/payment.service.js';
import * as quoteService from '../services/quote.service.js';
import * as reconciliationService from '../services/reconciliation.service.js';
import * as savedListService from '../services/savedList.service.js';
import * as shoppingService from '../services/shopping.service.js';

const own = (req) => bookingService.getForCustomer(req.params.reference, req.user.id);
const detail = async (req) => bookingService.presentDetail(await own(req), 'customer');

export async function estimate(req, res) {
  res.json(await bookingService.estimate(req.user.id, req.body));
}

export async function create(req, res) {
  const b = await bookingService.create(req.user.id, req.body, req.ip);
  res.status(201).json({ reference: b.reference });
}

export async function list(req, res) {
  const scope = ['active', 'completed', 'closed'].includes(req.query.scope) ? req.query.scope : undefined;
  res.json({ items: await bookingService.listForCustomer(req.user.id, scope) });
}

export async function get(req, res) {
  res.json({ booking: await detail(req) });
}

export async function cancel(req, res) {
  await bookingService.cancelByCustomer(req.params.reference, req.user.id, req.body.reason, req.ip);
  res.json({ booking: await detail(req) });
}

export async function acceptQuote(req, res) {
  await quoteService.accept(await own(req), req.user.id, req.body.quoteId, req.ip);
  res.json({ booking: await detail(req) });
}

export async function requestRevision(req, res) {
  await quoteService.requestRevision(await own(req), req.user.id, req.body.reason, req.ip);
  res.json({ booking: await detail(req) });
}

export async function payOnline(req, res) {
  const b = await own(req);
  const customer = await User.findById(req.user.id);
  res.json(await paymentService.startOnline(b, customer));
}

export async function payManual(req, res) {
  await paymentService.submitManual(await own(req), req.user.id, req.body.payerNote);
  res.json({ booking: await detail(req), message: 'Thanks! Jojo will confirm your transfer once it arrives.' });
}

export async function payWithCredit(req, res) {
  const result = await paymentService.payWithCredit(await own(req), req.user.id, req.ip);
  res.json({ ...result, booking: await detail(req) });
}

export async function decideChange(req, res) {
  await shoppingService.decideChange(await own(req), req.user.id, Number(req.params.requestId), req.body, req.ip);
  res.json({ booking: await detail(req) });
}

export async function chooseRefund(req, res) {
  await reconciliationService.chooseRefundOrCredit(await own(req), req.user.id, req.body.choice, req.ip);
  res.json({ booking: await detail(req) });
}

export async function repeat(req, res) {
  res.json(await bookingService.repeatSource(req.params.reference, req.user.id));
}

export async function saveAsList(req, res) {
  const id = await savedListService.saveFromBooking(req.params.reference, req.user.id, req.body.name);
  res.status(201).json({ id });
}

export async function attachment(req, res) {
  const url = await shoppingService.attachmentUrl(await own(req), Number(req.params.attachmentId));
  res.json({ url });
}
