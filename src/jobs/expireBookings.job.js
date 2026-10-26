// Releases dates held by requests nobody acted on in time (spec §7.3: an unreviewed request
// must not block a slot indefinitely). Safe to run repeatedly.
import { STATUS as S } from '../config/constants.js';
import { withTransaction } from '../db/pool.js';
import * as Availability from '../models/availability.model.js';
import * as Booking from '../models/booking.model.js';
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
  return { expired: n };
}
