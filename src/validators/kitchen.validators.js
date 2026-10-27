import { z } from 'zod';
import { KITCHEN_EXCLUSIONS, MEAL_CATEGORIES } from '../config/constants.js';
import { id, isoDate, naira, optionalText, pagination, text } from './common.validators.js';

const exclusion = z.enum(Object.keys(KITCHEN_EXCLUSIONS));

export const orderItemSchema = z.object({
  mealId: id,
  optionId: id,
  quantity: z.coerce.number().int().min(1, 'At least 1').max(200, 'Up to 200 per dish — for more, contact Jojo'),
  exclusions: z.array(exclusion).max(12).default([]),
  spiceLevel: z.enum(['mild', 'medium', 'hot']).nullable().optional(),
  instructions: optionalText(500),
});

export const kitchenQuoteSchema = z.object({
  items: z.array(orderItemSchema).min(1, 'Add at least one dish').max(30),
  addressId: id.optional().nullable(),
});

export const kitchenOrderSchema = z.discriminatedUnion('orderType', [
  z.object({
    orderType: z.literal('regular'),
    items: z.array(orderItemSchema).min(1, 'Add at least one dish').max(30),
    addressId: id,
    deliveryDate: isoDate,
    deliveryWindow: z.string().trim().min(1, 'Choose a delivery time').max(20),
    customerNotes: optionalText(1000),
    allergyNotes: optionalText(500),
    acceptTerms: z.literal(true, { message: 'Please confirm the order details' }),
  }),
  z.object({
    orderType: z.literal('express'),
    items: z.array(orderItemSchema).min(1, 'Add at least one dish').max(30),
    addressId: id,
    requestedDeliveryAt: z.string().datetime({ offset: true, message: 'Choose a delivery date and time' }),
    customerNotes: optionalText(1000),
    allergyNotes: optionalText(500),
    acceptTerms: z.literal(true, { message: 'Please confirm the order details' }),
  }),
]);

export const kitchenCancelSchema = z.object({ reason: optionalText(500) });
export const kitchenManualPaySchema = z.object({ payerNote: text(255).min(3, 'Tell us the name or reference on your transfer') });

// ---------- Operator ----------
export const approveExpressSchema = z.object({ expressFee: naira, deliveryFee: naira, note: optionalText(1000) });
export const advanceSchema = z.object({ to: z.enum(['preparing', 'cooking', 'out_for_delivery', 'delivered']) });
export const operatorCancelSchema = z.object({ reason: text(500).min(3, 'Give a short reason'), refundMethod: z.enum(['credit', 'refund']).default('credit') });
export const kitchenRefundSchema = z.object({ reference: optionalText(100), note: optionalText(200) });
export const kitchenListQuery = pagination.extend({
  scope: z.enum(['express', 'payment', 'upcoming', 'delivered', 'closed']).optional(),
  q: z.string().trim().max(100).optional(),
});
export const sheetQuery = z.object({ date: isoDate });
export const overrideSchema = z.object({
  date: isoDate,
  type: z.enum(['blocked', 'capacity', 'clear']),
  capacityPortions: z.coerce.number().int().min(0).max(1000).optional(),
  reason: optionalText(160),
});

export const mealSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/, 'Use lowercase letters, numbers and dashes'),
  name: text(120).min(2),
  category: z.enum(Object.keys(MEAL_CATEGORIES)),
  description: optionalText(600),
  illustration: optionalText(40),
  allowedExclusions: z.array(exclusion).default([]),
  spiceLevels: z.boolean().default(true),
  contains: optionalText(255),
  featured: z.boolean().default(false),
  active: z.boolean().default(true),
  sort: z.coerce.number().int().default(0),
  options: z.array(z.object({
    id: id.optional().nullable(),
    label: text(80).min(1, 'Size label, e.g. Plate or 1 litre'),
    serves: optionalText(40),
    price: naira.refine((v) => v > 0, 'Enter a price'),
    portions: z.coerce.number().min(0.1).max(500).default(1),
    isBulk: z.boolean().default(false),
    active: z.boolean().default(true),
  })).min(1, 'Add at least one size'),
});
