const crypto = require('crypto');
const getDBInstance = require('../../vornifydb/dbInstance');
const hubIdentity = require('./hubIdentityService');
const hubAccountEmail = require('./hubAccountEmailService');

const db = getDBInstance();
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function buildVerificationLink({ token, email, fallbackOrigin }) {
  const base =
    process.env.STOREFRONT_URL ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_STORE_URL ||
    fallbackOrigin ||
    'https://peakmode.se';
  const origin = String(base).trim().replace(/\/+$/, '') || 'https://peakmode.se';
  return `${origin}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
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

  if (!mailResult.success) {
    console.error('[hub-verification-email] SendGrid send failed:', mailResult.error, mailResult.details);
    return { sent: false, reason: 'send_failed', error: mailResult.error };
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

  return { sent: true, messageId: mailResult.messageId };
}

module.exports = {
  sendVerificationEmail,
  canSendVerificationNow,
  buildVerificationLink,
  RESEND_COOLDOWN_MS,
};
