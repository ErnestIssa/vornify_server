/**
 * Dynamic template data for Hub / account SendGrid templates.
 * Templates may use any of these keys for hrefs, logo link, footer, and subject.
 */
const { getStorefrontOrigin, normalizeAuthLink } = require('./authMailLinks');

const HUB_EMAIL_SUBJECTS = {
  accountWelcome: 'Welcome to Peak Mode',
  emailVerification: 'Verify your Peak Mode email',
  passwordReset: 'Reset your Peak Mode password',
  passwordResetSuccess: 'Your Peak Mode password was reset',
  passwordChanged: 'Your Peak Mode password was changed',
  newLogin: 'New sign-in to your Peak Mode account',
  suspiciousLogin: 'Unusual sign-in activity on your Peak Mode account',
  loginBlocked: 'Sign-in attempt blocked on your Peak Mode account',
  emailChangeConfirmation: 'Confirm your new Peak Mode email address',
  emailChanged: 'Your Peak Mode email address was updated',
  googleConnected: 'Google account connected to Peak Mode',
  googleDisconnected: 'Google account disconnected from Peak Mode',
  mfaEnabled: 'Two-step verification enabled on Peak Mode',
  mfaDisabled: 'Two-step verification disabled on Peak Mode',
  accountRecovery: 'Peak Mode account recovery',
  accountDeleted: 'Your Peak Mode account was deleted',
  hubWelcomePostVerify: 'Welcome to Peak Mode Hub',
};

function subjectFields(subject) {
  const s = String(subject || '').trim() || 'Peak Mode';
  return {
    subject: s,
    Subject: s,
    email_subject: s,
    subject_line: s,
    emailSubject: s,
    title: s,
    email_title: s,
    preheader: s,
  };
}

function normalizePeakModeUrl(raw, fallbackOrigin) {
  const normalized = normalizeAuthLink(raw, fallbackOrigin);
  return String(normalized || getStorefrontOrigin(fallbackOrigin)).trim();
}

/** Site-wide links (logo, footer, hub entry). */
function buildBrandLinks(fallbackOrigin) {
  const origin = getStorefrontOrigin(fallbackOrigin);
  const supportEmail = (process.env.SUPPORT_INBOX_EMAIL || process.env.EMAIL_FROM || 'support@peakmode.se').trim();

  const links = {
    website_url: origin,
    site_url: origin,
    home_url: origin,
    shop_url: origin,
    store_url: origin,
    logo_url: origin,
    logo_link: origin,
    brand_url: origin,
    company_url: origin,
    hub_url: `${origin}/peak-mode-hub`,
    hub_home_url: `${origin}/peak-mode-hub`,
    dashboard_url: `${origin}/peak-mode-hub`,
    account_url: `${origin}/hub/auth`,
    login_url: `${origin}/hub/auth`,
    sign_in_url: `${origin}/hub/auth`,
    contact_url: `${origin}/contact`,
    support_page_url: `${origin}/contact`,
    privacy_policy_url: `${origin}/privacy-policy`,
    privacy_url: `${origin}/privacy-policy`,
    terms_of_service_url: `${origin}/terms-of-service`,
    terms_url: `${origin}/terms-of-service`,
    returns_url: `${origin}/returns`,
    shipping_url: `${origin}/shipping`,
    support_email: supportEmail,
    support_url: `mailto:${supportEmail}`,
    company_name: 'Peak Mode',
    brand_name: 'Peak Mode',
    year: new Date().getFullYear(),
  };

  return links;
}

/** Duplicate one URL under every common SendGrid / Handlebars key for CTAs. */
function expandActionLink(url, keyNames, fallbackOrigin) {
  const link = normalizePeakModeUrl(url, fallbackOrigin);
  if (!link) return {};

  const out = {};
  const names = new Set([
    ...(keyNames || []),
    'action_url',
    'button_url',
    'cta_url',
    'primary_action_url',
    'link',
    'url',
    'click_url',
    'target_url',
  ]);

  for (const name of names) {
    out[name] = link;
  }
  return out;
}

function buildHubTemplatePayload(templateKey, { fallbackOrigin, subjectOverride, extra = {} } = {}) {
  const subject =
    subjectOverride ||
    HUB_EMAIL_SUBJECTS[templateKey] ||
    HUB_EMAIL_SUBJECTS.accountWelcome;

  return {
    ...buildBrandLinks(fallbackOrigin),
    ...subjectFields(subject),
    ...extra,
  };
}

function getHubEmailSubject(templateKey) {
  return HUB_EMAIL_SUBJECTS[templateKey] || 'Peak Mode';
}

module.exports = {
  HUB_EMAIL_SUBJECTS,
  subjectFields,
  buildBrandLinks,
  expandActionLink,
  buildHubTemplatePayload,
  getHubEmailSubject,
  normalizePeakModeUrl,
};
