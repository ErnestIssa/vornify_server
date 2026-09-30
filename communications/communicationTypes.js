/**
 * Channel-agnostic communication types (email is first channel).
 */
const emailTypes = require('../email/emailTypes');

const CHANNEL = {
  EMAIL: 'email',
  SMS: 'sms',
  PUSH: 'push',
  IN_APP: 'in_app',
};

const DOMAIN_CATEGORY = {
  SECURITY: 'SECURITY',
  TRANSACTIONAL: 'TRANSACTIONAL',
  ACCOUNT: 'ACCOUNT',
  ORDERS: 'ORDERS',
  PAYMENTS: 'PAYMENTS',
  SHIPPING: 'SHIPPING',
  HUB: 'HUB',
  COMMUNITY: 'COMMUNITY',
  CHALLENGES: 'CHALLENGES',
  DROPS: 'DROPS',
  MARKETING: 'MARKETING',
  SYSTEM: 'SYSTEM',
};

const PREFERENCE_GROUP = {
  SECURITY: 'security',
  ORDERS: 'orders',
  PAYMENTS: 'payments',
  SHIPPING: 'shipping',
  HUB: 'hub',
  CHALLENGES: 'challenges',
  ACHIEVEMENTS: 'achievements',
  COMMUNITY: 'community',
  DROPS: 'drops',
  MARKETING: 'marketing',
};

const PREFERENCE_STATE = {
  REQUIRED: 'required',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  NOT_SUPPORTED: 'not_supported',
};

const AGGREGATION_POLICY = {
  IMMEDIATE: 'immediate',
  BATCHED: 'batched',
  DAILY_DIGEST: 'daily_digest',
  WEEKLY_DIGEST: 'weekly_digest',
  NEVER: 'never',
};

const STATUS = {
  ...emailTypes.STATUS,
  CANCELLED: 'CANCELLED',
};

module.exports = {
  CHANNEL,
  DOMAIN_CATEGORY,
  PREFERENCE_GROUP,
  PREFERENCE_STATE,
  AGGREGATION_POLICY,
  STATUS,
  CATEGORY: emailTypes.CATEGORY,
  PRIORITY: emailTypes.PRIORITY,
  TERMINAL_STATUSES: emailTypes.TERMINAL_STATUSES,
  isProviderAccepted: emailTypes.isProviderAccepted,
};
