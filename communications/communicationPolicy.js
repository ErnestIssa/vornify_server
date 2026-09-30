const { CHANNEL, CATEGORY } = require('./communicationTypes');
const { getCommunicationDefinition } = require('./communicationDefinitions');
const communicationPreferences = require('./communicationPreferences');

/**
 * Central policy: should this communication be sent on this channel?
 */
async function evaluate({
  communicationType,
  channel = CHANNEL.EMAIL,
  recipient,
  userId,
  context = {},
}) {
  const def = getCommunicationDefinition(communicationType);
  if (!def) {
    return { allowed: false, reason: 'unknown_communication_type', transactional: false };
  }

  if (!def.supportedChannels.includes(channel)) {
    return { allowed: false, reason: 'unsupported_channel', transactional: def.transactional };
  }

  if (def.transactional || def.mandatory || def.category === CATEGORY.TRANSACTIONAL) {
    return {
      allowed: true,
      reason: 'transactional',
      transactional: true,
      preferenceGroup: def.preferenceGroup,
      language: context.language || 'en',
      priority: def.priority,
    };
  }

  const pref = await communicationPreferences.isChannelAllowed({
    userId,
    email: recipient,
    preferenceGroup: def.preferenceGroup,
    channel,
    mandatory: false,
  });

  if (!pref.allowed) {
    return {
      allowed: false,
      reason: pref.reason,
      transactional: false,
      preferenceGroup: def.preferenceGroup,
      preferenceState: pref.state,
    };
  }

  if (context.marketingConsent === false && def.category === CATEGORY.MARKETING) {
    return { allowed: false, reason: 'marketing_consent_missing', transactional: false };
  }

  return {
    allowed: true,
    reason: 'marketing_allowed',
    transactional: false,
    preferenceGroup: def.preferenceGroup,
    language: context.language || 'en',
    priority: def.priority,
  };
}

module.exports = { evaluate };
