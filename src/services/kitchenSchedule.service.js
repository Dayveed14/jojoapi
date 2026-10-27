// When can a kitchen order be delivered? Pure functions + one capacity lookup.
// All clock maths is in Lagos time (WAT, UTC+1, no daylight saving).
//
// Regular orders (Jojo's rule):
//   ordered before 10:00         → earliest delivery 24 hours later (same time tomorrow)
//   ordered 10:00 – 11:59        → 24 hours + 4 hours later (e.g. 11:30 → 3:30pm tomorrow → the 4pm window)
//   ordered from 12:00 (and all evening/night) → the day after tomorrow, any window
//   bulk orders add extra day(s) on top.
// A delivery window counts only if it STARTS at or after the earliest time.
import { KITCHEN_CAPACITY_STATUSES } from '../config/constants.js';
import * as KitchenOrder from '../models/kitchenOrder.model.js';
import { addDays, isoDate, weekday } from '../utils/dates.js';

const LAGOS_OFFSET_MIN = 60;

export const toMinutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
export const fmtMinutes = (m) => {
  const h = Math.floor(m / 60) % 24; const mm = m % 60;
  const ampm = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12;
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
};

/** { date: 'YYYY-MM-DD', minutes } in Lagos for a JS Date. */
export function lagosParts(now = new Date()) {
  const t = new Date(now.getTime() + LAGOS_OFFSET_MIN * 60_000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/** Lagos date + minutes → JS Date (UTC instant). */
export function fromLagos(date, minutes) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + (minutes - LAGOS_OFFSET_MIN) * 60_000);
}

/** Earliest possible delivery { date, minutes, rule } for a regular order placed at `now`. */
export function earliestDelivery(now, cfg, { isBulk = false } = {}) {
  const { date, minutes } = lagosParts(now);
  let out;
  if (minutes < toMinutes(cfg.fullDayCutoff)) {
    out = { date: addDays(date, 1), minutes, rule: 'next_day' };
  } else if (minutes < toMinutes(cfg.extraHoursCutoff)) {
    out = { date: addDays(date, 1), minutes: minutes + cfg.extraHours * 60, rule: 'next_day_plus' };
  } else {
    out = { date: addDays(date, 2), minutes: 0, rule: 'day_after_tomorrow' };
  }
  if (isBulk && cfg.bulkExtraDays > 0) out = { date: addDays(out.date, cfg.bulkExtraDays), minutes: 0, rule: `${out.rule}+bulk` };
  return out;
}

export function windowsFor(date, earliest, cfg) {
  if (date < earliest.date) return [];
  return cfg.deliveryWindows.filter((w) => date > earliest.date || toMinutes(w.start) >= earliest.minutes);
}

export function capacityFor(date, cfg, override) {
  if (override?.override_type === 'blocked') return 0;
  if (override?.override_type === 'capacity') return Number(override.capacity_portions || 0);
  return cfg.workingDays.includes(weekday(date)) ? cfg.dailyCapacityPortions : 0;
}

/** Human explanation shown before the customer picks a date. */
export function leadTimeMessage(earliest, cfg, isBulk) {
  const first = windowsFor(earliest.date, earliest, cfg)[0];
  const parts = {
    next_day: 'Ordered before 10am, so the earliest delivery is tomorrow.',
    next_day_plus: `Ordered between 10am and noon, so the earliest delivery is tomorrow from ${first ? fmtMinutes(toMinutes(first.start)) : 'the afternoon'}.`,
    day_after_tomorrow: 'Ordered after noon, so the earliest delivery is the day after tomorrow — Jojo needs time to buy fresh ingredients and cook.',
  };
  const base = parts[earliest.rule.replace('+bulk', '')];
  return isBulk ? `${base} Bulk orders need ${cfg.bulkExtraDays} extra day${cfg.bulkExtraDays > 1 ? 's' : ''}.` : base;
}

/** Calendar of deliverable days/windows for a regular order needing `portions`. */
export async function calendar({ now = new Date(), cfg, portions, isBulk, excludeOrderId = null }) {
  const earliest = earliestDelivery(now, cfg, { isBulk });
  const end = addDays(lagosParts(now).date, cfg.bookingWindowDays);
  const [overrides, usage] = await Promise.all([
    KitchenOrder.listOverrides(earliest.date, end),
    KitchenOrder.usageByDate(earliest.date, end, KITCHEN_CAPACITY_STATUSES, { excludeOrderId }),
  ]);
  const ov = new Map(overrides.map((o) => [isoDate(o.override_date), o]));
  const use = new Map(usage.map((u) => [isoDate(u.delivery_date), { portions: Number(u.portions), orders: Number(u.orders) }]));
  const days = [];
  for (let d = earliest.date; d <= end; d = addDays(d, 1)) {
    const cap = capacityFor(d, cfg, ov.get(d));
    const u = use.get(d) || { portions: 0, orders: 0 };
    const windows = windowsFor(d, earliest, cfg);
    let reason = null;
    if (ov.get(d)?.override_type === 'blocked' || cap === 0) reason = 'closed';
    else if (u.orders >= cfg.maxOrdersPerDay || cap - u.portions < portions) reason = 'full';
    else if (!windows.length) reason = 'too_soon';
    days.push({ date: d, available: !reason, reason, windows: reason ? [] : windows.map((w) => ({ key: w.key, label: w.label })), remainingPortions: Math.max(0, cap - u.portions) });
  }
  return { earliest: { ...earliest, label: leadTimeMessage(earliest, cfg, isBulk) }, days };
}

/** Is `date`/`windowKey` deliverable right now for this order size? (call inside a date lock) */
export async function assertRegularSlot({ now = new Date(), cfg, date, windowKey, portions, isBulk }, conn) {
  const earliest = earliestDelivery(now, cfg, { isBulk });
  const end = addDays(lagosParts(now).date, cfg.bookingWindowDays);
  if (date < earliest.date || date > end) return 'That date is no longer available — please pick another.';
  if (!windowsFor(date, earliest, cfg).some((w) => w.key === windowKey)) return 'That delivery time is too soon now — please pick a later one.';
  const [overrides, usage] = await Promise.all([
    KitchenOrder.listOverrides(date, date, conn),
    KitchenOrder.usageByDate(date, date, KITCHEN_CAPACITY_STATUSES, {}, conn),
  ]);
  const cap = capacityFor(date, cfg, overrides[0]);
  const u = usage[0] ? { portions: Number(usage[0].portions), orders: Number(usage[0].orders) } : { portions: 0, orders: 0 };
  if (cap === 0) return 'Jojo isn’t cooking that day — please pick another.';
  if (u.orders >= cfg.maxOrdersPerDay || cap - u.portions < portions) return 'Sorry, that day has just been fully booked — please pick another.';
  return null;
}

/** Validate an express delivery time. Returns an error message or null. */
export function checkExpressTime(when, now, cfg) {
  const t = when.getTime();
  if (Number.isNaN(t)) return 'Choose a delivery date and time.';
  if (t < now.getTime() + cfg.expressMinHoursAhead * 3_600_000) return `Express orders need at least ${cfg.expressMinHoursAhead} hours’ notice.`;
  const { date, minutes } = lagosParts(when);
  if (date > addDays(lagosParts(now).date, cfg.bookingWindowDays)) return 'That date is too far ahead.';
  if (minutes < toMinutes(cfg.expressEarliestTime) || minutes > toMinutes(cfg.expressLatestTime)) {
    return `Express deliveries are between ${fmtMinutes(toMinutes(cfg.expressEarliestTime))} and ${fmtMinutes(toMinutes(cfg.expressLatestTime))}.`;
  }
  return null;
}
