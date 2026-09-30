const { getDefinition } = require('./emailDefinitions');
const { validateEmailJob } = require('./emailValidator');
const emailStore = require('./emailStore');
const emailOutbox = require('./emailOutbox');
const { deliverEmailMessage } = require('./emailDelivery');
const { STATUS } = require('./emailTypes');
const { buildDynamicPayload } = require('./payloadBuilder');

async function processMessageById(emailId) {
  const claimed = await emailStore.tryClaimMessageById(emailId);
  if (!claimed) {
    const existing = await emailStore.findById(emailId);
    if (!existing) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, skipped: true, status: existing.status, emailId: existing.emailId };
  }
  const out = await processMessage(claimed, { alreadyClaimed: true });
  return { ...out, emailId: claimed.emailId };
}

async function processMessage(msg, options = {}) {
  const def = getDefinition(msg.emailType);
  if (!def) {
    await emailStore.updateMessage(msg.emailId, {
      status: STATUS.FAILED,
      lastError: 'UNKNOWN_EMAIL_TYPE',
    });
    return { ok: false, error: 'UNKNOWN_EMAIL_TYPE' };
  }

  const validation = validateEmailJob({
    emailType: msg.emailType,
    recipient: msg.recipient,
    payload: msg.payload,
  });
  if (!validation.valid) {
    await emailStore.updateMessage(msg.emailId, {
      status: STATUS.FAILED,
      lastError: validation.error,
    });
    return { ok: false, error: validation.error };
  }

  const attempts = (msg.attempts || 0) + 1;
  if (!options.alreadyClaimed) {
    await emailStore.updateMessage(msg.emailId, {
      status: STATUS.PROCESSING,
      attempts,
      processingAt: new Date().toISOString(),
    });
  } else {
    await emailStore.updateMessage(msg.emailId, { attempts });
  }

  const { canSendMarketing } = require('../services/subscriberMarketingService');
  const gate = await canSendMarketing(msg.recipient, msg.emailType);
  if (!gate.allowed && gate.reason !== 'transactional') {
    const now = new Date().toISOString();
    await emailStore.updateMessage(msg.emailId, {
      status: STATUS.CANCELLED,
      lastError: gate.reason,
      claimExpiresAt: null,
      claimWorkerId: null,
      cancelledAt: now,
    });
    await emailStore.appendEvent(msg.emailId, { type: STATUS.CANCELLED, reason: gate.reason });
    return { ok: true, skipped: true, status: STATUS.CANCELLED, reason: gate.reason };
  }

  const result = await deliverEmailMessage(msg);

  const now = new Date().toISOString();

  if (result.ok && result.accepted) {
    await emailStore.updateMessage(msg.emailId, {
      status: STATUS.ACCEPTED,
      providerMessageId: result.providerMessageId,
      sentAt: now,
      lastError: null,
      claimExpiresAt: null,
      claimWorkerId: null,
    });
    await emailStore.appendEvent(msg.emailId, {
      type: STATUS.ACCEPTED,
      providerMessageId: result.providerMessageId,
    });
    return {
      ok: true,
      status: STATUS.ACCEPTED,
      providerMessageId: result.providerMessageId,
      emailId: msg.emailId,
    };
  }

  const lastError = result.error || 'SEND_FAILED';
  if (result.retryable && attempts < (msg.maxAttempts || emailOutbox.MAX_ATTEMPTS)) {
    await emailStore.updateMessage(msg.emailId, {
      status: STATUS.DEFERRED,
      scheduledAt: emailOutbox.nextRetryAt(attempts),
      lastError,
    });
    await emailStore.appendEvent(msg.emailId, { type: STATUS.DEFERRED, lastError });
    return { ok: false, status: STATUS.DEFERRED, retry: true, lastError };
  }

  const terminal = attempts >= (msg.maxAttempts || emailOutbox.MAX_ATTEMPTS) ? STATUS.DEAD_LETTER : STATUS.FAILED;
  await emailStore.updateMessage(msg.emailId, {
    status: terminal,
    lastError,
  });
  await emailStore.appendEvent(msg.emailId, { type: terminal, lastError });
  return { ok: false, status: terminal, lastError };
}

async function processPendingBatch(limit = 20) {
  const results = [];
  for (let i = 0; i < limit; i += 1) {
    const msg = await emailStore.claimNextPending();
    if (!msg) break;
    results.push(await processMessage(msg, { alreadyClaimed: true }));
  }
  return results;
}

module.exports = {
  processMessageById,
  processPendingBatch,
  buildDynamicPayload,
};
