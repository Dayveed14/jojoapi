import * as addressService from '../services/address.service.js';
import * as bookingService from '../services/booking.service.js';
import * as paymentService from '../services/payment.service.js';
import * as restockService from '../services/restock.service.js';
import * as sessionService from '../services/session.service.js';
import * as userService from '../services/user.service.js';
import { badRequest } from '../utils/errors.js';

export async function getMe(req, res) {
  res.json({ user: await userService.getMe(req.user.id) });
}

export async function updateMe(req, res) {
  res.json({ user: await userService.updateProfile(req.user.id, req.body) });
}

export async function changePassword(req, res) {
  const row = await userService.changePassword(req.user.id, req.body, req.ip);
  const accessToken = await sessionService.startSession(row, req, res); // keep this device signed in
  res.json({ user: await userService.getMe(req.user.id), accessToken, message: 'Password updated. Other devices have been signed out.' });
}

export async function uploadAvatar(req, res) {
  if (!req.file) throw badRequest('Choose an image to upload.');
  res.json({ user: await userService.setAvatar(req.user.id, req.file.buffer) });
}

export async function removeAvatar(req, res) {
  res.json({ user: await userService.removeAvatar(req.user.id) });
}

export async function dashboard(req, res) {
  const [bookings, restock, me] = await Promise.all([
    bookingService.dashboardForCustomer(req.user.id),
    restockService.summaryForCustomer(req.user.id),
    userService.getMe(req.user.id),
  ]);
  res.json({ ...bookings, restock, creditBalance: me.creditBalance });
}

// Addresses
export async function listAddresses(req, res) {
  res.json({ items: await addressService.list(req.user.id) });
}
export async function createAddress(req, res) {
  res.status(201).json({ address: await addressService.create(req.user.id, req.body) });
}
export async function updateAddress(req, res) {
  res.json({ address: await addressService.update(Number(req.params.id), req.user.id, req.body) });
}
export async function deleteAddress(req, res) {
  await addressService.remove(Number(req.params.id), req.user.id);
  res.status(204).end();
}

export async function listPayments(req, res) {
  res.json(await paymentService.listForCustomer(req.user.id));
}
