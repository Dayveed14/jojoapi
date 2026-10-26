import express, { Router } from 'express';
import * as payment from '../controllers/payment.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h } from '../utils/errors.js';
import { verifyPaymentSchema } from '../validators/customer.validators.js';

/** Webhook router is mounted BEFORE express.json() so the raw body is available for the signature check. */
export const webhookRouter = Router();
webhookRouter.post('/paystack/webhook', express.raw({ type: 'application/json', limit: '200kb' }), h(payment.paystackWebhook));

const router = Router();
router.post('/verify', requireAuth, validate(verifyPaymentSchema), h(payment.verify));
export default router;
