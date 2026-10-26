import * as authService from '../services/auth.service.js';
import * as sessionService from '../services/session.service.js';
import * as userService from '../services/user.service.js';
import * as User from '../models/user.model.js';

const GENERIC_RESET_MSG = 'If an account exists for that email, we have sent a link to reset the password.';

export async function register(req, res) {
  const user = await authService.register(req.body, req.ip);
  const accessToken = await sessionService.startSession(user, req, res);
  res.status(201).json({ user: userService.toPublicUser(user), accessToken });
}

export async function login(req, res) {
  const user = await authService.login(req.body, req.ip);
  const accessToken = await sessionService.startSession(user, req, res);
  res.json({ user: userService.toPublicUser(user), accessToken });
}

export async function refresh(req, res) {
  const { accessToken, userId } = await sessionService.rotateSession(req, res);
  res.json({ user: userService.toPublicUser(await User.findById(userId)), accessToken });
}

export async function logout(req, res) {
  await sessionService.endSession(req, res);
  res.status(204).end();
}

export async function forgotPassword(req, res) {
  await authService.requestPasswordReset(req.body.email, req.ip);
  res.json({ message: GENERIC_RESET_MSG });
}

export async function resetPassword(req, res) {
  await authService.resetPassword(req.body, req.ip);
  res.json({ message: 'Your password has been updated. Please sign in with your new password.' });
}

export async function verifyEmail(req, res) {
  await authService.verifyEmail(req.body.token, req.ip);
  res.json({ message: 'Email confirmed. Thank you!' });
}

export async function resendVerification(req, res) {
  await authService.resendVerification(req.user.id);
  res.json({ message: 'If your email is not yet confirmed, a new link is on its way.' });
}
