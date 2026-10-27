import { z } from 'zod';
import { BOOKING_TYPES, TIME_WINDOWS } from '../config/constants.js';
import { id, isoDate, naira, optionalId, optionalNaira, optionalText, pagination, text } from './common.validators.js';

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/, 'Use lowercase letters, numbers and dashes');
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM');
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

export const bookingListQuery = pagination.extend({
  scope: z.enum(['review', 'customer', 'scheduled', 'active', 'completed', 'closed']).optional(),
  type: z.enum(BOOKING_TYPES).optional(),
  marketId: optionalId,
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
});

export const quoteSchema = z.object({
  goodsAmount: naira,
  serviceFee: naira,
  transportCost: naira,
  otherCharges: naira.default(0),
  otherLabel: optionalText(120),
  assumptions: optionalText(1000),
  noteToCustomer: optionalText(1000),
  serviceDate: isoDate.optional(),
  timeWindow: z.enum(TIME_WINDOWS).optional(),
});

export const reasonSchema = z.object({ reason: text(500).min(3, 'Give a short reason') });
export const optionalReasonSchema = z.object({ reason: optionalText(500) });

export const sheetSchema = z.object({
  items: z.array(z.object({
    bookingItemId: optionalId,
    itemName: optionalText(120),
    optionLabel: optionalText(160),
    outcome: z.enum(['bought', 'partly', 'unavailable', 'substituted', 'sampled']),
    actualQuantity: z.union([z.coerce.number().min(0).max(100000), z.null(), z.literal('').transform(() => null)]).optional(),
    quantityNote: optionalText(120),
    actualAmount: naira.default(0),
    observedPrice: optionalNaira,
    notes: optionalText(500),
  })).max(100),
  serviceFee: naira,
  transportCost: naira,
  otherCosts: naira.default(0),
  otherLabel: optionalText(120),
  summaryNote: optionalText(1000),
  internalNotes: optionalText(1000),
});

export const changeRequestSchema = z.object({
  type: z.enum(['extra_spend', 'substitution']),
  bookingItemId: optionalId,
  description: text(500).min(5, 'Explain what you need the customer to decide'),
  extraAmount: naira.default(0),
});

export const attachmentSchema = z.object({
  kind: z.enum(['receipt', 'sample_photo', 'item_photo', 'other']).default('receipt'),
  caption: optionalText(200),
});

export const refundSchema = z.object({
  method: z.enum(['bank_transfer', 'paystack']).default('bank_transfer'),
  reference: optionalText(100),
  note: optionalText(200),
});

export const reconciliationStatusSchema = z.object({
  status: z.enum(['settled', 'disputed', 'additional_due', 'refund_pending']),
  reason: text(500).min(3, 'Give a reason'),
});

export const marketSchema = z.object({
  slug,
  name: text(120).min(2),
  area: text(80).min(2),
  city: text(60).default('Lagos'),
  lat, lng,
  publicDescription: optionalText(500),
  openDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
  opensAt: time,
  closesAt: time,
  internalNotes: optionalText(500),
  active: z.boolean().default(true),
  sort: z.coerce.number().int().default(0),
  categoryIds: z.array(id).default([]),
});

export const categorySchema = z.object({
  slug, name: text(80).min(2), icon: optionalText(16), sort: z.coerce.number().int().default(0), active: z.boolean().default(true),
});

export const optionSchema = z.object({
  id: optionalId,
  unitLabel: text(60).min(1, 'Unit, e.g. Basket or Bag (50kg)'),
  variant: optionalText(80),
  priceType: z.enum(['fixed', 'range', 'none']),
  price: optionalNaira,
  priceMin: optionalNaira,
  priceMax: optionalNaira,
  allowQuantity: z.boolean().default(true),
  isStandard: z.boolean().default(false),
  sort: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});

export const itemSchema = z.object({
  categoryId: id,
  name: text(120).min(2),
  description: optionalText(500),
  searchTerms: optionalText(255),
  allowOpenAmount: z.boolean().default(true),
  allowSubstitutions: z.boolean().default(true),
  restockDays: z.union([z.coerce.number().int().min(1).max(365), z.null(), z.literal('').transform(() => null)]).optional(),
  active: z.boolean().default(true),
  sort: z.coerce.number().int().default(0),
  options: z.array(optionSchema).max(20).default([]),
});

export const exceptionSchema = z.object({
  date: isoDate,
  type: z.enum(['blocked', 'capacity', 'clear']),
  capacityUnits: z.coerce.number().int().min(0).max(50).optional(),
  reason: optionalText(160),
});

export const calendarQuery = z.object({ from: isoDate.optional(), days: z.coerce.number().int().min(7).max(62).default(35) });

export const settingsSchemas = {
  operations: z.object({
    workingDays: z.array(z.number().int().min(0).max(6)).min(1),
    dailyCapacityUnits: z.coerce.number().int().min(0).max(50),
    fullPurchaseUnits: z.coerce.number().int().min(1).max(20),
    sampleRunUnits: z.coerce.number().int().min(1).max(20),
    leadTimeDays: z.coerce.number().int().min(0).max(30),
    bookingWindowDays: z.coerce.number().int().min(7).max(120),
    reviewHoldHours: z.coerce.number().int().min(1).max(240),
    quoteValidHours: z.coerce.number().int().min(1).max(240),
    paymentWindowHours: z.coerce.number().int().min(1).max(240),
    sameDayCutoffHour: z.coerce.number().int().min(0).max(23),
  }).partial(),
  pricing: z.object({
    fullPurchaseFeeFixed: naira, fullPurchaseFeePercent: z.coerce.number().min(0).max(50),
    fullPurchaseFeeMin: naira, fullPurchaseFeeMax: naira, sampleRunFee: naira,
    transportBaseFare: naira, transportPerKm: naira, transportRoundTo: z.coerce.number().int().min(1).max(5000),
    authorizedLimitBufferPercent: z.coerce.number().min(0).max(100),
  }).partial(),
  baseLocation: z.object({ label: text(80), lat, lng }).partial(),
  payments: z.object({
    allowManualTransfer: z.boolean(), bankName: text(80), accountName: text(120),
    accountNumber: z.string().trim().regex(/^\d{10}$|^$/, 'NUBAN is 10 digits'), instructions: text(300),
  }).partial(),
  kitchen: z.object({
    enabled: z.boolean(),
    workingDays: z.array(z.number().int().min(0).max(6)).min(1),
    dailyCapacityPortions: z.coerce.number().int().min(0).max(2000),
    maxOrdersPerDay: z.coerce.number().int().min(1).max(200),
    fullDayCutoff: time, extraHoursCutoff: time,
    extraHours: z.coerce.number().int().min(0).max(12),
    bulkPortionThreshold: z.coerce.number().min(1).max(1000),
    bulkExtraDays: z.coerce.number().int().min(0).max(14),
    bookingWindowDays: z.coerce.number().int().min(3).max(90),
    paymentWindowHours: z.coerce.number().int().min(1).max(72),
    deliveryWindows: z.array(z.object({ key: z.string().regex(/^[a-z0-9_-]{2,20}$/), label: text(60).min(2), start: time, end: time })).min(1).max(6),
    expressEnabled: z.boolean(),
    expressSurchargePercent: z.coerce.number().min(0).max(300),
    expressMinFee: naira,
    expressMinHoursAhead: z.coerce.number().int().min(1).max(48),
    expressReplyHours: z.coerce.number().int().min(1).max(48),
    expressEarliestTime: time, expressLatestTime: time,
    deliveryBaseFee: naira, deliveryPerKm: naira,
  }).partial(),
  notifications: z.object({
    operatorEmails: z.string().trim().max(500).refine((v) => !v || v.split(',').every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())), 'Comma-separated email addresses'),
  }).partial(),
  restocking: z.object({
    defaultHouseholdSize: z.coerce.number().int().min(1).max(20), defaultLeadDays: z.coerce.number().int().min(0).max(14),
    minDays: z.coerce.number().int().min(1).max(60), maxDays: z.coerce.number().int().min(7).max(365),
  }).partial(),
};

export const customerListQuery = pagination.extend({ q: z.string().trim().max(100).optional() });
export const customerStatusSchema = z.object({ status: z.enum(['active', 'suspended']), reason: text(500).min(3, 'Give a reason') });
export const paymentListQuery = pagination.extend({
  status: z.enum(['initiated', 'pending', 'successful', 'failed', 'cancelled']).optional(),
  provider: z.enum(['paystack', 'manual', 'credit']).optional(),
  type: z.enum(['charge', 'additional_charge', 'refund', 'credit_issued', 'credit_applied']).optional(),
});
export const auditQuery = pagination.extend({ action: z.string().trim().max(60).optional() });
