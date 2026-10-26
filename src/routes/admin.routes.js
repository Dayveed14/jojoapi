// Operator API. Every route requires an operator session — checked on the server.
import { Router } from 'express';
import * as bookings from '../controllers/admin/booking.controller.js';
import * as ops from '../controllers/admin/operations.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimits.js';
import { imageUpload } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h } from '../utils/errors.js';
import { pagination } from '../validators/common.validators.js';
import {
  attachmentSchema, auditQuery, bookingListQuery, calendarQuery, categorySchema, changeRequestSchema, customerListQuery,
  customerStatusSchema, exceptionSchema, itemSchema, marketSchema, optionalReasonSchema, paymentListQuery, quoteSchema,
  reasonSchema, reconciliationStatusSchema, refundSchema, sheetSchema,
} from '../validators/admin.validators.js';

const router = Router();
router.use(requireAuth, requireRole('operator'));

router.get('/dashboard', h(ops.dashboard));

// Bookings
router.get('/bookings', validate(bookingListQuery, 'query'), h(bookings.list));
router.get('/bookings/:reference', h(bookings.get));
router.post('/bookings/:reference/quote', validate(quoteSchema), h(bookings.propose));
router.post('/bookings/:reference/decline', validate(reasonSchema), h(bookings.decline));
router.post('/bookings/:reference/cancel', validate(reasonSchema), h(bookings.cancel));
router.post('/bookings/:reference/payments/:paymentId/confirm', h(bookings.confirmPayment));
router.post('/bookings/:reference/payments/:paymentId/reject', validate(reasonSchema), h(bookings.rejectPayment));
router.post('/bookings/:reference/start', h(bookings.startShopping));
router.put('/bookings/:reference/sheet', validate(sheetSchema), h(bookings.saveSheet));
router.post('/bookings/:reference/changes', validate(changeRequestSchema), h(bookings.requestChange));
router.post('/bookings/:reference/changes/:requestId/withdraw', h(bookings.withdrawChange));
router.post('/bookings/:reference/finish', h(bookings.finish));
router.post('/bookings/:reference/reopen', validate(optionalReasonSchema), h(bookings.reopen));
router.post('/bookings/:reference/complete', h(bookings.complete));
router.post('/bookings/:reference/attachments', uploadLimiter, imageUpload(8).single('photo'), validate(attachmentSchema), h(bookings.uploadAttachment));
router.get('/bookings/:reference/attachments/:attachmentId', h(bookings.attachmentUrl));
router.delete('/bookings/:reference/attachments/:attachmentId', h(bookings.deleteAttachment));
router.post('/bookings/:reference/refund', validate(refundSchema), h(bookings.recordRefund));
router.post('/bookings/:reference/reconciliation-status', validate(reconciliationStatusSchema), h(bookings.setReconciliationStatus));

// Calendar
router.get('/calendar', validate(calendarQuery, 'query'), h(ops.calendar));
router.post('/calendar/exceptions', validate(exceptionSchema), h(ops.setException));

// Catalogue & markets
router.get('/catalog', h(ops.catalog));
router.post('/catalog/items', validate(itemSchema), h(ops.saveItem));
router.put('/catalog/items/:id', validate(itemSchema), h(ops.saveItem));
router.post('/catalog/categories', validate(categorySchema), h(ops.saveCategory));
router.put('/catalog/categories/:id', validate(categorySchema), h(ops.saveCategory));
router.post('/markets', validate(marketSchema), h(ops.saveMarket));
router.put('/markets/:id', validate(marketSchema), h(ops.saveMarket));

// Settings
router.get('/settings', h(ops.getSettings));
router.put('/settings/:key', h(ops.updateSettings));

// Customers
router.get('/customers', validate(customerListQuery, 'query'), h(ops.customers));
router.get('/customers/:id', h(ops.customer));
router.post('/customers/:id/status', validate(customerStatusSchema), h(ops.setCustomerStatus));

// Money, records, audit
router.get('/payments', validate(paymentListQuery, 'query'), h(ops.payments));
router.get('/purchases', validate(pagination, 'query'), h(ops.purchases));
router.get('/audit-log', validate(auditQuery, 'query'), h(ops.auditLog));
router.get('/notifications', h(ops.notifications));

export default router;
