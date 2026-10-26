// The one place booking status changes. The browser can never set a status directly;
// every change is checked against this table and recorded with who did it.
import { STATUS as S } from '../config/constants.js';
import * as Booking from '../models/booking.model.js';
import { conflict, forbidden } from '../utils/errors.js';

// from → { to: [roles allowed] }   ('system' = background jobs / verified payment webhooks)
const TRANSITIONS = {
  [S.SUBMITTED]: {
    [S.AWAITING_CUSTOMER_APPROVAL]: ['operator'],
    [S.DECLINED]: ['operator'],
    [S.CANCELLED]: ['customer', 'operator'],
    [S.EXPIRED]: ['system'],
  },
  [S.AWAITING_CUSTOMER_APPROVAL]: {
    [S.AWAITING_CUSTOMER_APPROVAL]: ['operator'], // revised quote
    [S.AWAITING_PAYMENT]: ['customer'],
    [S.SUBMITTED]: ['customer'],                  // customer asks for a revised quote
    [S.DECLINED]: ['operator'],
    [S.CANCELLED]: ['customer', 'operator'],
    [S.EXPIRED]: ['system'],
  },
  [S.AWAITING_PAYMENT]: {
    [S.PAID]: ['system', 'operator'],
    [S.CANCELLED]: ['customer', 'operator'],
    [S.EXPIRED]: ['system'],
  },
  [S.PAID]: {
    [S.SHOPPING_IN_PROGRESS]: ['operator'],
    [S.CANCELLED]: ['customer', 'operator'],
  },
  [S.SHOPPING_IN_PROGRESS]: {
    [S.AWAITING_CUSTOMER_DECISION]: ['operator'],
    [S.READY_FOR_DELIVERY]: ['operator'],
  },
  [S.AWAITING_CUSTOMER_DECISION]: {
    [S.SHOPPING_IN_PROGRESS]: ['customer', 'operator', 'system'],
  },
  [S.READY_FOR_DELIVERY]: {
    [S.COMPLETED]: ['operator'],
    [S.SHOPPING_IN_PROGRESS]: ['operator'], // reopen the sheet to correct something
  },
};

export function canTransition(from, to, role) {
  return Boolean(TRANSITIONS[from]?.[to]?.includes(role));
}

/**
 * Change status inside the caller's transaction. `booking` must be freshly locked (FOR UPDATE).
 * @param actor { id, role } — role is 'customer' | 'operator' | 'system'
 */
export async function transition(conn, booking, to, actor, { reason = null, expiresAt } = {}) {
  const from = booking.status;
  if (!TRANSITIONS[from]?.[to]) throw conflict(`This booking can't move from "${from}" to "${to}".`);
  if (!TRANSITIONS[from][to].includes(actor.role)) throw forbidden('You are not allowed to make this change.');
  await Booking.setStatus(booking.id, to, { reason, expiresAt }, conn);
  await Booking.insertEvent({ bookingId: booking.id, fromStatus: from, toStatus: to, actorUserId: actor.id ?? null, reason }, conn);
  booking.status = to;
  return booking;
}
