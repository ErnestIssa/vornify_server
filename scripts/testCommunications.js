/**
 * Communications platform unit checks (no SendGrid network required for validation paths).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const assert = require('assert');
const { validateEmailJob } = require('../email/emailValidator');
const { buildOrderStatusUrl, buildCheckoutUrl } = require('../email/emailUrls');
const { previewCommunicationType } = require('../email/templatePreview');
const communicationPolicy = require('../communications/communicationPolicy');
const { getCommunicationDefinition } = require('../communications/communicationDefinitions');

async function run() {
  const orderUrl = buildOrderStatusUrl({ orderId: 'PM-1' });
  const v1 = validateEmailJob({
    emailType: 'ORDER_CONFIRMATION',
    recipient: 'a@example.com',
    payload: {
      customer_name: 'A',
      order_number: 'PM-1',
      order_status_url: orderUrl,
      language: 'en',
    },
  });
  assert.strictEqual(v1.valid, true, 'order confirmation valid');

  const v2 = validateEmailJob({
    emailType: 'PAYMENT_FAILED',
    recipient: 'a@example.com',
    payload: {
      customer_name: 'A',
      order_number: 'PM-1',
      retry_url: buildCheckoutUrl({}),
    },
  });
  assert.strictEqual(v2.valid, true, 'payment failed valid');

  const preview = previewCommunicationType('HUB_VERIFY_EMAIL');
  assert.strictEqual(preview.ok, true, 'hub verify preview');
  const httpLinks = preview.links.filter((l) => String(l.value).startsWith('http'));
  assert.ok(httpLinks.length > 0, 'preview has http links');
  assert.ok(httpLinks.every((l) => l.valid), 'preview https links valid');

  const hubDef = getCommunicationDefinition('HUB_VERIFY_EMAIL');
  assert.strictEqual(hubDef.mandatory, true);

  const policyTx = await communicationPolicy.evaluate({
    communicationType: 'HUB_VERIFY_EMAIL',
    channel: 'email',
    recipient: 'a@example.com',
  });
  assert.strictEqual(policyTx.allowed, true);

  const policyMkt = await communicationPolicy.evaluate({
    communicationType: 'NEWSLETTER_WELCOME',
    channel: 'email',
    recipient: 'a@example.com',
    context: { marketingConsent: false },
  });
  assert.strictEqual(policyMkt.allowed, false);

  console.log('✅ testCommunications passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ testCommunications failed', err);
  process.exit(1);
});
