// Business settings (spec §17 decisions) live in the database so the operator can change them without a deploy.
// All amounts are placeholders until Jojo confirms her real figures.
import * as Settings from '../models/settings.model.js';

export const DEFAULTS = {
  operations: {
    workingDays: [1, 2, 3, 4, 5, 6],   // Mon–Sat (0 = Sunday)
    dailyCapacityUnits: 4,
    fullPurchaseUnits: 2,             // a full shop uses 2 units, a sample run 1
    sampleRunUnits: 1,
    leadTimeDays: 1,                  // earliest booking = tomorrow
    bookingWindowDays: 30,
    reviewHoldHours: 48,              // unreviewed requests release their date after this
    quoteValidHours: 48,
    paymentWindowHours: 24,
    sameDayCutoffHour: 12,            // if lead time is 0, no same-day bookings after this hour
  },
  pricing: {
    fullPurchaseFeeFixed: 3000,
    fullPurchaseFeePercent: 5,        // % of the goods estimate
    fullPurchaseFeeMin: 3000,
    fullPurchaseFeeMax: 25000,
    sampleRunFee: 2500,
    transportBaseFare: 1000,          // per trip
    transportPerKm: 300,
    transportRoundTo: 100,
    authorizedLimitBufferPercent: 10, // suggested headroom above the goods estimate
  },
  // PRIVATE. Never sent to customers. Used only for transport estimates.
  baseLocation: {
    label: 'Operational base',
    lat: 6.5244,
    lng: 3.3792,
  },
  payments: {
    allowManualTransfer: true,
    bankName: '',
    accountName: '',
    accountNumber: '',
    instructions: 'Use your booking reference as the transfer narration.',
  },
  restocking: {
    defaultHouseholdSize: 4,
    defaultLeadDays: 3,
    minDays: 3,
    maxDays: 180,
  },
};

const KEYS = Object.keys(DEFAULTS);

let cache = null;
let cachedAt = 0;

export async function getAll({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < 30_000) return cache;
  const stored = await Settings.getAll();
  cache = Object.fromEntries(KEYS.map((k) => [k, { ...DEFAULTS[k], ...(stored[k] || {}) }]));
  cachedAt = Date.now();
  return cache;
}

export async function get(key) {
  return (await getAll())[key];
}

export async function update(key, value, userId) {
  if (!KEYS.includes(key)) throw new Error(`Unknown settings key ${key}`);
  const merged = { ...(await get(key)), ...value };
  await Settings.upsert(key, merged, userId);
  cache = null;
  return merged;
}

/** Settings that are safe to show customers (no base location, no internal values). */
export async function publicSettings() {
  const { operations, pricing, payments } = await getAll();
  return {
    operations: {
      workingDays: operations.workingDays,
      leadTimeDays: operations.leadTimeDays,
      bookingWindowDays: operations.bookingWindowDays,
      quoteValidHours: operations.quoteValidHours,
      paymentWindowHours: operations.paymentWindowHours,
    },
    pricing: {
      fullPurchaseFeeFixed: pricing.fullPurchaseFeeFixed,
      fullPurchaseFeePercent: pricing.fullPurchaseFeePercent,
      fullPurchaseFeeMin: pricing.fullPurchaseFeeMin,
      fullPurchaseFeeMax: pricing.fullPurchaseFeeMax,
      sampleRunFee: pricing.sampleRunFee,
      authorizedLimitBufferPercent: pricing.authorizedLimitBufferPercent,
    },
    payments: { allowManualTransfer: payments.allowManualTransfer },
  };
}

export const clearCache = () => { cache = null; };
