// No sign-in needed: markets, catalogue and prices are public; availability shows open dates only.
import { Router } from 'express';
import * as pub from '../controllers/public.controller.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h } from '../utils/errors.js';
import { availabilityQuery } from '../validators/customer.validators.js';

const router = Router();

router.get('/markets', h(pub.markets));
router.get('/markets/:id/catalog', h(pub.marketCatalog));
router.get('/areas', h(pub.areas));
router.get('/service-info', h(pub.serviceInfo));
router.get('/availability', validate(availabilityQuery, 'query'), h(pub.availability));

export default router;
