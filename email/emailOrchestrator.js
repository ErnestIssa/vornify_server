const emailOutbox = require('./emailOutbox');
const emailWorker = require('./emailWorker');
const { STATUS, isProviderAccepted } = require('./emailTypes');
const { emailTypeFromLegacyHubKey } = require('./emailDefinitions');

/**
 * Schedule an email (outbox). Optionally process immediately (still async to SendGrid, not "delivered").
 */
async function scheduleEmail({
  emailType,
  recipient,
  payload,
  idempotencyKey,
  correlationId,
  userId,
  processImmediately = true,
}) {
  const enqueued = await emailOutbox.enqueue({
    emailType,
    recipient,
    payload,
    idempotencyKey,
    correlationId,
    userId,
  });

  if (!enqueued.ok) {
    return {
      success: false,
      queued: false,
      error: enqueued.error,
      details: enqueued.details,
    };
  }

  if (enqueued.duplicate) {
    return formatResult(enqueued.message, { duplicate: true });
  }

  if (!processImmediately) {
    return formatResult(enqueued.message, { duplicate: false });
  }

  const processed = await emailWorker.processMessageById(enqueued.emailId);
  const refreshed = processed.emailId
    ? await require('./emailStore').findById(processed.emailId)
    : enqueued.message;

  return formatResult(refreshed || enqueued.message, {
    duplicate: false,
    processError: processed.ok ? null : processed.lastError || processed.error,
  });
}

function formatResult(message, { duplicate, processError } = {}) {
  const status = message?.status || STATUS.QUEUED;
  const accepted = isProviderAccepted(status);
  return {
    success: accepted,
    queued: status === STATUS.QUEUED || status === STATUS.DEFERRED || status === STATUS.PROCESSING,
    duplicate: Boolean(duplicate),
    emailId: message?.emailId,
    status,
    providerMessageId: message?.providerMessageId || null,
    providerAccepted: accepted,
    error: processError || (accepted ? null : message?.lastError),
  };
}

async function scheduleLegacyHubEmail({
  legacyHubKey,
  recipient,
  payload,
  idempotencyKey,
  correlationId,
  userId,
  processImmediately = true,
}) {
  const emailType = emailTypeFromLegacyHubKey(legacyHubKey);
  if (!emailType) {
    return { success: false, error: 'UNKNOWN_LEGACY_HUB_EMAIL', legacyHubKey };
  }
  return scheduleEmail({
    emailType,
    recipient,
    payload,
    idempotencyKey,
    correlationId,
    userId,
    processImmediately,
  });
}

module.exports = {
  scheduleEmail,
  scheduleLegacyHubEmail,
};
