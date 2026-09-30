/**
 * Communication registry metadata (internal keys → policy, preferences, channels).
 * Template/subject SSOT remains in email/emailDefinitions.js for the email channel.
 */
const { EMAIL_TYPES, getDefinition, resolveProviderTemplateId, resolveSubjectForJob, listDefinitionsForDiagnostics } =
  require('../email/emailDefinitions');
const { CATEGORY } = require('./communicationTypes');
const { DOMAIN_CATEGORY, PREFERENCE_GROUP, AGGREGATION_POLICY } = require('./communicationTypes');

const TYPE_META = {
  HUB_VERIFY_EMAIL: { domain: DOMAIN_CATEGORY.SECURITY, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_PASSWORD_RESET: { domain: DOMAIN_CATEGORY.SECURITY, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_PASSWORD_RESET_SUCCESS: { domain: DOMAIN_CATEGORY.ACCOUNT, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_PASSWORD_CHANGED: { domain: DOMAIN_CATEGORY.SECURITY, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_NEW_LOGIN: { domain: DOMAIN_CATEGORY.SECURITY, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_SUSPICIOUS_LOGIN: { domain: DOMAIN_CATEGORY.SECURITY, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_LOGIN_BLOCKED: { domain: DOMAIN_CATEGORY.SECURITY, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_EMAIL_CHANGE_CONFIRM: { domain: DOMAIN_CATEGORY.SECURITY, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_EMAIL_CHANGED: { domain: DOMAIN_CATEGORY.ACCOUNT, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_MFA_ENABLED: { domain: DOMAIN_CATEGORY.SECURITY, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_MFA_DISABLED: { domain: DOMAIN_CATEGORY.SECURITY, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_ACCOUNT_RECOVERY: { domain: DOMAIN_CATEGORY.SECURITY, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_ACCOUNT_DELETED: { domain: DOMAIN_CATEGORY.ACCOUNT, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_WELCOME_REGISTRATION: { domain: DOMAIN_CATEGORY.HUB, preferenceGroup: PREFERENCE_GROUP.HUB, mandatory: false },
  HUB_WELCOME_POST_VERIFY: { domain: DOMAIN_CATEGORY.HUB, preferenceGroup: PREFERENCE_GROUP.HUB, mandatory: false },
  HUB_GOOGLE_CONNECTED: { domain: DOMAIN_CATEGORY.ACCOUNT, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  HUB_GOOGLE_DISCONNECTED: { domain: DOMAIN_CATEGORY.ACCOUNT, preferenceGroup: PREFERENCE_GROUP.SECURITY, mandatory: true },
  ORDER_CONFIRMATION: { domain: DOMAIN_CATEGORY.ORDERS, preferenceGroup: PREFERENCE_GROUP.ORDERS, mandatory: true },
  ORDER_PROCESSING: { domain: DOMAIN_CATEGORY.ORDERS, preferenceGroup: PREFERENCE_GROUP.ORDERS, mandatory: true },
  SHIPMENT_DISPATCHED: { domain: DOMAIN_CATEGORY.SHIPPING, preferenceGroup: PREFERENCE_GROUP.SHIPPING, mandatory: true },
  SHIPMENT_DELIVERED: { domain: DOMAIN_CATEGORY.SHIPPING, preferenceGroup: PREFERENCE_GROUP.SHIPPING, mandatory: true },
  PAYMENT_FAILED: { domain: DOMAIN_CATEGORY.PAYMENTS, preferenceGroup: PREFERENCE_GROUP.PAYMENTS, mandatory: true },
  REVIEW_REQUEST: { domain: DOMAIN_CATEGORY.ORDERS, preferenceGroup: PREFERENCE_GROUP.ORDERS, mandatory: false },
  NEWSLETTER_WELCOME: { domain: DOMAIN_CATEGORY.MARKETING, preferenceGroup: PREFERENCE_GROUP.MARKETING, mandatory: false },
  NEWSLETTER_CONFIRMATION: { domain: DOMAIN_CATEGORY.MARKETING, preferenceGroup: PREFERENCE_GROUP.MARKETING, mandatory: false },
  MARKETING_CONFIRMATION: { domain: DOMAIN_CATEGORY.MARKETING, preferenceGroup: PREFERENCE_GROUP.MARKETING, mandatory: false },
  ABANDONED_CART: { domain: DOMAIN_CATEGORY.MARKETING, preferenceGroup: PREFERENCE_GROUP.MARKETING, mandatory: false },
  ABANDONED_CART_REMINDER: { domain: DOMAIN_CATEGORY.MARKETING, preferenceGroup: PREFERENCE_GROUP.MARKETING, mandatory: false },
  SUPPORT_CONFIRMATION: { domain: DOMAIN_CATEGORY.TRANSACTIONAL, preferenceGroup: PREFERENCE_GROUP.ORDERS, mandatory: true },
  WAITLIST_CONFIRMATION: { domain: DOMAIN_CATEGORY.MARKETING, preferenceGroup: PREFERENCE_GROUP.MARKETING, mandatory: false },
  DROPS_CONFIRMATION: { domain: DOMAIN_CATEGORY.DROPS, preferenceGroup: PREFERENCE_GROUP.DROPS, mandatory: false },
};

function getCommunicationDefinition(communicationType) {
  const base = getDefinition(communicationType);
  if (!base) return null;
  const meta = TYPE_META[communicationType] || {
    domain: base.category === CATEGORY.MARKETING ? DOMAIN_CATEGORY.MARKETING : DOMAIN_CATEGORY.TRANSACTIONAL,
    preferenceGroup: PREFERENCE_GROUP.ORDERS,
    mandatory: base.category === CATEGORY.TRANSACTIONAL,
  };
  return {
    key: communicationType,
    ...base,
    domainCategory: meta.domain,
    preferenceGroup: meta.preferenceGroup,
    mandatory: meta.mandatory,
    transactional: base.category === CATEGORY.TRANSACTIONAL || meta.mandatory,
    supportedChannels: ['email'],
    aggregationPolicy: AGGREGATION_POLICY.IMMEDIATE,
  };
}

function listCommunicationDefinitionsForDiagnostics() {
  const emailDefs = listDefinitionsForDiagnostics();
  const out = {};
  for (const key of Object.keys(EMAIL_TYPES)) {
    const def = getCommunicationDefinition(key);
    out[key] = {
      ...emailDefs[key],
      domainCategory: def.domainCategory,
      preferenceGroup: def.preferenceGroup,
      transactional: def.transactional,
      supportedChannels: def.supportedChannels,
    };
  }
  return out;
}

module.exports = {
  getCommunicationDefinition,
  listCommunicationDefinitionsForDiagnostics,
  resolveProviderTemplateId,
  resolveSubjectForJob,
  EMAIL_TYPES,
};
