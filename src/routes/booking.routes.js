// Customer bookings. Every handler loads the booking scoped to the signed-in customer.
import { Router } from 'express';
import * as booking from '../controllers/booking.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h } from '../utils/errors.js';
import {
  acceptQuoteSchema, cancelSchema, createBookingSchema, decideChangeSchema, estimateSchema, manualPaymentSchema,
  refundChoiceSchema, revisionSchema, saveFromBookingSchema,
} from '../validators/customer.validators.js';

const router = Router();
router.use(requireAuth, requireRole('customer'));

router.post('/estimate', validate(estimateSchema), h(booking.estimate));
router.post('/', validate(createBookingSchema), h(booking.create));
router.get('/', h(booking.list));
router.get('/:reference', h(booking.get));
router.post('/:reference/cancel', validate(cancelSchema), h(booking.cancel));
router.post('/:reference/accept-quote', validate(acceptQuoteSchema), h(booking.acceptQuote));
router.post('/:reference/request-revision', validate(revisionSchema), h(booking.requestRevision));
router.post('/:reference/pay/online', h(booking.payOnline));
router.post('/:reference/pay/manual', validate(manualPaymentSchema), h(booking.payManual));
router.post('/:reference/pay/credit', h(booking.payWithCredit));
router.post('/:reference/changes/:requestId', validate(decideChangeSchema), h(booking.decideChange));
router.post('/:reference/refund-choice', validate(refundChoiceSchema), h(booking.chooseRefund));
router.get('/:reference/repeat', h(booking.repeat));
router.post('/:reference/save-list', validate(saveFromBookingSchema), h(booking.saveAsList));
router.get('/:reference/attachments/:attachmentId', h(booking.attachment));

export default router;
