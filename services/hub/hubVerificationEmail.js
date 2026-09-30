const crypto = require('crypto');
const getDBInstance = require('../../vornifydb/dbInstance');
const hubIdentity = require('./hubIdentityService');
const hubAccountEmail = require('./hubAccountEmailService');

const db = getDBInstance();
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

const { buildHubVerificationUrl } = require('../../email/emailUrls');

function buildVerificationLink({ token, email, fallbackOrigin }) {
  return buildHubVerificationUrl({ token, email, fallbackOrigin });
}

function canSendVerificationNow(user) {
  if (!user || user.isVerified) return { allowed: false, reason: 'verified_or_missing' };
  const lastSent = user.lastVerificationSentAt ? new Date(user.lastVerificationSentAt) : null;
  if (lastSent && Date.now() - lastSent.getTime() < RESEND_COOLDOWN_MS) {
    return { allowed: false, reason: 'rate_limited' };
  }
  return { allowed: true };
}

/**
 * Create a fresh token if needed, send verification via SendGrid, return delivery status.
 */
async function sendVerificationEmail({ email, user, fallbackOrigin, forceNewToken = false }) {
  const normalized = hubIdentity.normalizeEmail(email);
  if (!normalized) {
    return { sent: false, reason: 'invalid_email' };
  }

  let account = user || (await hubIdentity.findUserByEmail(normalized));
  if (!account) {
    return { sent: false, reason: 'no_account' };
  }
  if (account.isVerified) {
    return { sent: false, reason: 'already_verified' };
  }

  const gate = canSendVerificationNow(account);
  if (!gate.allowed && !forceNewToken) {
    return { sent: false, reason: gate.reason };
  }

  const verificationToken = forceNewToken ? generateToken() : account.verificationToken || generateToken();
  const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const verificationLink = buildVerificationLink({
    token: verificationToken,
    email: normalized,
    fallbackOrigin,
  });

  const mailResult = await hubAccountEmail.sendEmailVerificationEmail(
    normalized,
    account.name,
    verificationLink,
    { fallbackOrigin },
  );

  if (!mailResult.success && !mailResult.providerAccepted) {
    console.error('[hub-verification-email] Email job failed:', mailResult.error, mailResult.status);
    return { sent: false, reason: 'send_failed', error: mailResult.error, status: mailResult.status };
  }

  await db.executeOperation({
    database_name: 'peakmode',
    collection_name: 'users',
    command: '--update',
    data: {
      filter: { email: normalized },
      update: {
        verificationToken,
        verificationExpiry,
        lastVerificationSentAt: now,
        updatedAt: now,
      },
    },
  });

  return {
    sent: true,
    providerAccepted: Boolean(mailResult.providerAccepted ?? mailResult.success),
    emailId: mailResult.emailId,
    status: mailResult.status,
    messageId: mailResult.providerMessageId,
  };
}

module.exports = {
  sendVerificationEmail,
  canSendVerificationNow,
  buildVerificationLink,
  RESEND_COOLDOWN_MS,
};
