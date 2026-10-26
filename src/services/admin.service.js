// Operator-only read models: dashboard, customers, calendar, payments, audit.
import { CAPACITY_STATUSES, STATUS as S, STATUS_LABELS } from '../config/constants.js';
import * as Audit from '../models/audit.model.js';
import * as Availability from '../models/availability.model.js';
import * as Booking from '../models/booking.model.js';
import * as Notification from '../models/notification.model.js';
import * as Payment from '../models/payment.model.js';
import * as Purchase from '../models/purchase.model.js';
import * as Reconciliation from '../models/reconciliation.model.js';
import * as User from '../models/user.model.js';
import { addDays, isoDate, lagosToday } from '../utils/dates.js';
import { money } from '../utils/money.js';
import * as auditService from './audit.service.js';
import * as availabilityService from './availability.service.js';
import { presentSummary } from './booking.service.js';
import { revokeAllSessions } from './session.service.js';
import * as settingsService from './settings.service.js';

export async function dashboard() {
  const today = lagosToday();
  const [counts, stats, todays, pendingTransfers, openRecs, activity, recent] = await Promise.all([
    Booking.countByStatus(), User.customerStats(), Booking.listOnDate(today), Payment.pendingCount(),
    Reconciliation.openCount(), Audit.activitySummary(7), User.recentCustomers(5),
  ]);
  const upcoming = await Booking.listForAdmin({ statuses: [S.PAID, S.AWAITING_PAYMENT, S.AWAITING_CUSTOMER_APPROVAL], from: today, to: addDays(today, 14), limit: 8, offset: 0 });
  return {
    queue: {
      toReview: counts[S.SUBMITTED] || 0,
      awaitingCustomer: (counts[S.AWAITING_CUSTOMER_APPROVAL] || 0) + (counts[S.AWAITING_CUSTOMER_DECISION] || 0),
      awaitingPayment: counts[S.AWAITING_PAYMENT] || 0,
      inProgress: (counts[S.SHOPPING_IN_PROGRESS] || 0) + (counts[S.READY_FOR_DELIVERY] || 0),
      pendingTransfers,
      openReconciliations: openRecs,
    },
    today: todays.filter((b) => CAPACITY_STATUSES.includes(b.status)).map(presentSummary),
    upcoming: upcoming.rows.map(presentSummary),
    customers: {
      total: Number(stats.customers || 0), newThisWeek: Number(stats.newThisWeek || 0),
      unverified: Number(stats.unverified || 0), suspended: Number(stats.suspended || 0),
    },
    recentCustomers: recent.map((r) => ({ id: r.id, displayName: r.display_name, email: r.email, createdAt: r.created_at, emailVerified: Boolean(r.email_verified_at) })),
    activity: activity.map((a) => ({ action: a.action, total: Number(a.total) })),
    statusLabels: STATUS_LABELS,
  };
}

export async function listBookings(q) {
  const scopes = {
    review: [S.SUBMITTED],
    customer: [S.AWAITING_CUSTOMER_APPROVAL, S.AWAITING_CUSTOMER_DECISION, S.AWAITING_PAYMENT],
    scheduled: [S.PAID],
    active: [S.SHOPPING_IN_PROGRESS, S.AWAITING_CUSTOMER_DECISION, S.READY_FOR_DELIVERY],
    completed: [S.COMPLETED],
    closed: [S.DECLINED, S.CANCELLED, S.EXPIRED],
  };
  const { total, rows } = await Booking.listForAdmin({
    statuses: q.scope ? scopes[q.scope] : undefined, type: q.type, marketId: q.marketId, from: q.from, to: q.to, q: q.q,
    limit: q.pageSize, offset: (q.page - 1) * q.pageSize,
  });
  return { items: rows.map(presentSummary), total, page: q.page, pageSize: q.pageSize };
}

export async function calendar({ from, days = 35 }) {
  const { operations: ops } = await settingsService.getAll();
  const start = from || lagosToday();
  const end = addDays(start, days - 1);
  const [exceptions, used, bookings] = await Promise.all([
    Availability.listExceptions(start, end), Availability.usedUnitsByDate(start, end), Booking.listInRange(start, end, CAPACITY_STATUSES.concat([S.COMPLETED])),
  ]);
  const exMap = new Map(exceptions.map((e) => [isoDate(e.exception_date), e]));
  const usedMap = new Map(used.map((u) => [isoDate(u.service_date), Number(u.used)]));
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const ex = exMap.get(d);
    out.push({
      date: d,
      capacity: availabilityService.capacityFor(d, ops, ex),
      used: usedMap.get(d) || 0,
      exception: ex ? { type: ex.exception_type, capacityUnits: ex.capacity_units, reason: ex.reason } : null,
      bookings: bookings.filter((b) => isoDate(b.service_date) === d).map((b) => ({
        reference: b.reference, type: b.booking_type, status: b.status, statusLabel: STATUS_LABELS[b.status], market: b.market_name, customer: b.customer_name, timeWindow: b.time_window,
      })),
    });
  }
  return { days: out, units: { fullPurchase: ops.fullPurchaseUnits, sampleRun: ops.sampleRunUnits, daily: ops.dailyCapacityUnits } };
}

export async function setException(body, user, ip) {
  if (body.type === 'clear') await Availability.deleteException(body.date);
  else await Availability.upsertException({ date: body.date, type: body.type, capacityUnits: body.capacityUnits, reason: body.reason, userId: user.id });
  await auditService.record({ actorUserId: user.id, action: 'availability.exception_set', entityType: 'date', entityId: body.date, metadata: { type: body.type }, ip });
}

export async function listCustomers({ q, page, pageSize }) {
  const { total, rows } = await User.listCustomers({ q, limit: pageSize, offset: (page - 1) * pageSize });
  return {
    items: rows.map((r) => ({
      id: r.id, email: r.email, phone: r.phone, status: r.status, displayName: r.display_name, createdAt: r.created_at,
      lastLoginAt: r.last_login_at, emailVerified: Boolean(r.email_verified_at), bookingCount: Number(r.booking_count), completedCount: Number(r.completed_count),
    })),
    total, page, pageSize,
  };
}

export async function customerDetail(id) {
  const u = await User.findById(id);
  if (!u || u.role !== 'customer') return null;
  const bookings = await Booking.listForCustomer(id, { limit: 50 });
  return {
    id: u.id, email: u.email, phone: u.phone, status: u.status, displayName: u.display_name, createdAt: u.created_at,
    lastLoginAt: u.last_login_at, emailVerified: Boolean(u.email_verified_at), householdSize: u.household_size,
    creditBalance: money((await Payment.creditBalanceKobo(id)) / 100),
    bookings: bookings.map(presentSummary),
  };
}

export async function setCustomerStatus(id, status, reason, operator, ip) {
  await User.setStatus(id, status);
  if (status === 'suspended') await revokeAllSessions(id);
  await auditService.record({ actorUserId: operator.id, action: `customer.${status}`, entityType: 'user', entityId: id, reason, ip });
}

export async function listPayments(q) {
  const { total, rows } = await Payment.listForAdmin({ status: q.status, provider: q.provider, type: q.type, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  return {
    items: rows.map((t) => ({
      id: t.id, bookingReference: t.booking_reference, customerName: t.customer_name, customerEmail: t.customer_email,
      provider: t.provider, type: t.transaction_type, amount: money(t.amount), status: t.status, reference: t.provider_reference,
      payerNote: t.payer_note, createdAt: t.created_at, verifiedAt: t.verified_at,
    })),
    total, page: q.page, pageSize: q.pageSize,
    openReconciliations: (await Reconciliation.listOpen()).map((r) => ({
      reference: r.reference, customerName: r.customer_name, status: r.resolution_status, refundDue: money(r.refund_due), additionalDue: money(r.additional_due), updatedAt: r.updated_at,
    })),
  };
}

export async function listPurchases({ page, pageSize }) {
  const rows = await Purchase.listCompletedForAdmin({ limit: pageSize, offset: (page - 1) * pageSize });
  return rows.map((r) => ({
    reference: r.reference, bookingType: r.booking_type, serviceDate: isoDate(r.service_date), completedAt: r.completed_at, market: r.market_name,
    customerName: r.customer_name, goodsTotal: money(r.goods_total), finalTotal: money(r.final_total), reconciliation: r.resolution_status,
  }));
}

export async function auditLog(q) {
  const { total, rows } = await Audit.list({ action: q.action, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  return {
    items: rows.map((r) => ({
      id: r.id, action: r.action, entityType: r.entity_type, entityId: r.entity_id, reason: r.reason,
      metadata: typeof r.redacted_metadata_json === 'string' ? JSON.parse(r.redacted_metadata_json) : r.redacted_metadata_json,
      actor: r.actor_name || r.actor_email || 'System', createdAt: r.created_at,
    })),
    total, page: q.page, pageSize: q.pageSize,
  };
}

export async function notifications() {
  return (await Notification.recent(100)).map((n) => ({ id: n.id, email: n.email, template: n.template_key, status: n.status, errorCode: n.error_code, createdAt: n.created_at }));
}
