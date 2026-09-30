const communicationPolicy = require('./communicationPolicy');
const emailOrchestrator = require('../email/emailOrchestrator');
const notificationService = require('../notifications/notificationService');
const { CHANNEL } = require('./communicationTypes');
const { isProviderAccepted } = require('../email/emailTypes');

/**
 * Schedule a communication (email channel implemented; others reserved).
 */
async function schedule({
  communicationType,
  channel = CHANNEL.EMAIL,
  recipient,
  payload,
  idempotencyKey,
  correlationId,
  userId,
  processImmediately = true,
  context = {},
  inAppNotification,
}) {
  const policy = await communicationPolicy.evaluate({
    communicationType,
    channel,
    recipient,
    userId,
    context,
  });

  if (!policy.allowed) {
    return {
      success: false,
      blocked: true,
      reason: policy.reason,
      providerAccepted: false,
      status: 'BLOCKED_BY_POLICY',
    };
  }

  if (inAppNotification && userId) {
    notificationService.createNotification({
      userId,
      type: communicationType,
      title: inAppNotification.title,
      body: inAppNotification.body,
      deepLink: inAppNotification.deepLink,
      data: inAppNotification.data,
      sourceEvent: correlationId,
      priority: policy.priority,
    }).catch(() => {});
  }

  if (channel !== CHANNEL.EMAIL) {
    return {
      success: false,
      error: 'CHANNEL_NOT_IMPLEMENTED',
      channel,
      providerAccepted: false,
    };
  }

  const result = await emailOrchestrator.scheduleEmail({
    emailType: communicationType,
    recipient,
    payload: { ...payload, language: payload?.language || policy.language },
    idempotencyKey,
    correlationId,
    userId,
    processImmediately,
  });

  return {
    ...result,
    communicationType,
    channel,
    policyReason: policy.reason,
  };
}

function formatAcceptedResult(message, extras = {}) {
  const status = message?.status || 'QUEUED';
  const accepted = isProviderAccepted(status);
  return {
    success: accepted,
    providerAccepted: accepted,
    status,
    communicationId: message?.communicationId || message?.emailId,
    emailId: message?.emailId,
    ...extras,
  };
}

module.exports = {
  schedule,
  formatAcceptedResult,
};
