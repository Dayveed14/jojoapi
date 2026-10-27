import { Router } from 'express';
import adminRoutes from './admin.routes.js';
import authRoutes from './auth.routes.js';
import kitchenRoutes from './kitchen.routes.js';
import bookingRoutes from './booking.routes.js';
import meRoutes from './me.routes.js';
import paymentRoutes from './payment.routes.js';
import publicRoutes from './public.routes.js';

const router = Router();
router.use('/auth', authRoutes);
router.use('/me', meRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentRoutes);
router.use('/kitchen', kitchenRoutes);
router.use('/admin', adminRoutes);
router.use('/', publicRoutes);
export default router;
