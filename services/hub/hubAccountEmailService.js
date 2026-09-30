/**
 * Hub account & security emails — SendGrid dynamic templates only (SSOT: backend).
 */
const emailService = require('../emailService');
const {
  getHubTemplateId,
  isHubTemplateConfigured,
  hubEmailBaseData,
} = require('../../lib/hubAuthTemplates');

async function sendHubTemplate(templateKey, to, subject, dynamicData) {
  const templateId = getHubTemplateId(templateKey);
  if (!isHubTemplateConfigured(templateId)) {
    console.error(`[hub-email] Missing SendGrid template env for "${templateKey}"`);
    return { success: false, error: 'template_not_configured', templateKey };
  }
  const payload = hubEmailBaseData(dynamicData);
  const result = await emailService.sendCustomEmail(to, subject, templateId, payload);
  if (!result.success) {
    console.error(`[hub-email] Send failed (${templateKey}) → ${to}:`, result.error || result.details);
  }
  return result;
}

function customerName(name, email) {
  return (name && String(name).trim()) || String(email || '').split('@')[0] || 'Member';
}

async function sendAccountWelcomeEmail(to, name) {
  return sendHubTemplate('accountWelcome', to, 'Welcome to Peak Mode', {
    customer_name: customerName(name, to),
  });
}

async function sendEmailVerificationEmail(to, name, verificationLink) {
  const link = String(verificationLink || '').trim();
  return sendHubTemplate('emailVerification', to, 'Verify your email', {
    customer_name: customerName(name, to),
    verification_link: link,
    verification_url: link,
    verify_link: link,
    confirm_link: link,
    action_url: link,
  });
}

async function sendPasswordResetEmail(to, resetLink) {
  return sendHubTemplate('passwordReset', to, 'Password reset', {
    reset_link: resetLink,
    resetLink: resetLink,
    reset_url: resetLink,
    password_reset_link: resetLink,
    expiry_hours: 1,
  });
}

async function sendPasswordResetSuccessEmail(to, name) {
  return sendHubTemplate('passwordResetSuccess', to, 'Password updated', {
    customer_name: customerName(name, to),
  });
}

async function sendPasswordChangedEmail(to, name) {
  return sendHubTemplate('passwordChanged', to, 'Password changed', {
    customer_name: customerName(name, to),
  });
}

async function sendNewLoginEmail(to, name, context) {
  return sendHubTemplate('newLogin', to, 'New sign-in', {
    customer_name: customerName(name, to),
    login_time: context?.at,
    login_ip: context?.ip,
    device_info: context?.userAgent,
  });
}

async function sendSuspiciousLoginEmail(to, name, context) {
  return sendHubTemplate('suspiciousLogin', to, 'Suspicious sign-in', {
    customer_name: customerName(name, to),
    login_time: context?.at,
    login_ip: context?.ip,
    device_info: context?.userAgent,
  });
}

async function sendLoginBlockedEmail(to, name) {
  return sendHubTemplate('loginBlocked', to, 'Sign-in blocked', {
    customer_name: customerName(name, to),
  });
}

async function sendEmailChangeConfirmationEmail(to, name, confirmLink, newEmail) {
  return sendHubTemplate('emailChangeConfirmation', to, 'Confirm email change', {
    customer_name: customerName(name, to),
    confirmation_link: confirmLink,
    new_email: newEmail,
  });
}

async function sendEmailChangedEmail(to, name, newEmail) {
  return sendHubTemplate('emailChanged', to, 'Email updated', {
    customer_name: customerName(name, to),
    new_email: newEmail,
  });
}

async function sendGoogleConnectedEmail(to, name) {
  return sendHubTemplate('googleConnected', to, 'Google connected', {
    customer_name: customerName(name, to),
  });
}

async function sendGoogleDisconnectedEmail(to, name) {
  return sendHubTemplate('googleDisconnected', to, 'Google disconnected', {
    customer_name: customerName(name, to),
  });
}

async function sendMfaEnabledEmail(to, name) {
  return sendHubTemplate('mfaEnabled', to, 'MFA enabled', {
    customer_name: customerName(name, to),
  });
}

async function sendMfaDisabledEmail(to, name) {
  return sendHubTemplate('mfaDisabled', to, 'MFA disabled', {
    customer_name: customerName(name, to),
  });
}

async function sendAccountRecoveryEmail(to, name, recoveryLink) {
  return sendHubTemplate('accountRecovery', to, 'Account recovery', {
    customer_name: customerName(name, to),
    recovery_link: recoveryLink,
  });
}

async function sendAccountDeletedEmail(to, name) {
  return sendHubTemplate('accountDeleted', to, 'Account deleted', {
    customer_name: customerName(name, to),
  });
}

async function sendHubWelcomePostVerifyEmail(to, name, hubUrl) {
  return sendHubTemplate('hubWelcomePostVerify', to, 'Welcome to Peak Mode Hub', {
    customer_name: customerName(name, to),
    hub_url: hubUrl,
  });
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
