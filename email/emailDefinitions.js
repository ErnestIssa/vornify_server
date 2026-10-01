/**
 * Internal email types (SSOT). Business code uses EMAIL_TYPES.* — not raw SendGrid IDs.
 */
const { CATEGORY, PRIORITY } = require('./emailTypes');

function pickEnv(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    const v = process.env[key];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

function isPlaceholderTemplateId(id) {
  const s = String(id || '').trim();
  if (!s) return true;
  return s.startsWith('d-') && s.includes('template_id');
}

const EMAIL_TYPES = {
  HUB_WELCOME_REGISTRATION: {
    subject: 'Welcome to Peak Mode',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_WELCOME', 'HUB_WELCOME_EMAIL', 'SENDGRID_ACCOUNT_SETUP_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'accountWelcome',
  },
  HUB_VERIFY_EMAIL: {
    subject: 'Verify your Peak Mode account',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.CRITICAL,
    bypassListManagement: true,
    templateEnvKeys: ['EMAIL_VERIFICATION_HUB_ACCOUNT', 'SENDGRID_EMAIL_VERIFICATION_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'verificationUrl'],
    urlFields: ['verificationUrl'],
    legacyHubKey: 'emailVerification',
  },
  HUB_PASSWORD_RESET: {
    subject: 'Reset your Peak Mode password',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.CRITICAL,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_PASSWORD_RESET', 'SENDGRID_PASSWORD_RESET_TEMPLATE_ID'],
    requiredFields: ['resetUrl'],
    urlFields: ['resetUrl'],
    legacyHubKey: 'passwordReset',
  },
  HUB_PASSWORD_RESET_SUCCESS: {
    subject: 'Your Peak Mode password was reset',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_PASSWORD_RESET_SUCCESS', 'SENDGRID_PASSWORD_RESET_SUCCESS_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'passwordResetSuccess',
  },
  HUB_PASSWORD_CHANGED: {
    subject: 'Your Peak Mode password was changed',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.CRITICAL,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_PASSWORD_CHANGED'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'passwordChanged',
  },
  HUB_NEW_LOGIN: {
    subject: 'New sign-in to your Peak Mode account',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_NEW_LOGIN'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'newLogin',
  },
  HUB_SUSPICIOUS_LOGIN: {
    subject: 'Unusual sign-in activity on your Peak Mode account',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.CRITICAL,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_SUSPICIOUS_LOGIN'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'suspiciousLogin',
  },
  HUB_LOGIN_BLOCKED: {
    subject: 'Sign-in attempt blocked on your Peak Mode account',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.CRITICAL,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_LOGIN_BLOCKED'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'loginBlocked',
  },
  HUB_EMAIL_CHANGE_CONFIRM: {
    subject: 'Confirm your new Peak Mode email address',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.CRITICAL,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_EMAIL_CHANGE_CONFIRMATION', 'SENDGRID_EMAIL_CHANGE_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'confirmationUrl', 'new_email'],
    urlFields: ['confirmationUrl'],
    legacyHubKey: 'emailChangeConfirmation',
  },
  HUB_EMAIL_CHANGED: {
    subject: 'Your Peak Mode email address was updated',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_EMAIL_CHANGED'],
    requiredFields: ['customer_name', 'new_email'],
    urlFields: [],
    legacyHubKey: 'emailChanged',
  },
  HUB_GOOGLE_CONNECTED: {
    subject: 'Google account connected to Peak Mode',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.NORMAL,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_GOOGLE_CONNECTED'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'googleConnected',
  },
  HUB_GOOGLE_DISCONNECTED: {
    subject: 'Google account disconnected from Peak Mode',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.NORMAL,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_GOOGLE_DISCONNECTED'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'googleDisconnected',
  },
  HUB_MFA_ENABLED: {
    subject: 'Two-step verification enabled on Peak Mode',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.CRITICAL,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_MFA_ENABLED'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'mfaEnabled',
  },
  HUB_MFA_DISABLED: {
    subject: 'Two-step verification disabled on Peak Mode',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.CRITICAL,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_MFA_DISABLED'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'mfaDisabled',
  },
  HUB_ACCOUNT_RECOVERY: {
    subject: 'Peak Mode account recovery',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.CRITICAL,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_RECOVERY'],
    requiredFields: ['customer_name', 'recoveryUrl'],
    urlFields: ['recoveryUrl'],
    legacyHubKey: 'accountRecovery',
  },
  HUB_ACCOUNT_DELETED: {
    subject: 'Your Peak Mode account was deleted',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_ACCOUNT_DELETED'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: 'accountDeleted',
  },
  HUB_WELCOME_POST_VERIFY: {
    subject: 'Welcome to Peak Mode Hub',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['HUB_WELCOME_EMAIL', 'SENDGRID_ACCOUNT_SETUP_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'hubUrl'],
    urlFields: ['hubUrl'],
    legacyHubKey: 'hubWelcomePostVerify',
  },
  ORDER_PROCESSING: {
    subject: 'Your Peak Mode order is being processed',
    subjectByLang: { en: 'Your Order', sv: 'Din order' },
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_ORDER_PROCESSING_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'order_number'],
    urlFields: [],
    legacyHubKey: null,
  },
  SHIPMENT_DISPATCHED: {
    subject: 'Your Peak Mode order has shipped',
    subjectByLang: { en: 'Your Order', sv: 'Din order' },
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_SHIPPING_NOTIFICATION_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'order_number', 'tracking_url'],
    urlFields: ['tracking_url'],
    legacyHubKey: null,
  },
  SHIPMENT_DELIVERED: {
    subject: 'Your Peak Mode order was delivered',
    subjectByLang: { en: 'Your Order', sv: 'Din order' },
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_DELIVERY_CONFIRMATION_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'order_number'],
    urlFields: [],
    legacyHubKey: null,
  },
  PAYMENT_FAILED: {
    subject: 'Payment failed for your Peak Mode order',
    subjectByLang: { en: 'Payment Failed for Order', sv: 'Betalning misslyckades för order' },
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_PAYMENT_FAILED_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'order_number', 'retry_url'],
    urlFields: ['retry_url'],
    legacyHubKey: null,
  },
  REVIEW_REQUEST: {
    subject: 'How was your Peak Mode order?',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.NORMAL,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_REVIEW_REQUEST_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'order_number', 'review_url'],
    urlFields: ['review_url'],
    legacyHubKey: null,
  },
  NEWSLETTER_WELCOME: {
    subject: 'Welcome to Peak Mode',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  NEWSLETTER_CONFIRMATION: {
    subject: 'Confirm your Peak Mode newsletter subscription',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_NEWSLETTER_CONFIRMATION_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  MARKETING_CONFIRMATION: {
    subject: 'Confirm Peak Mode marketing emails',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_MARKETING_CONFIRMATION_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  ABANDONED_CART: {
    subject: 'You left items in your cart',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_ABANDONED_CART_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'cart_url'],
    urlFields: ['cart_url'],
    legacyHubKey: null,
  },
  ABANDONED_CART_REMINDER: {
    subject: 'Complete your Peak Mode purchase',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_ABANDONED_CART_SECOND_TEMPLATE_ID', 'SENDGRID_ABANDONED_CART_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'cart_url'],
    urlFields: ['cart_url'],
    legacyHubKey: null,
  },
  SUPPORT_CONFIRMATION: {
    subject: 'We received your message',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.NORMAL,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_SUPPORT_CONFIRMATION_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  WAITLIST_CONFIRMATION: {
    subject: 'You are on the Peak Mode waitlist',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_WAITLIST_CONFIRMATION_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  DROPS_CONFIRMATION: {
    subject: 'Peak Mode drops — you are in',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_DROPS_CONFIRMATION_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  ORDER_RECEIPT: {
    subject: 'Your Peak Mode receipt',
    subjectByLang: { en: 'Your receipt', sv: 'Ditt kvitto' },
    deliveryMode: 'html',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: [],
    requiredFields: ['customer_name', 'order_number'],
    urlFields: [],
    legacyHubKey: null,
  },
  ORDER_RECEIPT_FALLBACK: {
    subject: 'Your Peak Mode receipt',
    subjectByLang: { en: 'Your receipt', sv: 'Ditt kvitto' },
    deliveryMode: 'html',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: [],
    requiredFields: ['customer_name', 'order_number'],
    urlFields: [],
    legacyHubKey: null,
  },
  SUPPORT_INBOX: {
    subject: 'Support request received',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.NORMAL,
    bypassListManagement: true,
    templateEnvKeys: [
      'SENDGRID_SUPPORT_INBOX_TEMPLATE_ID',
      'SENDGRID_SUPPORT_CONFIRMATION_TEMPLATE_ID',
    ],
    requiredFields: ['customer_name', 'ticket_id'],
    urlFields: [],
    legacyHubKey: null,
  },
  SUPPORT_REPLY: {
    subject: 'Reply from Peak Mode Support',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.NORMAL,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_SUPPORT_REPLY_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'reply_message'],
    urlFields: [],
    legacyHubKey: null,
  },
  SUPPORT_COMPOSED: {
    subject: 'Message from Peak Mode Support',
    deliveryMode: 'html',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.NORMAL,
    bypassListManagement: true,
    templateEnvKeys: [],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  REVIEW_CONFIRMATION: {
    subject: 'Thank you for your review',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.NORMAL,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_REVIEW_CONFIRMATION_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  DISCOUNT_REMINDER: {
    subject: 'Your Peak Mode discount code',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_DISCOUNT_REMINDER_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'discount_code'],
    urlFields: [],
    legacyHubKey: null,
  },
  DISCOUNT_CODE_UPDATE: {
    subject: 'Your Peak Mode discount code',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_DISCOUNT_CODE_UPDATE_TEMPLATE_ID', 'SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'discount_code'],
    urlFields: [],
    legacyHubKey: null,
  },
  DISCOUNT_EXPIRED: {
    subject: 'Your discount code has expired',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_USED_EXPIRED_DISCOUNT_TEMPLATE_ID', 'SENDGRID_DISCOUNT_REMINDER_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  WAITLIST_CONFIRMATION: {
    subject: 'Welcome to the Peak Mode waitlist',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_WAITLIST_CONFIRMATION_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  PRIVATE_EARLY_ACCESS: {
    subject: 'Private early access to Peak Mode',
    category: CATEGORY.MARKETING,
    priority: PRIORITY.LOW,
    bypassListManagement: false,
    templateEnvKeys: ['SENDGRID_PRIVATE_EARLY_ACCESS_TEMPLATE_ID'],
    requiredFields: ['customer_name'],
    urlFields: [],
    legacyHubKey: null,
  },
  ORDER_STATUS_UPDATE: {
    subject: 'Your order status was updated',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_ORDER_STATUS_TEMPLATE_ID'],
    requiredFields: ['customer_name', 'order_number'],
    urlFields: ['track_order_url'],
    legacyHubKey: null,
  },
  ADMIN_INVITE: {
    subject: "You've been invited to Peak Mode Admin",
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_ADMIN_INVITE_TEMPLATE_ID'],
    requiredFields: ['admin_email', 'invite_link'],
    urlFields: ['invite_link'],
    legacyHubKey: null,
  },
  ADMIN_SUPER_INVITE_NOTIFY: {
    subject: 'Admin invite sent',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.NORMAL,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_SUPER_ADMIN_INVITE_TEMPLATE_ID'],
    requiredFields: ['admin_email'],
    urlFields: [],
    legacyHubKey: null,
  },
  ADMIN_ACTIVATED: {
    subject: 'Admin account activated',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.NORMAL,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_ADMIN_ACTIVATED_TEMPLATE_ID'],
    requiredFields: ['admin_email'],
    urlFields: [],
    legacyHubKey: null,
  },
  ADMIN_SET_PASSWORD: {
    subject: 'Set your Peak Mode Admin password',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.CRITICAL,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_SET_PASSWORD_ADMIN_TEMPLATE_ID'],
    requiredFields: ['admin_email', 'reset_link'],
    urlFields: ['reset_link'],
    legacyHubKey: null,
  },
  ADMIN_PASSWORD_SET_SUCCESS: {
    subject: 'Peak Mode Admin password updated',
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: ['SENDGRID_PASSWORD_SET_SUCCESS_ADMIN_TEMPLATE_ID'],
    requiredFields: ['admin_email'],
    urlFields: [],
    legacyHubKey: null,
  },
  ORDER_CONFIRMATION: {
    subject: 'Your Peak Mode order confirmation',
    subjectByLang: {
      en: 'Order Confirmation',
      sv: 'Orderbekräftelse',
    },
    category: CATEGORY.TRANSACTIONAL,
    priority: PRIORITY.HIGH,
    bypassListManagement: true,
    templateEnvKeys: [
      'SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_EN',
      'SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID',
    ],
    templateEnvKeysByLang: {
      en: [
        'SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_EN',
        'SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID',
      ],
      sv: [
        'SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_SV',
        'SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID',
      ],
    },
    requiredFields: ['customer_name', 'order_number'],
    urlFields: ['order_status_url'],
    legacyHubKey: null,
  },
};

const LEGACY_HUB_KEY_TO_TYPE = Object.fromEntries(
  Object.entries(EMAIL_TYPES)
    .filter(([, d]) => d.legacyHubKey)
    .map(([type, d]) => [d.legacyHubKey, type]),
);

function getDefinition(emailType) {
  return EMAIL_TYPES[emailType] || null;
}

function resolveProviderTemplateId(emailType, options = {}) {
  const def = getDefinition(emailType);
  if (!def) return '';
  const lang = String(options.language || options.lang || 'en').toLowerCase();
  if (def.templateEnvKeysByLang && def.templateEnvKeysByLang[lang]) {
    const localized = pickEnv(def.templateEnvKeysByLang[lang]);
    if (localized) return localized;
  }
  return pickEnv(def.templateEnvKeys);
}

const HUB_SUBJECT_BY_LANG = {
  HUB_WELCOME_REGISTRATION: {
    en: 'Welcome to Peak Mode',
    sv: 'Välkommen till Peak Mode',
  },
  HUB_VERIFY_EMAIL: {
    en: 'Verify your Peak Mode account',
    sv: 'Verifiera ditt Peak Mode-konto',
  },
  HUB_PASSWORD_RESET: {
    en: 'Reset your Peak Mode password',
    sv: 'Återställ ditt Peak Mode-lösenord',
  },
  HUB_PASSWORD_RESET_SUCCESS: {
    en: 'Your Peak Mode password was reset',
    sv: 'Ditt Peak Mode-lösenord har återställts',
  },
  HUB_PASSWORD_CHANGED: {
    en: 'Your Peak Mode password was changed',
    sv: 'Ditt Peak Mode-lösenord har ändrats',
  },
  HUB_NEW_LOGIN: {
    en: 'New sign-in to your Peak Mode account',
    sv: 'Ny inloggning på ditt Peak Mode-konto',
  },
  HUB_SUSPICIOUS_LOGIN: {
    en: 'Unusual sign-in activity on your Peak Mode account',
    sv: 'Ovanlig inloggningsaktivitet på ditt Peak Mode-konto',
  },
  HUB_LOGIN_BLOCKED: {
    en: 'Sign-in attempt blocked on your Peak Mode account',
    sv: 'Inloggningsförsök blockerades på ditt Peak Mode-konto',
  },
  HUB_EMAIL_CHANGE_CONFIRM: {
    en: 'Confirm your new Peak Mode email address',
    sv: 'Bekräfta din nya Peak Mode-e-postadress',
  },
  HUB_EMAIL_CHANGED: {
    en: 'Your Peak Mode email address was updated',
    sv: 'Din Peak Mode-e-postadress har uppdaterats',
  },
  HUB_GOOGLE_CONNECTED: {
    en: 'Google account connected to Peak Mode',
    sv: 'Google-konto kopplat till Peak Mode',
  },
  HUB_GOOGLE_DISCONNECTED: {
    en: 'Google account disconnected from Peak Mode',
    sv: 'Google-konto bortkopplat från Peak Mode',
  },
  HUB_MFA_ENABLED: {
    en: 'Two-step verification enabled on Peak Mode',
    sv: 'Tvåstegsverifiering aktiverad på Peak Mode',
  },
  HUB_MFA_DISABLED: {
    en: 'Two-step verification disabled on Peak Mode',
    sv: 'Tvåstegsverifiering inaktiverad på Peak Mode',
  },
  HUB_ACCOUNT_RECOVERY: {
    en: 'Peak Mode account recovery',
    sv: 'Återställning av ditt Peak Mode-konto',
  },
  HUB_ACCOUNT_DELETED: {
    en: 'Your Peak Mode account was deleted',
    sv: 'Ditt Peak Mode-konto har tagits bort',
  },
  HUB_WELCOME_POST_VERIFY: {
    en: 'Welcome to Peak Mode Hub',
    sv: 'Välkommen till Peak Mode Hub',
  },
};

function resolveSubjectForJob(emailType, payload) {
  const def = getDefinition(emailType);
  if (!def) return '';
  const data = payload || {};
  if (data.composed_subject && String(data.composed_subject).trim()) {
    return String(data.composed_subject).trim();
  }
  const lang = String(data.language || 'en').toLowerCase() === 'sv' ? 'sv' : 'en';
  let subject = def.subject || '';
  const hubSubjects = HUB_SUBJECT_BY_LANG[emailType];
  if (hubSubjects) {
    subject = hubSubjects[lang] || hubSubjects.en || subject;
  } else if (def.subjectByLang && def.subjectByLang[lang]) {
    subject = def.subjectByLang[lang];
  } else if (def.subjectByLang && def.subjectByLang.en) {
    subject = def.subjectByLang.en;
  }
  if (data.order_number && def.subjectByLang) {
    subject = `${subject} - ${data.order_number}`;
  }
  return String(subject || 'Peak Mode').trim();
}

function emailTypeFromLegacyHubKey(legacyKey) {
  return LEGACY_HUB_KEY_TO_TYPE[legacyKey] || null;
}

function listDefinitionsForDiagnostics() {
  const out = {};
  for (const [type, def] of Object.entries(EMAIL_TYPES)) {
    const id = resolveProviderTemplateId(type);
    out[type] = {
      configured: !isPlaceholderTemplateId(id),
      templateId: isPlaceholderTemplateId(id) ? 'not configured' : id,
      subject: def.subject,
      category: def.category,
    };
  }
  return out;
}

module.exports = {
  EMAIL_TYPES,
  getDefinition,
  resolveProviderTemplateId,
  resolveSubjectForJob,
  emailTypeFromLegacyHubKey,
  isPlaceholderTemplateId,
  pickEnv,
  listDefinitionsForDiagnostics,
};
