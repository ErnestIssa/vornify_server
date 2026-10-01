const { mirrorUrl } = require('./emailUrls');

const BUTTON_URL_ALIASES = [
  'action_url',
  'button_url',
  'cta_url',
  'primary_action_url',
  'primary_button_url',
  'primary_url',
  'button_link',
  'cta_link',
  'link',
  'url',
  'click_url',
  'target_url',
  'href',
];

const FOOTER_LINK_ALIASES = {
  website_url: ['visit_peak_mode_url', 'peak_mode_url', 'store_link', 'shop_link', 'homepage_url'],
  contact_url: ['contact_support_url', 'support_page_link', 'help_url'],
  support_url: ['contact_support_mailto', 'support_email_link'],
  hub_url: ['peak_mode_hub_url', 'hub_link'],
  privacy_policy_url: ['privacy_link'],
  terms_of_service_url: ['terms_link'],
};

const COPY = {
  en: {
    recovery_status: 'Ready to continue',
    recovery_status_label: 'In progress',
    recovery_intro: 'Follow the secure link below to continue recovering your account.',
    device_unknown: 'Web browser',
    login_location: 'Approximate location unavailable',
  },
  sv: {
    recovery_status: 'Redo att fortsätta',
    recovery_status_label: 'Pågår',
    recovery_intro: 'Följ den säkra länken nedan för att fortsätta återställa ditt konto.',
    device_unknown: 'Webläsare',
    login_location: 'Ungefärlig plats ej tillgänglig',
  },
};

function pickLang(data) {
  const lang = String(data?.language || 'en').toLowerCase();
  return lang === 'sv' ? 'sv' : 'en';
}

function formatDisplayName(rawName, email) {
  const trimmed = rawName != null ? String(rawName).trim() : '';
  if (trimmed) return trimmed;
  const local = String(email || '').split('@')[0]?.trim();
  return local || 'Member';
}

function formatDateTime(iso, lang) {
  if (!iso) return '';
  const raw = String(iso).trim();
  if (!raw) return '';
  if (!/\dT\d/.test(raw) && !/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw;
  }
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString(lang === 'sv' ? 'sv-SE' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return raw;
  }
}

function summarizeDevice(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (!ua) return null;
  if (ua.includes('iphone')) return 'iPhone';
  if (ua.includes('ipad')) return 'iPad';
  if (ua.includes('android')) return 'Android device';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'Mac';
  if (ua.includes('windows')) return 'Windows PC';
  if (ua.includes('linux')) return 'Linux device';
  return null;
}

function applyNameAliases(data) {
  const name = formatDisplayName(
    data.customer_name || data.name || data.first_name || data.firstName,
    data.recipient || data.email,
  );
  data.customer_name = name;
  data.name = name;
  data.first_name = name.split(/\s+/)[0] || name;
  data.firstName = data.first_name;
  data.user_name = name;
  data.member_name = name;
  data.full_name = name;
  return data;
}

function applyFooterMirrors(data) {
  for (const [canonical, aliases] of Object.entries(FOOTER_LINK_ALIASES)) {
    if (data[canonical]) {
      Object.assign(data, mirrorUrl(data[canonical], aliases));
    }
  }
  if (data.logo_link && !data.visit_url) {
    data.visit_url = data.logo_link;
  }
  return data;
}

function applyRecoveryFields(data, lang, { force = false } = {}) {
  const link = data.recoveryUrl || data.recovery_url || data.recovery_link || data.recoveryLink;
  if (!link && !force) return data;

  const c = COPY[lang] || COPY.en;
  const requestedAt =
    data.recovery_requested_at ||
    data.request_date ||
    data.recovery_date ||
    new Date().toISOString();
  const formattedDate = formatDateTime(requestedAt, lang);
  data.request_date = formattedDate;
  data.recovery_request_date = formattedDate;
  data.recovery_date = formattedDate;
  data.recovery_status = (data.recovery_status && String(data.recovery_status).trim()) || c.recovery_status;
  data.recovery_status_label =
    (data.recovery_status_label && String(data.recovery_status_label).trim()) || c.recovery_status_label;
  data.recovery_message = data.recovery_message || c.recovery_intro;

  if (link) {
    data.recoveryUrl = link;
    Object.assign(
      data,
      mirrorUrl(link, [
        'recovery_url',
        'recovery_link',
        'continue_recovery_url',
        'continue_account_recovery_url',
        'account_recovery_url',
        'recover_account_url',
        ...BUTTON_URL_ALIASES,
      ]),
    );
  } else if (force && data.account_url) {
    Object.assign(data, mirrorUrl(data.account_url, ['recovery_url', 'recovery_link', ...BUTTON_URL_ALIASES]));
  }

  return data;
}

function applyLoginFields(data, lang) {
  const c = COPY[lang] || COPY.en;
  const at = data.login_time || data.login_at || data.at;
  if (at) {
    const formatted = formatDateTime(at, lang);
    data.login_time = formatted;
    data.login_time_formatted = formatted;
    data.sign_in_time = formatted;
  }
  const device =
    summarizeDevice(data.device_info || data.user_agent || data.userAgent) || c.device_unknown;
  data.device_info = device;
  data.device_description = device;
  data.device_name = device;
  data.login_device = device;

  if (data.login_ip) {
    data.login_location = data.login_location || c.login_location;
    data.sign_in_ip = data.login_ip;
  }
  return data;
}

function applyActionUrlMirrors(data, canonicalKey, extraKeys = []) {
  const link = data[canonicalKey];
  if (!link) return data;
  Object.assign(data, mirrorUrl(link, [...extraKeys, ...BUTTON_URL_ALIASES]));
  return data;
}

function enrichTemplateData(data, emailType) {
  const out = { ...(data || {}) };
  const lang = pickLang(out);
  out.language = lang;
  out.locale = lang;

  applyNameAliases(out);
  applyFooterMirrors(out);

  applyActionUrlMirrors(out, 'verificationUrl', [
    'verification_link',
    'verification_url',
    'verify_link',
    'verify_url',
    'confirm_email_url',
  ]);
  applyActionUrlMirrors(out, 'resetUrl', [
    'reset_link',
    'reset_url',
    'password_reset_link',
    'password_reset_url',
  ]);
  applyActionUrlMirrors(out, 'confirmationUrl', [
    'confirmation_link',
    'confirm_link',
    'email_change_url',
  ]);
  const isRecoveryEmail = emailType === 'HUB_ACCOUNT_RECOVERY';
  applyRecoveryFields(out, lang, { force: isRecoveryEmail });
  applyActionUrlMirrors(out, 'hubUrl', ['hub_url', 'hub_home_url', 'dashboard_url']);
  applyLoginFields(out, lang);

  const accountUrl = out.account_url || out.login_url || out.sign_in_url;
  if (accountUrl && !out.action_url && !out.recoveryUrl && !out.resetUrl && !out.verificationUrl) {
    Object.assign(out, mirrorUrl(accountUrl, BUTTON_URL_ALIASES));
  }

  if (out.hub_url && !out.hubUrl) {
    out.hubUrl = out.hub_url;
    applyActionUrlMirrors(out, 'hubUrl');
  }

  return out;
}

module.exports = { enrichTemplateData, formatDisplayName, formatDateTime };
