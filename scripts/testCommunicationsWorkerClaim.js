/**
 * Worker claim: inline processMessageById must not double-deliver when already ACCEPTED.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const assert = require('assert');
const emailOrchestrator = require('../email/emailOrchestrator');
const emailWorker = require('../email/emailWorker');
const emailStore = require('../email/emailStore');
const { STATUS } = require('../email/emailTypes');

const provider = require('../email/sendgridProvider');
let sendCount = 0;
const originalDynamic = provider.sendDynamicTemplate;
provider.sendDynamicTemplate = async () => {
  sendCount += 1;
  return {
    ok: true,
    accepted: true,
    providerMessageId: `mock-claim-${sendCount}`,
    statusCode: 202,
  };
};

async function run() {
  const recipient = `claim-test+${Date.now()}@example.com`;
  const scheduled = await emailOrchestrator.scheduleEmail({
    emailType: 'SUPPORT_CONFIRMATION',
    recipient,
    payload: { customer_name: 'Claim', ticket_id: 'CL-1' },
    idempotencyKey: `test-claim:${Date.now()}`,
    processImmediately: true,
  });

  if (!scheduled.emailId && scheduled.error === 'OUTBOX_WRITE_FAILED') {
    console.log('⏭️ testCommunicationsWorkerClaim skipped (MongoDB unavailable)');
    provider.sendDynamicTemplate = originalDynamic;
    return;
  }

  assert.strictEqual(sendCount, 1, 'first delivery');
  const msg = await emailStore.findById(scheduled.emailId);
  assert.strictEqual(msg.status, STATUS.ACCEPTED);

  const retry = await emailWorker.processMessageById(scheduled.emailId);
  assert.strictEqual(retry.skipped, true, 'no second claim on terminal-ish state');
  assert.strictEqual(sendCount, 1, 'provider not called again');

  provider.sendDynamicTemplate = originalDynamic;
  console.log('✅ testCommunicationsWorkerClaim passed');
  process.exit(0);
}

run().catch((err) => {
  if (String(err.message || err).includes('ECONNREFUSED') || String(err).includes('Mongo')) {
    console.log('⏭️ testCommunicationsWorkerClaim skipped (MongoDB unavailable)');
    process.exit(0);
  }
  console.error('❌ testCommunicationsWorkerClaim failed', err);
  process.exit(1);
});
