const communicationOrchestrator = require('./communicationOrchestrator');
const { buildBrandUrls } = require('../email/emailUrls');

function toLegacySendResult(result) {
  const accepted = Boolean(result.providerAccepted || result.success);
  return {
    success: accepted && !result.blocked,
    providerAccepted: result.providerAccepted,
    blocked: result.blocked,
    status: result.status,
    emailId: result.emailId,
    communicationId: result.communicationId || result.emailId,
    duplicate: result.duplicate,
    error: result.error || result.reason,
    details: result.error || result.details || result.reason,
  };
}

async function scheduleEmailCommunication({
  communicationType,
  recipient,
  payload,
  idempotencyKey,
  correlationId,
  userId,
  language,
  context,
  processImmediately = true,
}) {
  const brand = buildBrandUrls();
  const result = await communicationOrchestrator.schedule({
    communicationType,
    channel: 'email',
    recipient,
    payload: { ...brand, ...payload, language: language || payload?.language || 'en' },
    idempotencyKey,
    correlationId,
    userId,
    processImmediately,
    context,
  });
  return toLegacySendResult(result);
}

module.exports = {
  scheduleEmailCommunication,
  toLegacySendResult,
};
