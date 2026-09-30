/**
 * Integration-style tests (in-process, no MongoDB / SendGrid network).
 */
const assert = require('assert');
const { shouldApplyStatus } = require('../email/emailEvents');

assert.strictEqual(shouldApplyStatus('DELIVERED', 'DEFERRED'), false);
assert.strictEqual(shouldApplyStatus('ACCEPTED', 'DELIVERED'), true);
assert.strictEqual(shouldApplyStatus('BOUNCED', 'DELIVERED'), false);

const provider = require('../email/sendgridProvider');
const originalDynamic = provider.sendDynamicTemplate;
const originalHtml = provider.sendHtmlEmail;

provider.sendDynamicTemplate = async () => ({
  ok: false,
  error: '503',
  retryable: true,
  statusCode: 503,
});
provider.sendHtmlEmail = async () => ({
  ok: true,
  accepted: true,
  providerMessageId: 'mock-html',
  statusCode: 202,
});

(async () => {
  const { deliverEmailMessage } = require('../email/emailDelivery');
  const retryResult = await deliverEmailMessage({
    emailType: 'SUPPORT_CONFIRMATION',
    recipient: 'a@example.com',
    subject: 'Support',
    providerTemplateId: 'd-test-configured',
    payload: { customer_name: 'A', ticket_id: '1' },
  });
  assert.strictEqual(retryResult.ok, false);
  assert.strictEqual(retryResult.retryable, true);

  const htmlResult = await deliverEmailMessage({
    emailType: 'ORDER_RECEIPT',
    recipient: 'a@example.com',
    subject: 'Receipt',
    deliveryMode: 'html',
    payload: {
      customer_name: 'A',
      order_number: '1',
      html: '<p>Receipt</p>',
    },
  });
  assert.strictEqual(htmlResult.ok, true);
  assert.strictEqual(htmlResult.accepted, true);

  provider.sendDynamicTemplate = originalDynamic;
  provider.sendHtmlEmail = originalHtml;
  console.log('✅ testCommunicationsIntegration passed');
  process.exit(0);
})().catch((err) => {
  console.error('❌ testCommunicationsIntegration failed', err);
  process.exit(1);
});
