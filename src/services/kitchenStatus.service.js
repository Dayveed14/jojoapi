// The one place kitchen-order status changes, checked against this table and recorded with the actor.
import { KITCHEN_STATUS as K } from '../config/constants.js';
import * as KitchenOrder from '../models/kitchenOrder.model.js';
import { conflict, forbidden } from '../utils/errors.js';

const TRANSITIONS = {
  [K.EXPRESS_REQUESTED]: { [K.AWAITING_PAYMENT]: ['operator'], [K.DECLINED]: ['operator'], [K.CANCELLED]: ['customer', 'operator'], [K.EXPIRED]: ['system'] },
  [K.AWAITING_PAYMENT]: { [K.CONFIRMED]: ['system', 'operator'], [K.CANCELLED]: ['customer', 'operator'], [K.EXPIRED]: ['system'] },
  [K.CONFIRMED]: { [K.PREPARING]: ['operator'], [K.COOKING]: ['operator'], [K.CANCELLED]: ['operator'] },
  [K.PREPARING]: { [K.COOKING]: ['operator'], [K.CANCELLED]: ['operator'] },
  [K.COOKING]: { [K.OUT_FOR_DELIVERY]: ['operator'] },
  [K.OUT_FOR_DELIVERY]: { [K.DELIVERED]: ['operator'] },
};

export const nextStepFor = { confirmed: 'preparing', preparing: 'cooking', cooking: 'out_for_delivery', out_for_delivery: 'delivered' };

export async function transition(conn, order, to, actor, { reason = null, expiresAt } = {}) {
  const from = order.status;
  if (!TRANSITIONS[from]?.[to]) throw conflict(`This order can't move from "${from}" to "${to}".`);
  if (!TRANSITIONS[from][to].includes(actor.role)) throw forbidden('You are not allowed to make this change.');
  await KitchenOrder.setStatus(order.id, to, { reason, expiresAt }, conn);
  await KitchenOrder.insertEvent({ orderId: order.id, fromStatus: from, toStatus: to, actorUserId: actor.id ?? null, reason }, conn);
  order.status = to;
  return order;
}
