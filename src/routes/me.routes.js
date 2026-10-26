import { Router } from 'express';
import * as lists from '../controllers/list.controller.js';
import * as me from '../controllers/me.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimits.js';
import { imageUpload } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h } from '../utils/errors.js';
import { addressSchema, changePasswordSchema, restockUpdateSchema, savedListSchema, updateProfileSchema } from '../validators/customer.validators.js';

const router = Router();
router.use(requireAuth);

router.get('/', h(me.getMe));
router.patch('/', validate(updateProfileSchema), h(me.updateMe));
router.post('/password', validate(changePasswordSchema), h(me.changePassword));
router.post('/avatar', uploadLimiter, imageUpload(2).single('avatar'), h(me.uploadAvatar));
router.delete('/avatar', h(me.removeAvatar));
router.get('/dashboard', h(me.dashboard));

router.get('/addresses', h(me.listAddresses));
router.post('/addresses', validate(addressSchema), h(me.createAddress));
router.patch('/addresses/:id', validate(addressSchema), h(me.updateAddress));
router.delete('/addresses/:id', h(me.deleteAddress));

router.get('/payments', h(me.listPayments));

router.get('/lists', h(lists.lists));
router.post('/lists', validate(savedListSchema), h(lists.createList));
router.get('/lists/:id', h(lists.getList));
router.patch('/lists/:id', validate(savedListSchema), h(lists.updateList));
router.delete('/lists/:id', h(lists.deleteList));

router.get('/restocking', h(lists.restocking));
router.patch('/restocking/:id', validate(restockUpdateSchema), h(lists.updateRestock));

export default router;
