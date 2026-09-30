/**
 * User communication preferences (channel-aware; email is one channel).
 */
const getDBInstance = require('../vornifydb/dbInstance');
const { PREFERENCE_GROUP, PREFERENCE_STATE, CHANNEL } = require('./communicationTypes');

const db = getDBInstance();
const DB = 'peakmode';
const COLLECTION = 'communication_preferences';

const DEFAULT_CHANNEL_PREFS = {
  [PREFERENCE_GROUP.SECURITY]: PREFERENCE_STATE.REQUIRED,
  [PREFERENCE_GROUP.ORDERS]: PREFERENCE_STATE.ENABLED,
  [PREFERENCE_GROUP.PAYMENTS]: PREFERENCE_STATE.ENABLED,
  [PREFERENCE_GROUP.SHIPPING]: PREFERENCE_STATE.ENABLED,
  [PREFERENCE_GROUP.HUB]: PREFERENCE_STATE.ENABLED,
  [PREFERENCE_GROUP.CHALLENGES]: PREFERENCE_STATE.ENABLED,
  [PREFERENCE_GROUP.ACHIEVEMENTS]: PREFERENCE_STATE.ENABLED,
  [PREFERENCE_GROUP.COMMUNITY]: PREFERENCE_STATE.ENABLED,
  [PREFERENCE_GROUP.DROPS]: PREFERENCE_STATE.ENABLED,
  [PREFERENCE_GROUP.MARKETING]: PREFERENCE_STATE.ENABLED,
};

function normalizeDoc(doc) {
  if (!doc) return null;
  return {
    userId: doc.userId || null,
    email: doc.email ? String(doc.email).trim().toLowerCase() : null,
    channels: doc.channels || {},
    updatedAt: doc.updatedAt,
  };
}

async function findPreferences({ userId, email }) {
  const filter = userId ? { userId } : email ? { email: String(email).trim().toLowerCase() } : null;
  if (!filter) return null;
  const result = await db.executeOperation({
    database_name: DB,
    collection_name: COLLECTION,
    command: '--read',
    data: { filter },
  });
  if (!result.success || !result.data) return null;
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return normalizeDoc(row);
}

function resolvePreferenceState(stored, group, channel) {
  const channelPrefs = stored?.channels?.[channel] || {};
  if (channelPrefs[group]) return channelPrefs[group];
  return DEFAULT_CHANNEL_PREFS[group] || PREFERENCE_STATE.ENABLED;
}

async function isChannelAllowed({ userId, email, preferenceGroup, channel, mandatory }) {
  if (mandatory) {
    return { allowed: true, reason: 'mandatory', state: PREFERENCE_STATE.REQUIRED };
  }
  if (channel === CHANNEL.SMS || channel === CHANNEL.PUSH) {
    return { allowed: false, reason: 'channel_not_implemented', state: PREFERENCE_STATE.NOT_SUPPORTED };
  }
  const stored = await findPreferences({ userId, email });
  const state = resolvePreferenceState(stored, preferenceGroup, channel);
  if (state === PREFERENCE_STATE.DISABLED) {
    return { allowed: false, reason: 'preference_disabled', state };
  }
  return { allowed: true, reason: 'allowed', state };
}

async function upsertPreferences({ userId, email, channel, group, state }) {
  const keyEmail = email ? String(email).trim().toLowerCase() : null;
  const filter = userId ? { userId } : { email: keyEmail };
  const existing = await findPreferences({ userId, email: keyEmail });
  const channels = { ...(existing?.channels || {}) };
  channels[channel] = { ...(channels[channel] || {}), [group]: state };
  const doc = {
    userId: userId || existing?.userId || null,
    email: keyEmail || existing?.email || null,
    channels,
    updatedAt: new Date().toISOString(),
  };
  if (existing) {
    await db.executeOperation({
      database_name: DB,
      collection_name: COLLECTION,
      command: '--update',
      data: { filter, update: doc },
    });
  } else {
    await db.executeOperation({
      database_name: DB,
      collection_name: COLLECTION,
      command: '--create',
      data: { ...doc, createdAt: doc.updatedAt },
    });
  }
  return doc;
}

module.exports = {
  findPreferences,
  isChannelAllowed,
  upsertPreferences,
  DEFAULT_CHANNEL_PREFS,
  COLLECTION,
};
