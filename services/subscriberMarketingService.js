/**
 * Marketing consent SSOT: Mongo `subscribers` (+ sync to communication_preferences).
 * Send-time gate: canSendMarketing(email, category).
 */
const crypto = require('crypto');
const getDBInstance = require('../vornifydb/dbInstance');
const { getDefinition } = require('../email/emailDefinitions');
const { CATEGORY } = require('../email/emailTypes');
const { signUnsubscribeToken } = require('../lib/unsubscribeToken');
const { buildUnsubscribeUrl, buildOneClickUnsubscribeUrl } = require('../email/emailUrls');
const communicationPreferences = require('../communications/communicationPreferences');
const { CHANNEL, PREFERENCE_GROUP, PREFERENCE_STATE } = require('../communications/communicationTypes');

const db = getDBInstance();
const COLLECTION = 'subscribers';

const PREF_KEYS = ['newsletter', 'drops', 'offers', 'cartReminders'];

const EMAIL_TYPE_CATEGORY = {
  NEWSLETTER_WELCOME: 'newsletter',
  NEWSLETTER_CONFIRMATION: 'newsletter',
  MARKETING_CONFIRMATION: 'offers',
  ABANDONED_CART: 'cartReminders',
  ABANDONED_CART_REMINDER: 'cartReminders',
  DROPS_CONFIRMATION: 'drops',
  WAITLIST_CONFIRMATION: 'drops',
  EARLY_ACCESS_CONFIRMATION: 'offers',
  DISCOUNT_REMINDER: 'offers',
  DISCOUNT_CODE_UPDATE: 'offers',
  DISCOUNT_EXPIRY: 'offers',
};

const NEUTRAL_MESSAGE =
  'If this address is on our list, your preferences have been updated.';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function defaultPreferences() {
  return { newsletter: false, drops: false, offers: false, cartReminders: false };
}

function legacyToPreferences(sub) {
  const p = { ...defaultPreferences(), ...(sub?.preferences || {}) };
  if (sub?.wantsNewsletter) p.newsletter = true;
  if (sub?.wantsDrops) p.drops = true;
  if (sub?.wantsMarketing) p.offers = true;
  return p;
}

function preferencesToLegacy(prefs) {
  return {
    wantsNewsletter: Boolean(prefs.newsletter),
    wantsDrops: Boolean(prefs.drops),
    wantsMarketing: Boolean(prefs.offers),
  };
}

function maskEmail(email) {
  const e = normalizeEmail(email);
  const [local, domain] = e.split('@');
  if (!domain) return '***';
  const shown = local.length <= 2 ? `${local[0] || '*'}*` : `${local.slice(0, 2)}***`;
  return `${shown}@${domain}`;
}

async function readSubscriber(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await db.executeOperation({
    database_name: 'peakmode',
    collection_name: COLLECTION,
    command: '--read',
    data: { email: normalized },
  });
  if (!result.success || !result.data) return null;
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return row || null;
}

async function upsertSubscriber(email, patch) {
  const normalized = normalizeEmail(email);
  const existing = await readSubscriber(normalized);
  const now = new Date().toISOString();
  if (!existing) {
    await db.executeOperation({
      database_name: 'peakmode',
      collection_name: COLLECTION,
      command: '--create',
      data: {
        email: normalized,
        name: '',
        unsubscribed: false,
        preferences: defaultPreferences(),
        consentLog: [],
        language: 'en',
        wantsNewsletter: false,
        wantsMarketing: false,
        wantsDrops: false,
        welcomeDiscountSent: false,
        createdAt: now,
        updatedAt: now,
        ...patch,
      },
    });
    return readSubscriber(normalized);
  }
  await db.executeOperation({
    database_name: 'peakmode',
    collection_name: COLLECTION,
    command: '--update',
    data: {
      filter: { email: normalized },
      update: { ...patch, updatedAt: now },
    },
  });
  return readSubscriber(normalized);
}

function appendConsentLog(subscriber, entry) {
  const log = Array.isArray(subscriber.consentLog) ? [...subscriber.consentLog] : [];
  log.push({
    action: entry.action,
    source: entry.source,
    timestamp: entry.timestamp || new Date().toISOString(),
    ip: entry.ip || null,
    detail: entry.detail || null,
  });
  return log.slice(-100);
}

async function syncCommunicationPreferences(email, { marketingDisabled }) {
  const normalized = normalizeEmail(email);
  try {
    if (marketingDisabled) {
      await communicationPreferences.upsertPreferences({
        email: normalized,
        channel: CHANNEL.EMAIL,
        group: PREFERENCE_GROUP.MARKETING,
        state: PREFERENCE_STATE.DISABLED,
      });
    }
  } catch {
    /* non-fatal */
  }
}

async function syncSendGridSuppression(email) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key || !globalThis.fetch) return;
  try {
    await globalThis.fetch('https://api.sendgrid.com/v3/asm/suppressions/global', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_emails: [normalizeEmail(email)] }),
    });
  } catch {
    /* best-effort */
  }
}

function marketingCategoryForEmailType(emailType) {
  if (EMAIL_TYPE_CATEGORY[emailType]) return EMAIL_TYPE_CATEGORY[emailType];
  const def = getDefinition(emailType);
  if (!def || def.category !== CATEGORY.MARKETING) return null;
  return 'offers';
}

/**
 * Send-time check (not enqueue-time).
 */
async function canSendMarketing(email, categoryOrEmailType) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { allowed: false, reason: 'invalid_recipient' };

  let category = categoryOrEmailType;
  if (categoryOrEmailType && getDefinition(categoryOrEmailType)) {
    const mapped = marketingCategoryForEmailType(categoryOrEmailType);
    if (!mapped) return { allowed: true, reason: 'transactional' };
    category = mapped;
  }

  const sub = await readSubscriber(normalized);
  if (!sub) {
    return { allowed: true, reason: 'no_subscriber_record' };
  }
  if (sub.unsubscribed) {
    return { allowed: false, reason: 'global_unsubscribed' };
  }
  const prefs = legacyToPreferences(sub);
  if (category && PREF_KEYS.includes(category) && prefs[category] === false) {
    return { allowed: false, reason: `preference_${category}_off` };
  }
  return { allowed: true, reason: 'allowed' };
}

async function applyUnsubscribeAll({
  email,
  reason,
  source = 'page',
  ip,
}) {
  const normalized = normalizeEmail(email);
  const sub = await readSubscriber(normalized);
  if (!sub) {
    return { ok: true, message: NEUTRAL_MESSAGE };
  }
  const prefs = defaultPreferences();
  const now = new Date().toISOString();
  const consentLog = appendConsentLog(sub, {
    action: 'unsubscribe_all',
    source,
    ip,
    detail: reason || null,
  });

  await upsertSubscriber(normalized, {
    unsubscribed: true,
    unsubscribedAt: now,
    unsubscribeReason: reason || null,
    unsubscribeSource: source,
    preferences: prefs,
    ...preferencesToLegacy(prefs),
    consentLog,
  });

  await syncCommunicationPreferences(normalized, { marketingDisabled: true });
  await syncSendGridSuppression(normalized);

  return { ok: true, message: NEUTRAL_MESSAGE };
}

async function applyPreferenceUpdate({
  email,
  preferences,
  reason,
  source = 'page',
  ip,
}) {
  const normalized = normalizeEmail(email);
  const sub = await readSubscriber(normalized);
  if (!sub) {
    return { ok: true, message: NEUTRAL_MESSAGE };
  }
  const merged = { ...legacyToPreferences(sub), ...preferences };
  for (const k of PREF_KEYS) {
    if (preferences[k] === undefined) continue;
    merged[k] = Boolean(preferences[k]);
  }
  const allOff = PREF_KEYS.every((k) => merged[k] === false);
  const now = new Date().toISOString();
  const consentLog = appendConsentLog(sub, {
    action: allOff ? 'unsubscribe_all' : 'preferences_updated',
    source,
    ip,
    detail: reason || JSON.stringify(preferences),
  });

  const patch = {
    preferences: merged,
    ...preferencesToLegacy(merged),
    consentLog,
    updatedAt: now,
  };
  if (allOff) {
    patch.unsubscribed = true;
    patch.unsubscribedAt = now;
    patch.unsubscribeReason = reason || null;
    patch.unsubscribeSource = source;
  }

  await upsertSubscriber(normalized, patch);
  if (allOff || sub.unsubscribed) {
    await syncCommunicationPreferences(normalized, { marketingDisabled: true });
    if (allOff) await syncSendGridSuppression(normalized);
  }

  return { ok: true, message: NEUTRAL_MESSAGE, preferences: merged };
}

async function applyResubscribe({ email, source = 'page', ip, preferences }) {
  const normalized = normalizeEmail(email);
  const sub = (await readSubscriber(normalized)) || { email: normalized, consentLog: [] };
  const prefs = preferences ? { ...defaultPreferences(), ...preferences } : {
    newsletter: true,
    offers: true,
    drops: false,
    cartReminders: false,
  };
  const consentLog = appendConsentLog(sub, {
    action: 'resubscribe',
    source,
    ip,
  });

  await upsertSubscriber(normalized, {
    unsubscribed: false,
    unsubscribedAt: null,
    unsubscribeReason: null,
    unsubscribeSource: null,
    preferences: prefs,
    ...preferencesToLegacy(prefs),
    consentLog,
  });

  await communicationPreferences.upsertPreferences({
    email: normalized,
    channel: CHANNEL.EMAIL,
    group: PREFERENCE_GROUP.MARKETING,
    state: PREFERENCE_STATE.ENABLED,
  });

  return { ok: true, message: NEUTRAL_MESSAGE };
}

async function applyProviderSuppression({ email, source }) {
  return applyUnsubscribeAll({
    email,
    reason: source,
    source,
  });
}

async function getPreferencesView(email) {
  const normalized = normalizeEmail(email);
  const sub = await readSubscriber(normalized);
  if (!sub) {
    return {
      found: false,
      maskedEmail: null,
      unsubscribed: false,
      preferences: defaultPreferences(),
      verified: false,
    };
  }
  return {
    found: true,
    maskedEmail: maskEmail(normalized),
    unsubscribed: Boolean(sub.unsubscribed),
    preferences: legacyToPreferences(sub),
    language: sub.language || 'en',
    verified: true,
    token: signUnsubscribeToken(normalized),
  };
}

function buildUrlsForSubscriber(email, category) {
  const token = signUnsubscribeToken(email);
  return {
    unsubscribeUrl: buildUnsubscribeUrl({ token, category }),
    oneClickUrl: buildOneClickUnsubscribeUrl({ token }),
    token,
  };
}

module.exports = {
  NEUTRAL_MESSAGE,
  PREF_KEYS,
  normalizeEmail,
  maskEmail,
  readSubscriber,
  legacyToPreferences,
  canSendMarketing,
  marketingCategoryForEmailType,
  applyUnsubscribeAll,
  applyPreferenceUpdate,
  applyResubscribe,
  applyProviderSuppression,
  getPreferencesView,
  buildUrlsForSubscriber,
  signUnsubscribeToken,
};
