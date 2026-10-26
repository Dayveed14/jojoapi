// Operator: dashboard, calendar, catalogue, markets, settings, customers, payments, audit
import * as adminService from '../../services/admin.service.js';
import * as catalogService from '../../services/catalog.service.js';
import * as paymentService from '../../services/payment.service.js';
import * as settingsService from '../../services/settings.service.js';
import * as auditService from '../../services/audit.service.js';
import { settingsSchemas } from '../../validators/admin.validators.js';
import { badRequest, notFound } from '../../utils/errors.js';

export async function dashboard(_req, res) {
  res.json(await adminService.dashboard());
}

export async function calendar(req, res) {
  res.json(await adminService.calendar(req.validatedQuery));
}

export async function setException(req, res) {
  await adminService.setException(req.body, req.user, req.ip);
  res.json({ ok: true });
}

// Catalogue
export async function catalog(_req, res) {
  res.json(await catalogService.adminCatalog());
}
export async function saveItem(req, res) {
  const item = await catalogService.saveItem(req.params.id ? Number(req.params.id) : null, req.body, req.user, req.ip);
  res.status(req.params.id ? 200 : 201).json({ item });
}
export async function saveCategory(req, res) {
  const id = await catalogService.saveCategory(req.params.id ? Number(req.params.id) : null, req.body, req.user, req.ip);
  res.status(req.params.id ? 200 : 201).json({ id });
}
export async function saveMarket(req, res) {
  const id = await catalogService.saveMarket(req.params.id ? Number(req.params.id) : null, req.body, req.user, req.ip);
  res.status(req.params.id ? 200 : 201).json({ id });
}

// Settings
export async function getSettings(_req, res) {
  res.json({ settings: await settingsService.getAll({ fresh: true }), onlinePayments: paymentService.onlineEnabled() });
}
export async function updateSettings(req, res) {
  const schema = settingsSchemas[req.params.key];
  if (!schema) throw notFound('Unknown settings group');
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    const fields = Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]));
    throw badRequest('Please check the highlighted fields.', { fields });
  }
  const value = await settingsService.update(req.params.key, parsed.data, req.user.id);
  await auditService.record({ actorUserId: req.user.id, action: `settings.${req.params.key}_updated`, entityType: 'settings', entityId: req.params.key, ip: req.ip });
  res.json({ value });
}

// Customers
export async function customers(req, res) {
  res.json(await adminService.listCustomers(req.validatedQuery));
}
export async function customer(req, res) {
  const c = await adminService.customerDetail(Number(req.params.id));
  if (!c) throw notFound('Customer not found');
  res.json({ customer: c });
}
export async function setCustomerStatus(req, res) {
  await adminService.setCustomerStatus(Number(req.params.id), req.body.status, req.body.reason, req.user, req.ip);
  res.json({ customer: await adminService.customerDetail(Number(req.params.id)) });
}

// Money & records
export async function payments(req, res) {
  res.json(await adminService.listPayments(req.validatedQuery));
}
export async function purchases(req, res) {
  res.json({ items: await adminService.listPurchases(req.validatedQuery) });
}
export async function auditLog(req, res) {
  res.json(await adminService.auditLog(req.validatedQuery));
}
export async function notifications(_req, res) {
  res.json({ items: await adminService.notifications() });
}
