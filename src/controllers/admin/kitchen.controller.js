// Operator: kitchen orders, cooking sheet, menu and capacity.
import * as kitchenService from '../../services/kitchen.service.js';
import * as paymentService from '../../services/payment.service.js';
import * as uploadService from '../../services/upload.service.js';
import { badRequest } from '../../utils/errors.js';

const load = (req) => kitchenService.getForOperator(req.params.reference);
const operator = (req) => ({ id: req.user.id, role: 'operator' });

async function respond(req, res) {
  const o = await load(req);
  const order = await kitchenService.presentDetail(o, 'operator');
  order.dayLoad = await kitchenService.dayLoad(order.deliveryDate);
  res.json({ order });
}

export async function list(req, res) {
  res.json(await kitchenService.adminList(req.validatedQuery));
}
export const get = (req, res) => respond(req, res);

export async function approve(req, res) {
  await kitchenService.approveExpress(await load(req), operator(req), req.body, req.ip);
  await respond(req, res);
}
export async function decline(req, res) {
  await kitchenService.declineExpress(await load(req), operator(req), req.body.reason, req.ip);
  await respond(req, res);
}
export async function advance(req, res) {
  await kitchenService.advance(await load(req), operator(req), req.body.to, req.ip);
  await respond(req, res);
}
export async function cancel(req, res) {
  await kitchenService.cancelByOperator(await load(req), operator(req), req.body, req.ip);
  await respond(req, res);
}
export async function refund(req, res) {
  await kitchenService.recordRefund(await load(req), operator(req), req.body, req.ip);
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

export async function sheet(req, res) {
  res.json(await kitchenService.cookingSheet(req.validatedQuery.date));
}
export async function calendar(_req, res) {
  res.json({ days: await kitchenService.calendarAdmin(21) });
}
export async function setOverride(req, res) {
  await kitchenService.setOverride(req.body, req.user);
  res.json({ days: await kitchenService.calendarAdmin(21) });
}

export async function menu(_req, res) {
  res.json({ meals: await kitchenService.adminMenu() });
}
export async function saveMeal(req, res) {
  const meal = await kitchenService.saveMeal(req.params.id ? Number(req.params.id) : null, req.body, req.user, req.ip);
  res.status(req.params.id ? 200 : 201).json({ meal });
}
export async function uploadPhoto(req, res) {
  if (!req.file) throw badRequest('Choose a photo to upload.');
  res.json({ meal: await kitchenService.setMealPhoto(Number(req.params.id), req.file.buffer, uploadService) });
}
export async function removePhoto(req, res) {
  res.json({ meal: await kitchenService.removeMealPhoto(Number(req.params.id), uploadService) });
}
