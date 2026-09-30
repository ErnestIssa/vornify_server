const crypto = require('crypto');
const communicationOrchestrator = require('./communicationOrchestrator');
const notificationService = require('../notifications/notificationService');
const {
  DEFAULT_COMMUNICATION_BY_EVENT,
  buildHubEventIdempotencyKey,
} = require('./hubDomainEvents');

function newEventId() {
  return `evt_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Emit a Hub domain event → notification intent → policy → channels.
 * Email is optional per event mapping; in-app can be added via inAppNotification without email types.
 *
 * @param {import('./hubDomainEvents').HubDomainEvent & {
 *   recipientEmail?: string,
 *   emailPayload?: Record<string, unknown>,
 *   inAppNotification?: { title: string, body: string, deepLink?: string, data?: object },
 *   communicationType?: string,
 *   processImmediately?: boolean,
 * }} event
 */
async function dispatchHubDomainEvent(event) {
  const eventType = event.eventType;
  const eventId = event.eventId || newEventId();
  const idempotencyKey =
    event.idempotencyKey ||
    buildHubEventIdempotencyKey(eventType, [event.memberId, eventId]);
  const correlationId = event.correlationId || eventId;

  const communicationType =
    event.communicationType || DEFAULT_COMMUNICATION_BY_EVENT[eventType] || null;

  const results = {
    eventId,
    idempotencyKey,
    correlationId,
    eventType,
    channels: [],
  };

  if (communicationType && event.recipientEmail) {
    const emailResult = await communicationOrchestrator.schedule({
      communicationType,
      channel: 'email',
      recipient: event.recipientEmail,
      payload: { ...(event.emailPayload || {}), ...(event.payload || {}) },
      idempotencyKey: `${idempotencyKey}:email`,
      correlationId,
      userId: event.memberId,
      processImmediately: event.processImmediately !== false,
      context: event.context || {},
      inAppNotification: event.inAppNotification,
    });
    results.channels.push({ channel: 'email', ...emailResult });
  } else if (event.inAppNotification && event.memberId) {
    const note = await notificationService.createNotification({
      userId: event.memberId,
      type: eventType,
      title: event.inAppNotification.title,
      body: event.inAppNotification.body,
      deepLink: event.inAppNotification.deepLink,
      data: { ...event.inAppNotification.data, idempotencyKey, correlationId },
      sourceEvent: correlationId,
    });
    results.channels.push({ channel: 'in_app', success: Boolean(note), notificationId: note?.id });
  }

  return results;
}

const { HUB_DOMAIN_EVENTS } = require('./hubDomainEvents');

module.exports = {
  dispatchHubDomainEvent,
  HUB_DOMAIN_EVENTS,
};
