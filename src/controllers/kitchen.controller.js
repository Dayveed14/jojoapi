// Jojo's Kitchen — public menu and customer orders (every lookup scoped to req.user.id).
import * as User from '../models/user.model.js';
import * as kitchenService from '../services/kitchen.service.js';
import * as paymentService from '../services/payment.service.js';

const own = (req) => kitchenService.getForCustomer(req.params.reference, req.user.id);
const detail = async (req) => kitchenService.presentDetail(await own(req), 'customer');

export async function menu(_req, res) {
  res.json(await kitchenService.menu());
}

export async function quote(req, res) {
  res.json(await kitchenService.quote(req.user.id, req.body));
}

export async function create(req, res) {
  const o = await kitchenService.create(req.user.id, req.body, req.ip);
  res.status(201).json({ reference: o.reference, orderType: o.order_type });
}

export async function list(req, res) {
  res.json({ items: await kitchenService.listForCustomer(req.user.id, req.query.scope) });
}

export async function get(req, res) {
  res.json({ order: await detail(req) });
}

export async function cancel(req, res) {
  await kitchenService.cancelByCustomer(await own(req), req.user.id, req.body.reason, req.ip);
  res.json({ order: await detail(req) });
}

export async function payOnline(req, res) {
  res.json(await paymentService.startOnlineKitchen(await own(req), await User.findById(req.user.id)));
}

export async function payManual(req, res) {
  await paymentService.submitManualKitchen(await own(req), req.user.id, req.body.payerNote);
  res.json({ order: await detail(req) });
}

export async function payCredit(req, res) {
  const r = await paymentService.payWithCreditKitchen(await own(req), req.user.id, req.ip);
  res.json({ ...r, order: await detail(req) });
}
