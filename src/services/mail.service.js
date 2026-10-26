// Email: Resend in real use (RESEND_API_KEY set), printed to the terminal in development.
// Every message has a plain-text and a branded HTML version built from the same content.
// Subjects never contain item names or amounts (they show on lock screens).
import { env, isProd, resendEnabled } from '../config/env.js';
import * as Notification from '../models/notification.model.js';
import { formatNaira } from '../utils/money.js';
import * as resend from './providers/resend.provider.js';

const consoleTransport = {
  async send({ to, subject, text }) {
    if (env.NODE_ENV !== 'test') {
      console.log(`\n--- email (not sent: RESEND_API_KEY not set) ---\nFrom: ${env.MAIL_FROM}\nTo: ${to}\nSubject: ${subject}\n\n${text}\n-----------------------------------------------\n`);
    }
    return { id: `dev-${Date.now()}` };
  },
};

let transport = resendEnabled && env.NODE_ENV !== 'test' ? resend : consoleTransport;
export const setMailTransport = (t) => { transport = t; };
export const mailMode = () => (transport === resend ? 'resend' : 'console');

export async function send({ to, subject, text, html, userId = null, bookingId = null, templateKey = 'generic', idempotencyKey }) {
  try {
    const res = await transport.send({ to, subject, text, html, idempotencyKey });
    await Notification.log({ userId, bookingId, templateKey, status: 'sent', providerReference: res?.id });
    return res;
  } catch (err) {
    console.error(`mail send failed (${templateKey}):`, isProd ? err.code || 'unknown' : err.message);
    await Notification.log({ userId, bookingId, templateKey, status: 'failed', errorCode: String(err.code || 'unknown').slice(0, 60) }).catch(() => {});
    return null;
  }
}

// ---------- Layout ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (path) => `${env.CLIENT_ORIGIN}${path}`;

const C = { green: '#065E2F', orange: '#F45909', gold: '#FDB723', cream: '#FDF9EE', ink: '#1D2A20', muted: '#6F7B71' };

/**
 * Build a message from simple blocks. `lines` are paragraphs (strings) or
 * { rows: [[label, value], …] } for a little money table. Values are escaped.
 */
function compose({ templateKey, subject, preheader, heading, lines = [], button, footnote }) {
  const textParts = [heading, ''];
  const htmlParts = [];
  for (const l of lines) {
    if (typeof l === 'string') {
      textParts.push(l, '');
      htmlParts.push(`<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${C.ink}">${esc(l)}</p>`);
    } else if (l.rows) {
      textParts.push(...l.rows.map(([k, v]) => `${k}: ${v}`), '');
      htmlParts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border-collapse:collapse">${
        l.rows.map(([k, v], i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #EFE8D6;font-size:14px;color:${C.muted}">${esc(k)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #EFE8D6;font-size:14px;font-weight:${i === l.rows.length - 1 ? 800 : 600};color:${C.ink}">${esc(v)}</td></tr>`).join('')
      }</table>`);
    } else if (l.list) {
      textParts.push(...l.list.map((x) => `  • ${x}`), '');
      htmlParts.push(`<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;color:${C.ink}">${l.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
    }
  }
  if (button) textParts.push(`${button.label}: ${button.url}`, '');
  if (footnote) textParts.push(footnote, '');
  textParts.push('— Jojo Market');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.cream};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader || heading)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:4px 8px 16px;font-size:26px;font-weight:800;letter-spacing:-0.5px"><span style="color:${C.green}">jojo</span><span style="color:${C.orange}">market</span></td></tr>
    <tr><td style="background:#ffffff;border-radius:18px;padding:28px 26px;border-top:6px solid ${C.gold}">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${C.green}">${esc(heading)}</h1>
      ${htmlParts.join('\n      ')}
      ${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px"><tr><td style="border-radius:999px;background:${C.orange}"><a href="${esc(button.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${esc(button.label)}</a></td></tr></table>
      <p style="margin:10px 0 0;font-size:12px;color:${C.muted}">Or paste this link into your browser:<br><a href="${esc(button.url)}" style="color:${C.green};word-break:break-all">${esc(button.url)}</a></p>` : ''}
      ${footnote ? `<p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:${C.muted}">${esc(footnote)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:18px 8px;font-size:12px;line-height:1.5;color:${C.muted}" align="center">Jojo Market · Your trusted market shopper in Lagos<br>All prices before shopping are estimates.</td></tr>
  </table>
</td></tr></table></body></html>`;

  return { templateKey, subject, text: textParts.join('\n'), html };
}

const bookingButton = (b, label = 'View your booking') => ({ label, url: link(`/app/bookings/${b.reference}`) });

// ---------- Templates ----------

export const templates = {
  verify: (url) => compose({
    templateKey: 'auth.verify',
    subject: 'Confirm your Jojo Market email',
    heading: 'Welcome to Jojo Market!',
    lines: ['Please confirm your email address. We use it to send your quotes, receipts and reminders.'],
    button: { label: 'Confirm my email', url },
    footnote: `This link expires in ${env.EMAIL_VERIFY_TTL_HOURS} hours. If you didn’t create an account, you can ignore this email.`,
  }),
  reset: (url) => compose({
    templateKey: 'auth.reset',
    subject: 'Reset your Jojo Market password',
    heading: 'Reset your password',
    lines: ['We received a request to reset your Jojo Market password.'],
    button: { label: 'Choose a new password', url },
    footnote: `The link expires in ${env.PASSWORD_RESET_TTL_MINUTES} minutes and can only be used once. If you didn’t ask for this, ignore this email — your password stays the same.`,
  }),
  bookingReceived: (b) => compose({
    templateKey: 'booking.received',
    subject: `We've received your request ${b.reference}`,
    heading: 'Your request is with Jojo',
    lines: [`Thanks! Request ${b.reference} is being reviewed. You’ll get a quote by email once Jojo has checked the date, market and list.`, 'Nothing is charged until you accept the quote.'],
    button: bookingButton(b, 'Track your request'),
  }),
  quoteReady: (b, q) => compose({
    templateKey: 'booking.quote_ready',
    subject: `Your quote for ${b.reference} is ready`,
    heading: 'Your quote is ready',
    lines: [`Jojo has reviewed request ${b.reference}.`, { rows: [['Goods', formatNaira(q.goods_amount)], ['Service fee', formatNaira(q.service_fee)], ['Transport', formatNaira(q.transport_cost)], ['Pay upfront', formatNaira(q.upfront_amount)]] },
      'Any goods money that isn’t spent comes back to you as a refund or credit.'],
    button: bookingButton(b, 'Review & accept'),
  }),
  declined: (b) => compose({
    templateKey: 'booking.declined',
    subject: `Update on your request ${b.reference}`,
    heading: 'Jojo can’t take this request',
    lines: [`Sorry — request ${b.reference} couldn’t be accepted.`, ...(b.status_reason ? [`Reason: ${b.status_reason}`] : []), 'You haven’t been charged.'],
    button: { label: 'Book another date', url: link('/app/bookings/new') },
  }),
  paymentConfirmed: (b, amount) => compose({
    templateKey: 'payment.confirmed',
    subject: `Payment received for ${b.reference}`,
    heading: 'Payment received — you’re booked!',
    lines: [`We’ve confirmed your payment of ${formatNaira(amount)} for ${b.reference}.`],
    button: bookingButton(b),
  }),
  decisionNeeded: (b) => compose({
    templateKey: 'booking.decision_needed',
    subject: `Jojo needs your OK on ${b.reference}`,
    heading: 'Jojo needs your OK',
    lines: [`While shopping for ${b.reference}, Jojo needs your decision — extra spending or a substitution.`, 'Nothing above your limit will be bought without your approval.'],
    button: bookingButton(b, 'Respond now'),
  }),
  shoppingDone: (b) => compose({
    templateKey: 'booking.ready',
    subject: `Update on ${b.reference}`,
    heading: b.booking_type === 'sample_run' ? 'Your sample results are ready' : 'Shopping done — on the way!',
    lines: [b.booking_type === 'sample_run'
      ? `Jojo has finished the sample run for ${b.reference}. Photos, prices and notes are waiting for you.`
      : `Jojo has finished shopping for ${b.reference} and it’s on the way. The itemised record is ready.`],
    button: bookingButton(b, b.booking_type === 'sample_run' ? 'See the results' : 'See what was bought'),
  }),
  completed: (b, rec) => compose({
    templateKey: 'booking.completed',
    subject: `Your receipt for ${b.reference}`,
    heading: 'Your market run is complete',
    lines: [
      { rows: [['Final total', formatNaira(rec.actual_final_total)], ['You paid', formatNaira(rec.paid_total)]] },
      ...(Number(rec.refund_due) > 0 ? [`${formatNaira(rec.refund_due)} wasn’t spent. Choose a refund to your bank or Jojo Market credit on the booking page.`]
        : Number(rec.additional_due) > 0 ? [`Balance to pay for the extra you approved: ${formatNaira(rec.additional_due)}.`] : []),
    ],
    button: bookingButton(b, 'See your itemised receipt'),
  }),
  refundSent: (b, amount) => compose({
    templateKey: 'payment.refund_sent',
    subject: `Refund sent for ${b.reference}`,
    heading: 'Your refund is on its way',
    lines: [`We’ve sent ${formatNaira(amount)} for ${b.reference}. Depending on your bank it may take a little while to show.`],
    button: bookingButton(b),
  }),
  restock: (name, items) => compose({
    templateKey: 'restock.reminder',
    subject: 'Time to plan your next market run?',
    heading: `Hello ${name}, running low?`,
    lines: ['Based on your last shop, you may be running low on:', { list: items }, 'These are only estimates — tell us if you still have some and we’ll adjust.'],
    button: { label: 'Plan my next shop', url: link('/app/restocking') },
    footnote: `Don’t want these reminders? Turn them off in your settings: ${link('/app/settings')}`,
  }),
};
