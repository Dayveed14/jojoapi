// Which dates can be booked. Based on working days, daily capacity units, market open days,
// blocked dates and existing holds — not a simple one-booking-per-day rule.
import * as Availability from '../models/availability.model.js';
import { addDays, isoDate, lagosHour, lagosToday, weekday } from '../utils/dates.js';
import { conflict } from '../utils/errors.js';
import * as settingsService from './settings.service.js';

export const unitsFor = (bookingType, ops) => (bookingType === 'sample_run' ? ops.sampleRunUnits : ops.fullPurchaseUnits);

export function capacityFor(date, ops, exception) {
  if (exception?.exception_type === 'blocked') return 0;
  if (exception?.exception_type === 'capacity') return Number(exception.capacity_units || 0);
  return ops.workingDays.includes(weekday(date)) ? ops.dailyCapacityUnits : 0;
}

export function firstBookableDate(ops) {
  const today = lagosToday();
  if (ops.leadTimeDays > 0) return addDays(today, ops.leadTimeDays);
  return lagosHour() >= ops.sameDayCutoffHour ? addDays(today, 1) : today;
}

/** Calendar of the booking window. `market` (optional) narrows to days the market is open. */
export async function calendar({ bookingType = 'full_purchase', market = null, days } = {}) {
  const { operations: ops } = await settingsService.getAll();
  const start = firstBookableDate(ops);
  const end = addDays(lagosToday(), days ?? ops.bookingWindowDays);
  const [exceptions, used] = await Promise.all([
    Availability.listExceptions(start, end),
    Availability.usedUnitsByDate(start, end),
  ]);
  const exMap = new Map(exceptions.map((e) => [isoDate(e.exception_date), e]));
  const usedMap = new Map(used.map((u) => [isoDate(u.service_date), Number(u.used)]));
  const need = unitsFor(bookingType, ops);

  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const ex = exMap.get(d);
    const capacity = capacityFor(d, ops, ex);
    const usedUnits = usedMap.get(d) || 0;
    let reason = null;
    if (ex?.exception_type === 'blocked') reason = 'unavailable';
    else if (capacity === 0) reason = 'closed';
    else if (market && !market.open_days.includes(weekday(d))) reason = 'market_closed';
    else if (capacity - usedUnits < need) reason = 'full';
    out.push({ date: d, weekday: weekday(d), available: !reason, reason, capacity, used: usedUnits, remaining: Math.max(0, capacity - usedUnits) });
  }
  return out;
}

/**
 * Reserve capacity inside the caller's transaction: lockAndCheck FIRST (before any other writes),
 * then hold once the booking row exists. The date row stays locked until commit, so two customers
 * can't take the last slot at the same time.
 */
export async function lockAndCheck(conn, { date, bookingType, market }) {
  const { operations: ops } = await settingsService.getAll();
  await assertBookable(conn, { date, bookingType, market, ops });
}

/** Call after lockAndCheck, in the same transaction. */
export async function hold(conn, { bookingId, date, bookingType, expiresAt }) {
  const { operations: ops } = await settingsService.getAll();
  await Availability.createHold({ bookingId, date, units: unitsFor(bookingType, ops), expiresAt }, conn);
}

/** Move an existing booking's hold to a new date (operator reschedule), re-checking capacity. */
export async function move(conn, { bookingId, date, bookingType, market }) {
  const { operations: ops } = await settingsService.getAll();
  await assertBookable(conn, { date, bookingType, market, ops, excludeBookingId: bookingId, ignoreLeadTime: true });
  await Availability.moveHold(bookingId, date, conn);
}

/** Before accepting/quoting, confirm the booking's own hold is still valid (it may have expired). */
export async function recheck(conn, { bookingId, date, bookingType, market }) {
  const { operations: ops } = await settingsService.getAll();
  await Availability.lockDate(date, conn);
  const ex = await Availability.findException(date, conn);
  const capacity = capacityFor(date, ops, ex);
  const usedByOthers = await Availability.usedUnitsOn(date, { excludeBookingId: bookingId }, conn);
  if (capacity - usedByOthers < unitsFor(bookingType, ops) || (market && !market.open_days.includes(weekday(date)))) {
    throw conflict('That date is no longer available. Please choose another date.');
  }
}

async function assertBookable(conn, { date, bookingType, market, ops, excludeBookingId = null, ignoreLeadTime = false }) {
  if (!ignoreLeadTime) {
    const first = firstBookableDate(ops);
    const last = addDays(lagosToday(), ops.bookingWindowDays);
    if (date < first || date > last) throw conflict('Please choose one of the available dates.');
  }
  if (market && !market.open_days.includes(weekday(date))) throw conflict(`${market.name} isn't open on that day. Please pick another date.`);
  await Availability.lockDate(date, conn);
  const ex = await Availability.findException(date, conn);
  const capacity = capacityFor(date, ops, ex);
  const used = await Availability.usedUnitsOn(date, { excludeBookingId }, conn);
  if (capacity - used < unitsFor(bookingType, ops)) throw conflict('Sorry, that date has just been fully booked. Please choose another date.');
}
