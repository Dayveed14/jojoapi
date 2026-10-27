// Kitchen emails that need the order's delivery description and item list.
import { KITCHEN_EXCLUSIONS } from '../config/constants.js';
import * as KitchenOrder from '../models/kitchenOrder.model.js';
import { isoDate } from '../utils/dates.js';
import * as mailService from './mail.service.js';
import * as notify from './notify.service.js';
import * as settingsService from './settings.service.js';
import { fmtMinutes, lagosParts } from './kitchenSchedule.service.js';

const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export async function deliveryText(o) {
  const { kitchen } = await settingsService.getAll();
  if (o.order_type === 'express' && o.requested_delivery_at) {
    const p = lagosParts(new Date(o.requested_delivery_at));
    return `on ${dayLabel(p.date)} at ${fmtMinutes(p.minutes)}`;
  }
  const w = kitchen.deliveryWindows.find((x) => x.key === o.delivery_window);
  return `on ${dayLabel(isoDate(o.delivery_date))}${w ? `, ${w.label}` : ''}`;
}

export async function itemsWithLabels(orderId) {
  return (await KitchenOrder.listItems(orderId)).map((i) => ({ ...i, exclusionLabels: (i.exclusions || []).map((k) => KITCHEN_EXCLUSIONS[k] || k) }));
}

async function load(orderId) {
  const o = await KitchenOrder.findById(orderId);
  return { ...o, deliveryText: await deliveryText(o) };
}

/** Send a customer template (by key in mailService.templates) for an order. */
export async function customer(orderId, key) {
  const o = await load(orderId);
  const items = key === 'kitchenConfirmed' ? await itemsWithLabels(orderId) : undefined;
  await mailService.send({ to: o.customer_email, userId: o.customer_id, ...mailService.templates[key](o, items) });
}

export async function operatorsExpress(orderId) {
  const o = await load(orderId);
  await notify.operators(mailService.templates.opExpressRequest(o, await itemsWithLabels(orderId)));
}

export async function paid(orderId) {
  const o = await load(orderId);
  const items = await itemsWithLabels(orderId);
  await mailService.send({ to: o.customer_email, userId: o.customer_id, ...mailService.templates.kitchenConfirmed(o, items) });
  await notify.operators(mailService.templates.opKitchenPaid(o, items));
}
