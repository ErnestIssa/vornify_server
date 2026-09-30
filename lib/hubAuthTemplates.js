/**
 * Hub account & security SendGrid template IDs (env SSOT).
 * Backend sends only via dynamic templates — no inline HTML for these mails.
 */

function pickEnv(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    const value = process.env[key];
    if (value && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function isPlaceholderTemplateId(templateId) {
  const id = String(templateId || '').trim();
  if (!id) return true;
  return id.startsWith('d-') && id.includes('template_id');
}

function isHubTemplateConfigured(templateId) {
  return !isPlaceholderTemplateId(templateId);
}

const HUB_TEMPLATE_KEYS = {
  accountWelcome: ['HUB_ACCOUNT_WELCOME', 'HUB_WELCOME_EMAIL', 'SENDGRID_ACCOUNT_SETUP_TEMPLATE_ID'],
  emailVerification: ['EMAIL_VERIFICATION_HUB_ACCOUNT', 'SENDGRID_EMAIL_VERIFICATION_TEMPLATE_ID'],
  passwordReset: ['HUB_ACCOUNT_PASSWORD_RESET', 'SENDGRID_PASSWORD_RESET_TEMPLATE_ID'],
  passwordResetSuccess: [
    'HUB_ACCOUNT_PASSWORD_RESET_SUCCESS',
    'SENDGRID_PASSWORD_RESET_SUCCESS_TEMPLATE_ID',
  ],
  passwordChanged: ['HUB_ACCOUNT_PASSWORD_CHANGED'],
  newLogin: ['HUB_ACCOUNT_NEW_LOGIN'],
  suspiciousLogin: ['HUB_ACCOUNT_SUSPICIOUS_LOGIN'],
  loginBlocked: ['HUB_ACCOUNT_LOGIN_BLOCKED'],
  emailChangeConfirmation: ['HUB_ACCOUNT_EMAIL_CHANGE_CONFIRMATION', 'SENDGRID_EMAIL_CHANGE_TEMPLATE_ID'],
  emailChanged: ['HUB_ACCOUNT_EMAIL_CHANGED'],
  googleConnected: ['HUB_ACCOUNT_GOOGLE_CONNECTED'],
  googleDisconnected: ['HUB_ACCOUNT_GOOGLE_DISCONNECTED'],
  mfaEnabled: ['HUB_ACCOUNT_MFA_ENABLED'],
  mfaDisabled: ['HUB_ACCOUNT_MFA_DISABLED'],
  accountRecovery: ['HUB_ACCOUNT_RECOVERY'],
  accountDeleted: ['HUB_ACCOUNT_DELETED'],
  /** After email verification (optional second welcome). */
  hubWelcomePostVerify: ['HUB_WELCOME_EMAIL', 'SENDGRID_ACCOUNT_SETUP_TEMPLATE_ID'],
};

function getHubTemplateId(key) {
  const envKeys = HUB_TEMPLATE_KEYS[key];
  if (!envKeys) return '';
  return pickEnv(envKeys);
}

function getHubAuthTemplateIds() {
  const out = {};
  for (const key of Object.keys(HUB_TEMPLATE_KEYS)) {
    out[key] = getHubTemplateId(key);
  }
  // Legacy aliases used elsewhere in the codebase
  out.hubWelcome = out.hubWelcomePostVerify || out.accountWelcome;
  out.emailVerification = out.emailVerification;
  out.passwordReset = out.passwordReset;
  out.passwordResetSuccess = out.passwordResetSuccess;
  return out;
}

function hubEmailBaseData(extra = {}) {
  const { buildBrandLinks } = require('./hubEmailPayload');
  return {
    ...buildBrandLinks(),
    ...extra,
  };
}

function listHubTemplateConfiguration() {
  const ids = getHubAuthTemplateIds();
  const configured = {};
  for (const [key, id] of Object.entries(ids)) {
    configured[key] = {
      configured: isHubTemplateConfigured(id),
      templateId: isHubTemplateConfigured(id) ? id : 'not configured',
    };
  }
  return configured;
}

module.exports = {
  HUB_TEMPLATE_KEYS,
  getHubTemplateId,
  getHubAuthTemplateIds,
  isHubTemplateConfigured,
  isPlaceholderTemplateId,
  hubEmailBaseData,
  listHubTemplateConfiguration,
};
