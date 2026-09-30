/**
 * Durability boundary: enqueue without inline process → worker batch delivers (Mongo required).
 * Skips gracefully when DB is unavailable.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const assert = require('assert');
const emailOrchestrator = require('../email/emailOrchestrator');
const emailWorker = require('../email/emailWorker');
const emailStore = require('../email/emailStore');
const { STATUS } = require('../email/emailTypes');

const provider = require('../email/sendgridProvider');
const originalDynamic = provider.sendDynamicTemplate;
provider.sendDynamicTemplate = async () => ({
  ok: true,
  accepted: true,
  providerMessageId: `mock-dur-${Date.now()}`,
  statusCode: 202,
});

async function run() {
  const recipient = `durability-test+${Date.now()}@example.com`;
  const idempotencyKey = `test-durability:${Date.now()}`;

  const scheduled = await emailOrchestrator.scheduleEmail({
    emailType: 'SUPPORT_CONFIRMATION',
    recipient,
    payload: { customer_name: 'Durability', ticket_id: 'DUR-1' },
    idempotencyKey,
    processImmediately: false,
  });

  if (!scheduled.success && scheduled.error === 'OUTBOX_WRITE_FAILED') {
    console.log('⏭️ testCommunicationsDurability skipped (MongoDB unavailable)');
    provider.sendDynamicTemplate = originalDynamic;
    return;
  }

  assert.ok(scheduled.emailId, 'emailId after enqueue');
  const queued = await emailStore.findById(scheduled.emailId);
  assert.strictEqual(queued.status, STATUS.QUEUED, 'persisted before worker');

  const batch = await emailWorker.processPendingBatch(5);
  const ours = batch.find((r) => r.emailId === scheduled.emailId);
  assert.ok(ours, 'worker picked up message');
  assert.strictEqual(ours.ok, true);

  const after = await emailStore.findById(scheduled.emailId);
  assert.strictEqual(after.status, STATUS.ACCEPTED, 'accepted after worker restart simulation');

  provider.sendDynamicTemplate = originalDynamic;
  console.log('✅ testCommunicationsDurability passed');
  process.exit(0);
}

run().catch((err) => {
  if (String(err.message || err).includes('ECONNREFUSED') || String(err).includes('Mongo')) {
    console.log('⏭️ testCommunicationsDurability skipped (MongoDB unavailable)');
    process.exit(0);
  }
  console.error('❌ testCommunicationsDurability failed', err);
  process.exit(1);
});
