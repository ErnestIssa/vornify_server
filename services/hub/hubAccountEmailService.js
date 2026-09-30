/**
 * Hub account & security emails — SendGrid dynamic templates only (SSOT: backend).
 */
const emailService = require('../emailService');
const { getHubTemplateId, isHubTemplateConfigured } = require('../../lib/hubAuthTemplates');
const {
  buildHubTemplatePayload,
  expandActionLink,
  getHubEmailSubject,
} = require('../../lib/hubEmailPayload');

async function sendHubTemplate(templateKey, to, dynamicExtra = {}, options = {}) {
  const templateId = getHubTemplateId(templateKey);
  if (!isHubTemplateConfigured(templateId)) {
    console.error(`[hub-email] Missing SendGrid template env for "${templateKey}"`);
    return { success: false, error: 'template_not_configured', templateKey };
  }

  const subject = getHubEmailSubject(templateKey);
  const payload = buildHubTemplatePayload(templateKey, {
    fallbackOrigin: options.fallbackOrigin,
    extra: dynamicExtra,
  });

  const result = await emailService.sendHubDynamicTemplateEmail(to, subject, templateId, payload);
  if (!result.success) {
    console.error(`[hub-email] Send failed (${templateKey}) → ${to}:`, result.error || result.details);
  }
  return result;
}

function customerName(name, email) {
  return (name && String(name).trim()) || String(email || '').split('@')[0] || 'Member';
}

async function sendAccountWelcomeEmail(to, name, options = {}) {
  return sendHubTemplate(
    'accountWelcome',
    to,
    { customer_name: customerName(name, to) },
    options,
  );
}

async function sendEmailVerificationEmail(to, name, verificationLink, options = {}) {
  const link = String(verificationLink || '').trim();
  return sendHubTemplate(
    'emailVerification',
    to,
    {
      customer_name: customerName(name, to),
      ...expandActionLink(link, [
        'verification_link',
        'verification_url',
        'verify_link',
        'confirm_link',
        'email_verification_link',
        'verify_email_link',
      ], options.fallbackOrigin),
    },
    options,
  );
}

async function sendPasswordResetEmail(to, resetLink, options = {}) {
  const link = String(resetLink || '').trim();
  return sendHubTemplate(
    'passwordReset',
    to,
    {
      expiry_hours: 1,
      ...expandActionLink(link, [
        'reset_link',
        'reset_url',
        'password_reset_link',
        'password_reset_url',
        'resetLink',
      ], options.fallbackOrigin),
    },
    options,
  );
}

async function sendPasswordResetSuccessEmail(to, name, options = {}) {
  return sendHubTemplate(
    'passwordResetSuccess',
    to,
    {
      customer_name: customerName(name, to),
      ...expandActionLink(`${buildHubTemplatePayload('passwordResetSuccess', options).login_url}`, [
        'sign_in_link',
      ], options.fallbackOrigin),
    },
    options,
  );
}

async function sendPasswordChangedEmail(to, name, options = {}) {
  return sendHubTemplate(
    'passwordChanged',
    to,
    {
      customer_name: customerName(name, to),
      ...expandActionLink(buildHubTemplatePayload('passwordChanged', options).login_url, ['sign_in_link'], options.fallbackOrigin),
    },
    options,
  );
}

async function sendNewLoginEmail(to, name, context, options = {}) {
  const base = buildHubTemplatePayload('newLogin', options);
  return sendHubTemplate(
    'newLogin',
    to,
    {
      customer_name: customerName(name, to),
      login_time: context?.at,
      login_ip: context?.ip,
      device_info: context?.userAgent,
      ...expandActionLink(base.account_url, ['security_settings_url', 'account_security_url'], options.fallbackOrigin),
    },
    options,
  );
}

async function sendSuspiciousLoginEmail(to, name, context, options = {}) {
  const base = buildHubTemplatePayload('suspiciousLogin', options);
  return sendHubTemplate(
    'suspiciousLogin',
    to,
    {
      customer_name: customerName(name, to),
      login_time: context?.at,
      login_ip: context?.ip,
      device_info: context?.userAgent,
      ...expandActionLink(base.account_url, ['security_settings_url', 'reset_password_url'], options.fallbackOrigin),
    },
    options,
  );
}

async function sendLoginBlockedEmail(to, name, options = {}) {
  const base = buildHubTemplatePayload('loginBlocked', options);
  return sendHubTemplate(
    'loginBlocked',
    to,
    {
      customer_name: customerName(name, to),
      ...expandActionLink(base.login_url, ['sign_in_link'], options.fallbackOrigin),
    },
    options,
  );
}

async function sendEmailChangeConfirmationEmail(to, name, confirmLink, newEmail, options = {}) {
  return sendHubTemplate(
    'emailChangeConfirmation',
    to,
    {
      customer_name: customerName(name, to),
      new_email: newEmail,
      ...expandActionLink(confirmLink, [
        'confirmation_link',
        'confirm_link',
        'email_change_link',
        'verify_link',
      ], options.fallbackOrigin),
    },
    options,
  );
}

async function sendEmailChangedEmail(to, name, newEmail, options = {}) {
  const base = buildHubTemplatePayload('emailChanged', options);
  return sendHubTemplate(
    'emailChanged',
    to,
    {
      customer_name: customerName(name, to),
      new_email: newEmail,
      ...expandActionLink(base.login_url, ['sign_in_link'], options.fallbackOrigin),
    },
    options,
  );
}

async function sendGoogleConnectedEmail(to, name, options = {}) {
  const base = buildHubTemplatePayload('googleConnected', options);
  return sendHubTemplate(
    'googleConnected',
    to,
    {
      customer_name: customerName(name, to),
      ...expandActionLink(base.hub_url, ['dashboard_url'], options.fallbackOrigin),
    },
    options,
  );
}

async function sendGoogleDisconnectedEmail(to, name, options = {}) {
  return sendHubTemplate(
    'googleDisconnected',
    to,
    { customer_name: customerName(name, to) },
    options,
  );
}

async function sendMfaEnabledEmail(to, name, options = {}) {
  return sendHubTemplate(
    'mfaEnabled',
    to,
    { customer_name: customerName(name, to) },
    options,
  );
}

async function sendMfaDisabledEmail(to, name, options = {}) {
  return sendHubTemplate(
    'mfaDisabled',
    to,
    { customer_name: customerName(name, to) },
    options,
  );
}

async function sendAccountRecoveryEmail(to, name, recoveryLink, options = {}) {
  return sendHubTemplate(
    'accountRecovery',
    to,
    {
      customer_name: customerName(name, to),
      ...expandActionLink(recoveryLink, ['recovery_link', 'account_recovery_link'], options.fallbackOrigin),
    },
    options,
  );
}

async function sendAccountDeletedEmail(to, name, options = {}) {
  return sendHubTemplate(
    'accountDeleted',
    to,
    { customer_name: customerName(name, to) },
    options,
  );
}

async function sendHubWelcomePostVerifyEmail(to, name, hubUrl, options = {}) {
  const link = String(hubUrl || '').trim() || buildHubTemplatePayload('hubWelcomePostVerify', options).hub_url;
  return sendHubTemplate(
    'hubWelcomePostVerify',
    to,
    {
      customer_name: customerName(name, to),
      ...expandActionLink(link, ['hub_url', 'hub_home_url', 'dashboard_url'], options.fallbackOrigin),
    },
    options,
  );
}

module.exports = {
  sendAccountWelcomeEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordResetSuccessEmail,
  sendPasswordChangedEmail,
  sendNewLoginEmail,
  sendSuspiciousLoginEmail,
  sendLoginBlockedEmail,
  sendEmailChangeConfirmationEmail,
  sendEmailChangedEmail,
  sendGoogleConnectedEmail,
  sendGoogleDisconnectedEmail,
  sendMfaEnabledEmail,
  sendMfaDisabledEmail,
  sendAccountRecoveryEmail,
  sendAccountDeletedEmail,
  sendHubWelcomePostVerifyEmail,
};
