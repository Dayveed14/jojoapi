import { Router } from 'express';
import { asyncHandler } from '../../utils/errors.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireCsrfHeader } from '../../middleware/csrf.js';
import { loginLimiter, refreshLimiter, registerLimiter, resetLimiter } from '../../middleware/rateLimits.js';
import { findUserWithProfile, toPublicUser } from '../users/users.repo.js';
import { forgotSchema, loginSchema, registerSchema, resetSchema, verifySchema } from './auth.schemas.js';
import * as auth from './auth.service.js';
import { endSession, rotateSession, startSession } from './session.service.js';

const router = Router();

router.post('/register', registerLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  const user = await auth.register(req.body, req.ip);
  const accessToken = await startSession(user, req, res);
  res.status(201).json({ user: toPublicUser(user), accessToken });
}));

router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const user = await auth.login(req.body, req.ip);
  const accessToken = await startSession(user, req, res);
  res.json({ user: toPublicUser(user), accessToken });
}));

router.post('/refresh', refreshLimiter, requireCsrfHeader, asyncHandler(async (req, res) => {
  const { accessToken, userId } = await rotateSession(req, res);
  const user = await findUserWithProfile(userId);
  res.json({ user: toPublicUser(user), accessToken });
}));

router.post('/logout', requireCsrfHeader, asyncHandler(async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
}));

const GENERIC_RESET_MSG = 'If an account exists for that email, we have sent a link to reset the password.';

router.post('/forgot-password', resetLimiter, validate(forgotSchema), asyncHandler(async (req, res) => {
  await auth.requestPasswordReset(req.body.email, req.ip);
  res.json({ message: GENERIC_RESET_MSG });
}));

router.post('/reset-password', resetLimiter, validate(resetSchema), asyncHandler(async (req, res) => {
  await auth.resetPassword(req.body, req.ip);
  res.json({ message: 'Your password has been updated. Please sign in with your new password.' });
}));

router.post('/verify-email', resetLimiter, validate(verifySchema), asyncHandler(async (req, res) => {
  await auth.verifyEmail(req.body.token, req.ip);
  res.json({ message: 'Email confirmed. Thank you!' });
}));

router.post('/resend-verification', resetLimiter, requireAuth, asyncHandler(async (req, res) => {
  await auth.resendVerification(req.user.id);
  res.json({ message: 'If your email is not yet confirmed, a new link is on its way.' });
}));

export default router;
