// Restocking ESTIMATES. Not inventory: goods may be shared, gifted or used faster.
// After each completed shop we estimate when each item may run out:
//   duration = item.restock_days × units bought × (default household ÷ customer's household size)
//   units    = quantity of the standard unit, or amount ÷ standard unit price for "₦7,000 of tomatoes"
// Customers can correct the estimate ("still have some", "finished", or set their own number of days).
import { CAPACITY_STATUSES } from '../config/constants.js';
import * as Booking from '../models/booking.model.js';
import * as Catalog from '../models/catalog.model.js';
import * as Purchase from '../models/purchase.model.js';
import * as Restock from '../models/restock.model.js';
import * as User from '../models/user.model.js';
import { addDays, daysBetween, isoDate, lagosToday } from '../utils/dates.js';
import { notFound } from '../utils/errors.js';
import { sha256 } from '../utils/crypto.js';
import * as mailService from './mail.service.js';
import { optionLabel } from './pricing.service.js';
import * as settingsService from './settings.service.js';

const midpoint = (o) => (o.price_type === 'fixed' ? Number(o.price) : o.price_type === 'range' ? (Number(o.price_min) + Number(o.price_max)) / 2 : null);

/**
 * How many "standard units" a purchase line represents (rough, by design).
 * Variants of the same unit count the same — a 50kg bag of Basmati lasts as long as a 50kg bag of
 * local rice, even though it costs more. Price is only used to convert BETWEEN units (cups → bags),
 * comparing like with like (Basmati cup vs Basmati bag where both exist).
 */
export function standardUnits(line, item) {
  const priced = item.options.filter((o) => o.price_type !== 'none');
  const standard = item.options.find((o) => o.is_standard) || priced[0] || null;
  const bought = line.option_id ? item.options.find((o) => o.id === line.option_id) : null;
  const qty = line.actual_quantity == null || Number(line.actual_quantity) <= 0 ? null : Number(line.actual_quantity);
  const amount = Number(line.actual_amount) || 0;

  if (!standard) return qty || 1;
  const ref = bought && midpoint(bought) ? bought : standard;
  // How many of the bought (or reference) unit: the quantity, or the amount at that unit's price.
  const unitsOfRef = qty ?? (amount > 0 && midpoint(ref) ? amount / midpoint(ref) : null);
  if (unitsOfRef == null) return 1;
  if (ref.unit_label === standard.unit_label) return unitsOfRef;

  // Different unit: convert by price, using the same variant in the standard unit when available.
  const sameVariantStandard = priced.find((o) => o.unit_label === standard.unit_label && o.variant === ref.variant) || standard;
  const a = midpoint(ref);
  const s = midpoint(sameVariantStandard);
  return a && s ? (unitsOfRef * a) / s : unitsOfRef;
}

export function estimateDays({ restockDays, units, householdSize, cfg }) {
  const hh = householdSize || cfg.defaultHouseholdSize;
  const days = Math.round(restockDays * units * (cfg.defaultHouseholdSize / hh));
  return Math.min(cfg.maxDays, Math.max(cfg.minDays, days));
}

export async function generateFromBooking(bookingId) {
  const { restocking: cfg } = await settingsService.getAll();
  const b = await Booking.findById(bookingId);
  const record = await Purchase.findByBooking(bookingId);
  if (!b || !record) return 0;
  const profile = await User.findById(b.customer_id);
  const lines = (await Purchase.listItems(record.id)).filter((l) => l.catalog_item_id && ['bought', 'partly', 'substituted'].includes(l.outcome) && Number(l.actual_amount) > 0);
  const items = await Catalog.findItemsWithOptions([...new Set(lines.map((l) => l.catalog_item_id))]);
  const purchaseDate = isoDate(record.delivered_at || new Date()) || lagosToday();
  const lead = profile.reminder_lead_days ?? cfg.defaultLeadDays;

  let n = 0;
  for (const line of lines) {
    const item = items.get(line.catalog_item_id);
    if (!item?.restock_days) continue;
    const days = estimateDays({ restockDays: item.restock_days, units: standardUnits(line, item), householdSize: profile.household_size, cfg });
    const depletion = addDays(purchaseDate, days);
    const opt = line.option_id ? item.options.find((o) => o.id === line.option_id) : null;
    await Restock.upsertEstimate({
      customerId: b.customer_id, catalogItemId: item.id, optionKey: line.option_id || 0,
      itemLabel: opt ? `${item.name} · ${optionLabel(opt)}` : item.name,
      purchaseItemId: line.id, bookingId: b.id, purchaseDate, durationDays: days, depletionDate: depletion,
      remindOn: maxDate(addDays(depletion, -lead), addDays(purchaseDate, 1)), leadDays: lead,
    });
    n++;
  }
  return n;
}

const maxDate = (a, b) => (a > b ? a : b);

export function presentEstimate(e, today = lagosToday()) {
  const depletion = isoDate(e.estimated_depletion_date);
  const last = isoDate(e.last_purchase_date);
  const total = Math.max(1, daysBetween(last, depletion));
  const left = daysBetween(today, depletion);
  return {
    id: e.id,
    label: e.item_label,
    category: e.category_name,
    icon: e.category_icon,
    lastPurchaseDate: last,
    lastBookingReference: e.last_booking_reference,
    estimatedDurationDays: e.estimated_duration_days,
    estimatedDepletionDate: depletion,
    daysLeft: left,
    percentLeft: Math.max(0, Math.min(100, Math.round((left / total) * 100))),
    customerAdjusted: Boolean(e.customer_adjusted),
    status: e.customer_status,
    remindersEnabled: Boolean(e.reminders_enabled),
    likelyLow: e.customer_status === 'running_low' || e.customer_status === 'finished' || (e.customer_status !== 'still_available' && left <= 7),
  };
}

export async function listForCustomer(customerId) {
  const today = lagosToday();
  return (await Restock.listForCustomer(customerId)).map((e) => presentEstimate(e, today));
}

/** Customer feedback on an estimate. */
export async function update(customerId, estimateId, body) {
  const { restocking: cfg } = await settingsService.getAll();
  const e = await Restock.findForCustomer(estimateId, customerId);
  if (!e) throw notFound('Item not found');
  const profile = await User.findById(customerId);
  const lead = profile.reminder_lead_days ?? cfg.defaultLeadDays;
  const today = lagosToday();
  const fields = { lastConfirmedAt: new Date() };

  if (body.status) {
    fields.customerStatus = body.status;
    if (body.status === 'still_available') {
      // Push the estimate out by at least a week (or a quarter of the usual duration).
      const extra = Math.max(7, Math.round(e.estimated_duration_days / 4));
      const depletion = addDays(today, extra);
      Object.assign(fields, { estimatedDepletionDate: depletion, remindOn: addDays(depletion, -Math.min(lead, extra - 1)), lastRemindedAt: null });
    } else if (body.status === 'running_low') {
      Object.assign(fields, { estimatedDepletionDate: addDays(today, 3), remindOn: today });
    } else if (body.status === 'finished') {
      Object.assign(fields, { estimatedDepletionDate: today, remindOn: today });
    }
  }
  if (body.estimatedDurationDays) {
    const days = Math.min(cfg.maxDays * 2, Math.max(1, body.estimatedDurationDays));
    const depletion = addDays(isoDate(e.last_purchase_date), days);
    Object.assign(fields, {
      estimatedDurationDays: days, customerAdjusted: true, estimatedDepletionDate: depletion,
      remindOn: maxDate(addDays(depletion, -lead), today), lastRemindedAt: null, customerStatus: 'unknown',
    });
  }
  if (body.remindersEnabled !== undefined) fields.remindersEnabled = body.remindersEnabled;
  if (body.snoozeDays) {
    Object.assign(fields, { remindOn: addDays(today, body.snoozeDays), lastRemindedAt: null });
  }
  await Restock.update(e.id, fields);
  const fresh = (await Restock.listForCustomer(customerId)).find((x) => x.id === e.id);
  return presentEstimate(fresh, today);
}

/**
 * Daily job: one gentle email per customer listing items that may be running low.
 * Deduplicated per item cycle; skips items already on an open booking; respects opt-outs.
 */
export async function sendDueReminders() {
  const today = lagosToday();
  const due = await Restock.findDue(today);
  if (!due.length) return { sent: 0 };

  const byCustomer = new Map();
  for (const e of due) (byCustomer.get(e.customer_id) || byCustomer.set(e.customer_id, []).get(e.customer_id)).push(e);
  const recipients = await User.findReminderRecipients([...byCustomer.keys()]);

  let sent = 0;
  for (const user of recipients) {
    const estimates = byCustomer.get(user.id);
    if (user.status !== 'active' || !user.restock_reminders_enabled) continue;
    const openItems = new Set(await Booking.openItemIdsForCustomer(user.id, CAPACITY_STATUSES));
    const fresh = estimates.filter((e) => !openItems.has(e.catalog_item_id)); // stale: already being bought
    if (!fresh.length) continue;

    const dedupKey = sha256(fresh.map((e) => `${e.id}:${isoDate(e.estimated_depletion_date)}`).sort().join('|'));
    const tpl = mailService.templates.restock(user.display_name?.split(' ')[0] || 'there', fresh.map((e) => e.item_label));
    // Claim the dedup key first so two job runs can't both send.
    const claimed = await Restock.insertReminder({ customerId: user.id, estimateIds: fresh.map((e) => e.id), dedupKey, status: 'sent' });
    if (!claimed) continue;
    const res = await mailService.send({ to: user.email, userId: user.id, ...tpl, idempotencyKey: dedupKey });
    await Restock.markReminded(fresh.map((e) => e.id));
    if (res) sent++;
  }
  return { sent };
}

export async function summaryForCustomer(customerId) {
  const list = await listForCustomer(customerId);
  return { tracked: list.length, likelyLow: list.filter((e) => e.likelyLow).length, next: list.filter((e) => e.status !== 'still_available').slice(0, 3) };
}
