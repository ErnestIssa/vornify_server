require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { signUnsubscribeToken, verifyUnsubscribeToken } = require('../lib/unsubscribeToken');
const { canSendMarketing, marketingCategoryForEmailType } = require('../services/subscriberMarketingService');
const { getDefinition } = require('../email/emailDefinitions');

const email = 'gate-test@example.com';
const token = signUnsubscribeToken(email);
const v = verifyUnsubscribeToken(token);
assert.strictEqual(v.ok, true);
assert.strictEqual(v.email, email);

assert.strictEqual(marketingCategoryForEmailType('NEWSLETTER_WELCOME'), 'newsletter');
assert.strictEqual(marketingCategoryForEmailType('ORDER_CONFIRMATION'), null);

(async () => {
  const tx = await canSendMarketing('nobody@example.com', 'ORDER_CONFIRMATION');
  assert.strictEqual(tx.allowed, true);
  assert.strictEqual(tx.reason, 'transactional');

  const mkt = await canSendMarketing('nobody@example.com', 'NEWSLETTER_WELCOME');
  assert.strictEqual(mkt.allowed, true);
  assert.strictEqual(mkt.reason, 'no_subscriber_record');

  console.log('✅ testSubscriberMarketing passed');
  process.exit(0);
})().catch((err) => {
  console.error('❌ testSubscriberMarketing failed', err);
  process.exit(1);
});
