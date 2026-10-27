// Releases dates held by requests nobody acted on in time (spec §7.3: an unreviewed request
// must not block a slot indefinitely). Safe to run repeatedly.
import { KITCHEN_STATUS, STATUS as S } from '../config/constants.js';
import { withTransaction } from '../db/pool.js';
import * as Availability from '../models/availability.model.js';
import * as Booking from '../models/booking.model.js';
import * as KitchenOrder from '../models/kitchenOrder.model.js';
import * as kitchenStatus from '../services/kitchenStatus.service.js';
import * as Quote from '../models/quote.model.js';
import * as statusService from '../services/bookingStatus.service.js';

export async function run() {
  const expired = await Booking.findExpired([S.SUBMITTED, S.AWAITING_CUSTOMER_APPROVAL, S.AWAITING_PAYMENT]);
  let n = 0;
  for (const row of expired) {
    try {
      await withTransaction(async (conn) => {
        const b = await Booking.lockById(row.id, conn);
        if (!b.expires_at || new Date(b.expires_at) > new Date()) return; // changed since we looked
        const reason = { submitted: 'Not reviewed in time', awaiting_customer_approval: 'Quote not accepted in time', awaiting_payment: 'Payment not received in time' }[b.status];
        await statusService.transition(conn, b, S.EXPIRED, { id: null, role: 'system' }, { reason, expiresAt: null });
        await Availability.releaseHolds(b.id, conn);
        const q = await Quote.findProposed(b.id, conn);
        if (q) await Quote.setStatus(q.id, 'expired', conn);
        n++;
      });
    } catch (err) {
      console.error(`expire ${row.reference} failed:`, err.message);
    }
  }
  await Availability.expireStaleHolds();

  // Kitchen: unanswered express requests and unpaid orders release their slot.
  for (const row of await KitchenOrder.findExpired([KITCHEN_STATUS.EXPRESS_REQUESTED, KITCHEN_STATUS.AWAITING_PAYMENT])) {
    try {
      await withTransaction(async (conn) => {
        const o = await KitchenOrder.lockById(row.id, conn);
        if (!o.expires_at || new Date(o.expires_at) > new Date()) return;
        const reason = o.status === KITCHEN_STATUS.EXPRESS_REQUESTED ? 'Express request not answered in time' : 'Payment not received in time';
        await kitchenStatus.transition(conn, o, KITCHEN_STATUS.EXPIRED, { id: null, role: 'system' }, { reason, expiresAt: null });
        n++;
      });
    } catch (err) {
      console.error(`expire ${row.reference} failed:`, err.message);
    }
  }
  return { expired: n };
}
