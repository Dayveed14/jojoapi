// Jojo's Kitchen (customer). The menu is public; ordering needs a customer session.
import { Router } from 'express';
import * as kitchen from '../controllers/kitchen.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h } from '../utils/errors.js';
import { kitchenCancelSchema, kitchenManualPaySchema, kitchenOrderSchema, kitchenQuoteSchema } from '../validators/kitchen.validators.js';

const router = Router();

router.get('/menu', h(kitchen.menu));

router.use(requireAuth, requireRole('customer'));
router.post('/quote', validate(kitchenQuoteSchema), h(kitchen.quote));
router.post('/orders', validate(kitchenOrderSchema), h(kitchen.create));
router.get('/orders', h(kitchen.list));
router.get('/orders/:reference', h(kitchen.get));
router.post('/orders/:reference/cancel', validate(kitchenCancelSchema), h(kitchen.cancel));
router.post('/orders/:reference/pay/online', h(kitchen.payOnline));
router.post('/orders/:reference/pay/manual', validate(kitchenManualPaySchema), h(kitchen.payManual));
router.post('/orders/:reference/pay/credit', h(kitchen.payCredit));

export default router;
