/**
 * Hub account emails → Peak Mode email orchestrator (outbox + SendGrid provider).
 */
const crypto = require('crypto');
const orchestrator = require('../../communications/communicationOrchestrator');
const { resolveHubEmailLanguage } = require('../../lib/resolveHubEmailLanguage');

function customerName(name, email) {
  return (name && String(name).trim()) || String(email || '').split('@')[0] || 'Member';
}

function hashKey(part) {
  return crypto.createHash('sha256').update(String(part)).digest('hex').slice(0, 16);
}

async function sendLegacy(legacyHubKey, to, payload, options = {}) {
  const { emailTypeFromLegacyHubKey } = require('../../email/emailDefinitions');
  const emailType = emailTypeFromLegacyHubKey(legacyHubKey);
  if (!emailType) {
    return { success: false, error: 'UNKNOWN_LEGACY_HUB_EMAIL', legacyHubKey };
  }
  const language = resolveHubEmailLanguage({ ...options, email: to });
  return orchestrator.schedule({
    communicationType: emailType,
    channel: 'email',
    recipient: to,
    payload: {
      ...payload,
      language,
      fallbackOrigin: options.fallbackOrigin,
      email: to,
      recipient: to,
    },
    context: { language, ...(options.context || {}) },
    idempotencyKey: options.idempotencyKey,
    correlationId: options.correlationId,
    userId: options.userId || options.user?.id || options.user?._id,
    processImmediately: options.processImmediately !== false,
  });
}

async function sendAccountWelcomeEmail(to, name, options = {}) {
  return sendLegacy(
    'accountWelcome',
    to,
    { customer_name: customerName(name, to) },
    {
      ...options,
      idempotencyKey: options.idempotencyKey || `hub-welcome-reg:${hashKey(to)}`,
    },
  );
}

async function sendEmailVerificationEmail(to, name, verificationLink, options = {}) {
  const link = String(verificationLink || '').trim();
  return sendLegacy(
    'emailVerification',
    to,
    {
      customer_name: customerName(name, to),
      verificationUrl: link,
    },
    {
      ...options,
      idempotencyKey:
        options.idempotencyKey || `hub-verify:${hashKey(to)}:${hashKey(link)}`,
    },
  );
}

async function sendPasswordResetEmail(to, resetLink, options = {}) {
  const link = String(resetLink || '').trim();
  return sendLegacy(
    'passwordReset',
    to,
    { resetUrl: link, expiry_hours: 1 },
    {
      ...options,
      idempotencyKey: options.idempotencyKey || `hub-reset:${hashKey(to)}:${hashKey(link)}`,
    },
  );
}

async function sendPasswordResetSuccessEmail(to, name, options = {}) {
  const eventPart = options.correlationId || options.securityEventId || hashKey(to);
  return sendLegacy(
    'passwordResetSuccess',
    to,
    { customer_name: customerName(name, to) },
    {
      ...options,
      idempotencyKey: options.idempotencyKey || `hub-reset-ok:${hashKey(eventPart)}`,
    },
  );
}

async function sendPasswordChangedEmail(to, name, options = {}) {
  const eventPart = options.correlationId || options.securityEventId || hashKey(to);
  return sendLegacy(
    'passwordChanged',
    to,
    { customer_name: customerName(name, to) },
    {
      ...options,
      idempotencyKey: options.idempotencyKey || `hub-pwd-changed:${hashKey(to)}:${hashKey(eventPart)}`,
    },
  );
}

async function sendNewLoginEmail(to, name, context, options = {}) {
  return sendLegacy(
    'newLogin',
    to,
    {
      customer_name: customerName(name, to),
      login_time: context?.at,
      login_ip: context?.ip,
      device_info: context?.userAgent,
    },
    {
      ...options,
      idempotencyKey:
        options.idempotencyKey ||
        `hub-new-login:${hashKey(to)}:${hashKey(context?.sessionKey || context?.at || '')}`,
    },
  );
}

async function sendSuspiciousLoginEmail(to, name, context, options = {}) {
  return sendLegacy(
    'suspiciousLogin',
    to,
    {
      customer_name: customerName(name, to),
      login_time: context?.at,
      login_ip: context?.ip,
      device_info: context?.userAgent,
    },
    {
      ...options,
      idempotencyKey:
        options.idempotencyKey ||
        `hub-suspicious:${hashKey(to)}:${hashKey(context?.sessionKey || context?.at || '')}`,
    },
  );
}

async function sendLoginBlockedEmail(to, name, options = {}) {
  const lockPart = options.correlationId || options.securityEventId || 'lock';
  return sendLegacy(
    'loginBlocked',
    to,
    { customer_name: customerName(name, to) },
    {
      ...options,
      idempotencyKey: options.idempotencyKey || `hub-blocked:${hashKey(to)}:${hashKey(lockPart)}`,
    },
  );
}

async function sendEmailChangeConfirmationEmail(to, name, confirmLink, newEmail, options = {}) {
  return sendLegacy(
    'emailChangeConfirmation',
    to,
    {
      customer_name: customerName(name, to),
      confirmationUrl: confirmLink,
      new_email: newEmail,
    },
    {
      ...options,
      idempotencyKey:
        options.idempotencyKey || `hub-email-change:${hashKey(newEmail)}:${hashKey(confirmLink)}`,
    },
  );
}

async function sendEmailChangedEmail(to, name, newEmail, options = {}) {
  return sendLegacy(
    'emailChanged',
    to,
    { customer_name: customerName(name, to), new_email: newEmail },
    {
      ...options,
      idempotencyKey: options.idempotencyKey || `hub-email-changed:${hashKey(to)}:${hashKey(newEmail)}`,
    },
  );
}

async function sendGoogleConnectedEmail(to, name, options = {}) {
  return sendLegacy(
    'googleConnected',
    to,
    { customer_name: customerName(name, to) },
    { ...options, idempotencyKey: options.idempotencyKey || `hub-google-on:${hashKey(to)}` },
  );
}

async function sendGoogleDisconnectedEmail(to, name, options = {}) {
  const eventPart = options.correlationId || options.securityEventId || hashKey(to);
  return sendLegacy(
    'googleDisconnected',
    to,
    { customer_name: customerName(name, to) },
    {
      ...options,
      idempotencyKey: options.idempotencyKey || `hub-google-off:${hashKey(to)}:${hashKey(eventPart)}`,
    },
  );
}

async function sendMfaEnabledEmail(to, name, options = {}) {
  return sendLegacy(
    'mfaEnabled',
    to,
    { customer_name: customerName(name, to) },
    { ...options, idempotencyKey: options.idempotencyKey || `hub-mfa-on:${hashKey(to)}` },
  );
}

async function sendMfaDisabledEmail(to, name, options = {}) {
  return sendLegacy(
    'mfaDisabled',
    to,
    { customer_name: customerName(name, to) },
    { ...options, idempotencyKey: options.idempotencyKey || `hub-mfa-off:${hashKey(to)}` },
  );
}

async function sendAccountRecoveryEmail(to, name, recoveryLink, options = {}) {
  const requestedAt = options.requestedAt || new Date().toISOString();
  return sendLegacy(
    'accountRecovery',
    to,
    {
      customer_name: customerName(name, to),
      recoveryUrl: recoveryLink,
      request_date: requestedAt,
      recovery_requested_at: requestedAt,
    },
    {
      ...options,
      idempotencyKey:
        options.idempotencyKey || `hub-recovery:${hashKey(to)}:${hashKey(recoveryLink)}`,
    },
  );
}

async function sendAccountDeletedEmail(to, name, options = {}) {
  return sendLegacy(
    'accountDeleted',
    to,
    { customer_name: customerName(name, to) },
    { ...options, idempotencyKey: options.idempotencyKey || `hub-deleted:${hashKey(to)}` },
  );
}

async function sendHubWelcomePostVerifyEmail(to, name, hubUrl, options = {}) {
  const link = String(hubUrl || '').trim();
  return sendLegacy(
    'hubWelcomePostVerify',
    to,
    { customer_name: customerName(name, to), hubUrl: link },
    {
      ...options,
      idempotencyKey: options.idempotencyKey || `hub-welcome-verified:${hashKey(to)}`,
    },
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
