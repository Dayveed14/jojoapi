import { z } from 'zod';
import { BOOKING_TYPES, RESTOCK_STATUSES, TIME_WINDOWS } from '../config/constants.js';
import { displayName, password, phone } from './auth.validators.js';
import { id, isoDate, optionalId, optionalNaira, optionalText, text } from './common.validators.js';

export const updateProfileSchema = z.object({
  displayName: displayName.optional(),
  phone: phone.nullable().optional().or(z.literal('').transform(() => null)),
  preferredContactMethod: z.enum(['email', 'phone', 'whatsapp']).optional(),
  notificationPreferences: z.object({ bookingUpdates: z.boolean(), promotions: z.boolean() }).optional(),
  householdSize: z.union([z.coerce.number().int().min(1, 'At least 1').max(30, 'Up to 30'), z.null(), z.literal('').transform(() => null)]).optional(),
  reminderLeadDays: z.coerce.number().int().min(0).max(14).optional(),
  restockRemindersEnabled: z.boolean().optional(),
}).strict();

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1, 'Enter your current password').max(128), newPassword: password });

export const addressSchema = z.object({
  label: text(40).min(1, 'Give this address a name, e.g. Home'),
  recipientName: text(120).min(2, 'Who should receive the delivery?'),
  recipientPhone: phone,
  addressLine: text(255).min(5, 'Enter the street address'),
  areaId: id,
  landmark: optionalText(160),
  deliveryInstructions: optionalText(500),
  isDefault: z.boolean().default(false),
});

export const lineSchema = z.object({
  catalogItemId: optionalId,
  optionId: optionalId,
  customName: optionalText(120),
  requestMethod: z.enum(['quantity', 'amount']),
  quantity: z.union([z.coerce.number().positive('Enter a quantity').max(1000), z.null(), z.literal('').transform(() => null)]).optional(),
  amount: optionalNaira,
  preferences: optionalText(500),
  allowSubstitution: z.boolean().default(false),
}).refine((l) => l.catalogItemId || l.customName, { message: 'Choose an item or type its name', path: ['customName'] });

const bookingBase = {
  bookingType: z.enum(BOOKING_TYPES),
  marketId: id,
  items: z.array(lineSchema).min(1, 'Add at least one item').max(60, 'Up to 60 items per booking'),
  addressId: optionalId,
  deliveryRequired: z.boolean().default(false),
  intendedGoodsBudget: optionalNaira,
  authorizedGoodsLimit: optionalNaira,
};

export const estimateSchema = z.object(bookingBase);

export const createBookingSchema = z.object({
  ...bookingBase,
  serviceDate: isoDate,
  timeWindow: z.enum(TIME_WINDOWS).default('morning'),
  customerNotes: optionalText(1000),
  sourceReference: z.string().regex(/^JM-[A-Z0-9]{6}$/).optional().nullable(),
  acceptPolicies: z.literal(true, { message: 'Please confirm you have read the payment and cancellation terms' }),
});

export const cancelSchema = z.object({ reason: optionalText(500) });
export const acceptQuoteSchema = z.object({ quoteId: id });
export const revisionSchema = z.object({ reason: text(500).min(3, 'Tell Jojo what you would like changed') });
export const decideChangeSchema = z.object({ decision: z.enum(['approve', 'reject']), note: optionalText(500) });
export const refundChoiceSchema = z.object({ choice: z.enum(['refund', 'credit']) });
export const manualPaymentSchema = z.object({ payerNote: text(255).min(3, 'Tell us the name or reference on your transfer') });
export const verifyPaymentSchema = z.object({ reference: z.string().trim().min(6).max(100) });

export const savedListSchema = z.object({
  name: text(80).min(1, 'Name your list'),
  marketId: optionalId,
  items: z.array(lineSchema).max(60),
});
export const saveFromBookingSchema = z.object({ name: text(80).min(1, 'Name your list') });

export const restockUpdateSchema = z.object({
  status: z.enum(RESTOCK_STATUSES).optional(),
  estimatedDurationDays: z.coerce.number().int().min(1).max(365).optional(),
  remindersEnabled: z.boolean().optional(),
  snoozeDays: z.coerce.number().int().min(1).max(60).optional(),
});

export const availabilityQuery = z.object({
  bookingType: z.enum(BOOKING_TYPES).default('full_purchase'),
  marketId: optionalId,
});

