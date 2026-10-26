import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCsrfHeader } from '../middleware/csrf.js';
import { loginLimiter, refreshLimiter, registerLimiter, resetLimiter } from '../middleware/rateLimits.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h } from '../utils/errors.js';
import { forgotSchema, loginSchema, registerSchema, resetSchema, verifySchema } from '../validators/auth.validators.js';

const router = Router();

router.post('/register', registerLimiter, validate(registerSchema), h(auth.register));
router.post('/login', loginLimiter, validate(loginSchema), h(auth.login));
router.post('/refresh', refreshLimiter, requireCsrfHeader, h(auth.refresh));
router.post('/logout', requireCsrfHeader, h(auth.logout));
router.post('/forgot-password', resetLimiter, validate(forgotSchema), h(auth.forgotPassword));
router.post('/reset-password', resetLimiter, validate(resetSchema), h(auth.resetPassword));
router.post('/verify-email', resetLimiter, validate(verifySchema), h(auth.verifyEmail));
router.post('/resend-verification', resetLimiter, requireAuth, h(auth.resendVerification));

export default router;
