import * as paymentService from '../services/payment.service.js';

/** Paystack webhook. Raw body is required for signature verification. Always 200 once verified. */
export async function paystackWebhook(req, res) {
  await paymentService.handleWebhook(req.body, req.get('x-paystack-signature'));
  res.json({ received: true });
}

/** Called by the payment callback page. Re-verifies with Paystack; never trusts the redirect alone. */
export async function verify(req, res) {
  res.json(await paymentService.confirmOnline(req.body.reference, { expectedCustomerId: req.user.id }));
}
