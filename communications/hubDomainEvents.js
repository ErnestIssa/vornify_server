/**
 * Canonical Hub domain events (contract only — producers/consumers wire here over time).
 * Hub domain code must not import SendGrid or email providers.
 */

const HUB_DOMAIN_EVENTS = {
  CHALLENGE_COMPLETED: 'challenge.completed',
  ACHIEVEMENT_UNLOCKED: 'achievement.unlocked',
  DROP_UNLOCKED: 'drop.unlocked',
  COMMUNITY_MENTIONED: 'community.mentioned',
  SECURITY_LOGIN: 'security.login',
  SECURITY_SUSPICIOUS_LOGIN: 'security.suspicious_login',
  SECURITY_LOGIN_BLOCKED: 'security.login_blocked',
  MEMBER_WELCOME: 'member.welcome',
};

/**
 * @typedef {object} HubDomainEvent
 * @property {string} eventType - One of HUB_DOMAIN_EVENTS values
 * @property {string} eventId - Stable unique id for this occurrence (UUID or deterministic hash)
 * @property {string} memberId - Hub member / user id
 * @property {string} occurredAt - ISO timestamp
 * @property {string} idempotencyKey - Dedupe key for notification + communication scheduling
 * @property {string} [correlationId] - Trace id (request, session, or business action)
 * @property {Record<string, unknown>} payload - Event-specific data (no provider fields)
 */

/**
 * Build a stable idempotency key from event type + business identifiers.
 */
function buildHubEventIdempotencyKey(eventType, parts) {
  const crypto = require('crypto');
  const raw = [eventType, ...(parts || [])].map((p) => String(p)).join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

/**
 * Map domain events to default communication types (email channel today; policy may add in-app only).
 */
const DEFAULT_COMMUNICATION_BY_EVENT = {
  [HUB_DOMAIN_EVENTS.CHALLENGE_COMPLETED]: null,
  [HUB_DOMAIN_EVENTS.ACHIEVEMENT_UNLOCKED]: null,
  [HUB_DOMAIN_EVENTS.DROP_UNLOCKED]: null,
  [HUB_DOMAIN_EVENTS.COMMUNITY_MENTIONED]: null,
  [HUB_DOMAIN_EVENTS.SECURITY_LOGIN]: 'HUB_NEW_LOGIN',
  [HUB_DOMAIN_EVENTS.SECURITY_SUSPICIOUS_LOGIN]: 'HUB_SUSPICIOUS_LOGIN',
  [HUB_DOMAIN_EVENTS.SECURITY_LOGIN_BLOCKED]: 'HUB_LOGIN_BLOCKED',
  [HUB_DOMAIN_EVENTS.MEMBER_WELCOME]: 'HUB_WELCOME_REGISTRATION',
};

module.exports = {
  HUB_DOMAIN_EVENTS,
  DEFAULT_COMMUNICATION_BY_EVENT,
  buildHubEventIdempotencyKey,
};
