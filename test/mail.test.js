// Resend adapter + email templates (no network: fetch is stubbed).
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.RESEND_API_KEY = 're_test_123';
process.env.MAIL_FROM = 'Jojo Market <jojomarket@fixer.com>';
process.env.MAIL_REPLY_TO = 'hello@fixer.com';

const resend = await import('../src/services/providers/resend.provider.js');
const { templates } = await import('../src/services/mail.service.js');
const { pool } = await import('../src/db/pool.js');

test('sends to the Resend API from the fixer.com address with text + html', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }); };
  try {
    const tpl = templates.verify('https://example.test/verify-email?token=abc');
    const res = await resend.send({ to: 'ada@example.com', ...tpl, idempotencyKey: 'k1' });
    assert.equal(res.id, 'em_1');
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_123');
    assert.equal(calls[0].init.headers['Idempotency-Key'], 'k1');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.from, 'Jojo Market <jojomarket@fixer.com>');
    assert.deepEqual(body.to, ['ada@example.com']);
    assert.equal(body.reply_to, 'hello@fixer.com');
    assert.match(body.html, /Confirm my email/);
    assert.match(body.text, /https:\/\/example\.test\/verify-email\?token=abc/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Resend errors are surfaced with a code', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ name: 'validation_error', message: 'The fixer.com domain is not verified' }), { status: 403 });
  try {
    await assert.rejects(() => resend.send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }), (e) => e.code === 'validation_error');
  } finally {
    globalThis.fetch = realFetch;
    await pool.end();
  }
});

test('customer-supplied text is escaped in HTML', () => {
  const t = templates.declined({ reference: 'JM-ABC123', status_reason: '<script>x</script>' });
  assert.ok(!t.html.includes('<script>'));
  assert.ok(t.html.includes('&lt;script&gt;'));
});
