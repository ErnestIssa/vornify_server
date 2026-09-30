/**
 * SendGrid webhook signature verification (no network).
 */
const assert = require('assert');
const crypto = require('crypto');
const { verifySendGridWebhook } = require('../lib/sendgridWebhookVerify');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});

function signPayload(rawBody, timestamp) {
  const verifier = crypto.createSign('SHA256');
  verifier.update(String(timestamp) + rawBody);
  verifier.end();
  return verifier.sign(privateKey).toString('base64');
}

const pemPublic = publicKey.export({ type: 'spki', format: 'pem' });
const body = Buffer.from(JSON.stringify([{ event: 'delivered', sg_message_id: 'abc' }]), 'utf8');
const ts = Math.floor(Date.now() / 1000).toString();
const sig = signPayload(body, ts);

process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY = pemPublic;

const ok = verifySendGridWebhook({ rawBody: body, signature: sig, timestamp: ts });
assert.strictEqual(ok.ok, true, 'valid signature');

const bad = verifySendGridWebhook({ rawBody: body, signature: sig, timestamp: ts, });
assert.strictEqual(bad.ok, true);

const tampered = verifySendGridWebhook({
  rawBody: Buffer.from('[]', 'utf8'),
  signature: sig,
  timestamp: ts,
});
assert.strictEqual(tampered.ok, false, 'tampered body fails');

const missing = verifySendGridWebhook({ rawBody: body, signature: null, timestamp: ts });
assert.strictEqual(missing.ok, false);

console.log('✅ testSendGridWebhookVerify passed');
process.exit(0);
