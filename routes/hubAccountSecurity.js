/**
 * Hub member account & security actions (SSOT). Security emails via communicationOrchestrator (no provider here).
 */
const express = require('express');
const crypto = require('crypto');
const getDBInstance = require('../vornifydb/dbInstance');
const authenticateMember = require('../middleware/authenticateMember');
const hubIdentity = require('../services/hub/hubIdentityService');
const hubAccountEmail = require('../services/hub/hubAccountEmailService');
const { hubMailOptions } = require('../lib/hubMailContext');
const { normalizeEmail, authFail, authOk, CODES } = require('../lib/authResponse');
const { getStorefrontOrigin } = require('../lib/authMailLinks');

const router = express.Router();
const db = getDBInstance();

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function updateUserByEmail(email, update) {
  return db.executeOperation({
    database_name: 'peakmode',
    collection_name: 'users',
    command: '--update',
    data: { filter: { email }, update: { ...update, updatedAt: new Date().toISOString() } },
  });
}

/** POST /api/hub/account/change-password */
router.post('/change-password', authenticateMember, async (req, res) => {
  try {
    if (req.hubAuth.dev) {
      return authOk(res, { message: 'Password updated.' });
    }

    const email = req.hubAuth.email;
    const user = req.hubAuth.user;
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter your current and new password.');
    }
    if (String(newPassword).length < 8) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'Password must be at least 8 characters.');
    }
    if (hashPassword(currentPassword) !== user.password) {
      return authFail(res, 401, CODES.AUTHENTICATION_FAILED, 'Current password is incorrect.');
    }

    const passwordChangedAt = new Date().toISOString();
    const result = await updateUserByEmail(email, {
      password: hashPassword(newPassword),
      passwordUserSet: true,
      security: {
        ...(user.security || {}),
        passwordChangedAt,
        failedLoginCount: 0,
        lockedUntil: null,
        lockReason: null,
      },
    });

    if (!result.success) {
      return authFail(res, 500, CODES.INTERNAL_ERROR, 'Could not update password.');
    }

    await hubAccountEmail.sendPasswordChangedEmail(email, user.name, {
      ...hubMailOptions(req, user),
      correlationId: passwordChangedAt,
    });
    return authOk(res, { message: 'Password updated.' });
  } catch (err) {
    console.error('[hub change-password]', err);
    return authFail(res, 500, CODES.INTERNAL_ERROR, 'Something went wrong.');
  }
});

/** POST /api/hub/account/request-email-change */
router.post('/request-email-change', authenticateMember, async (req, res) => {
  try {
    if (req.hubAuth.dev) {
      return authOk(res, { message: 'If that address is valid, we sent a confirmation link.' });
    }

    const email = req.hubAuth.email;
    const user = req.hubAuth.user;
    const newEmail = normalizeEmail(req.body?.newEmail);
    if (!newEmail) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter a valid email address.');
    }
    if (newEmail === email) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'That is already your email address.');
    }

    const taken = await hubIdentity.findUserByEmail(newEmail);
    if (taken) {
      return authFail(res, 409, CODES.ACCOUNT_EXISTS, 'That email is already in use.');
    }

    const token = generateToken();
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await updateUserByEmail(email, {
      pendingEmail: newEmail,
      emailChangeToken: token,
      emailChangeExpiry: expiry,
    });

    const origin = getStorefrontOrigin(req.headers.origin);
    const confirmLink = `${origin}/hub/auth?email_change=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    await hubAccountEmail.sendEmailChangeConfirmationEmail(newEmail, user.name, confirmLink, newEmail, {
      ...hubMailOptions(req, user),
    });

    return authOk(res, { message: 'If that address is valid, we sent a confirmation link.' });
  } catch (err) {
    console.error('[hub request-email-change]', err);
    return authFail(res, 500, CODES.INTERNAL_ERROR, 'Something went wrong.');
  }
});

/** POST /api/hub/account/confirm-email-change */
router.post('/confirm-email-change', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const token = String(req.body?.token || '').trim();
    if (!email || !token) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'Invalid confirmation link.');
    }

    const user = await hubIdentity.findUserByEmailAndFields(email, { emailChangeToken: token });
    if (!user || !user.pendingEmail) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'This confirmation link is no longer valid.');
    }
    if (user.emailChangeExpiry && new Date() > new Date(user.emailChangeExpiry)) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'This confirmation link has expired.');
    }

    const newEmail = normalizeEmail(user.pendingEmail);
    const oldEmail = user.email;

    const result = await db.executeOperation({
      database_name: 'peakmode',
      collection_name: 'users',
      command: '--update',
      data: {
        filter: { email: oldEmail },
        update: {
          email: newEmail,
          pendingEmail: null,
          emailChangeToken: null,
          emailChangeExpiry: null,
          updatedAt: new Date().toISOString(),
        },
      },
    });

    if (!result.success) {
      return authFail(res, 500, CODES.INTERNAL_ERROR, 'Could not update email.');
    }

    await Promise.all([
      hubAccountEmail.sendEmailChangedEmail(newEmail, user.name, newEmail, hubMailOptions(req, user)),
      hubAccountEmail.sendEmailChangedEmail(oldEmail, user.name, newEmail, hubMailOptions(req, user)),
    ]);

    return authOk(res, { message: 'Your email address has been updated.', email: newEmail });
  } catch (err) {
    console.error('[hub confirm-email-change]', err);
    return authFail(res, 500, CODES.INTERNAL_ERROR, 'Something went wrong.');
  }
});

/** POST /api/hub/account/recovery/complete — set new password from account recovery email link */
router.post('/recovery/complete', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const token = String(req.body?.token || req.body?.recovery || '').trim();
    const newPassword = req.body?.newPassword;

    if (!email || !token || !newPassword) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter a valid recovery link and password.');
    }
    if (String(newPassword).length < 8) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'Password must be at least 8 characters.');
    }

    const user = await hubIdentity.findUserByEmailAndFields(email, { recoveryToken: token });
    if (!user) {
      return authFail(
        res,
        400,
        CODES.VALIDATION_ERROR,
        'This recovery link is no longer valid. Request a new one.',
      );
    }
    if (user.recoveryExpiry && new Date() > new Date(user.recoveryExpiry)) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'This recovery link has expired. Request a new one.');
    }

    const sec = user.security || {};
    const passwordChangedAt = new Date().toISOString();
    const result = await updateUserByEmail(email, {
      password: hashPassword(newPassword),
      passwordUserSet: true,
      recoveryToken: null,
      recoveryExpiry: null,
      resetToken: null,
      resetExpiry: null,
      security: {
        ...sec,
        failedLoginCount: 0,
        lockedUntil: null,
        lockReason: null,
        passwordChangedAt,
      },
    });

    if (!result.success) {
      return authFail(res, 500, CODES.INTERNAL_ERROR, 'Could not update your password.');
    }

    await hubAccountEmail.sendPasswordResetSuccessEmail(email, user.name, {
      ...hubMailOptions(req, user),
      correlationId: passwordChangedAt,
    });

    return authOk(res, { message: 'Your password has been updated.' });
  } catch (err) {
    console.error('[hub recovery/complete]', err);
    return authFail(res, 500, CODES.INTERNAL_ERROR, 'Something went wrong.');
  }
});

/** POST /api/hub/account/recovery/request */
router.post('/recovery/request', async (req, res) => {
  const generic = 'If an account exists, we sent recovery instructions.';
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter a valid email address.');
    }

    const user = await hubIdentity.findUserByEmail(email);
    if (!user) {
      return authOk(res, { message: generic });
    }

    const token = generateToken();
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await updateUserByEmail(email, {
      recoveryToken: token,
      recoveryExpiry: expiry,
    });

    const origin = getStorefrontOrigin(req.headers.origin);
    const recoveryLink = `${origin}/hub/auth?recovery=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    await hubAccountEmail.sendAccountRecoveryEmail(email, user.name, recoveryLink, hubMailOptions(req, user));

    return authOk(res, { message: generic });
  } catch (err) {
    console.error('[hub recovery/request]', err);
    return authFail(res, 500, CODES.INTERNAL_ERROR, 'Something went wrong.');
  }
});

/** POST /api/hub/account/mfa/enable */
router.post('/mfa/enable', authenticateMember, async (req, res) => {
  try {
    if (req.hubAuth.dev) {
      return authOk(res, { message: 'MFA enabled.', mfaEnabled: true });
    }

    const email = req.hubAuth.email;
    const user = req.hubAuth.user;
    const { password } = req.body || {};
    if (!password || hashPassword(password) !== user.password) {
      return authFail(res, 401, CODES.AUTHENTICATION_FAILED, 'Confirm your password to enable MFA.');
    }

    await updateUserByEmail(email, {
      mfa: {
        ...(user.mfa || {}),
        enabled: true,
        enabledAt: new Date().toISOString(),
      },
    });

    await hubAccountEmail.sendMfaEnabledEmail(email, user.name, hubMailOptions(req, user));
    return authOk(res, { message: 'MFA enabled.', mfaEnabled: true });
  } catch (err) {
    console.error('[hub mfa enable]', err);
    return authFail(res, 500, CODES.INTERNAL_ERROR, 'Something went wrong.');
  }
});

/** POST /api/hub/account/mfa/disable */
router.post('/mfa/disable', authenticateMember, async (req, res) => {
  try {
    if (req.hubAuth.dev) {
      return authOk(res, { message: 'MFA disabled.', mfaEnabled: false });
    }

    const email = req.hubAuth.email;
    const user = req.hubAuth.user;
    const { password } = req.body || {};
    if (!password || hashPassword(password) !== user.password) {
      return authFail(res, 401, CODES.AUTHENTICATION_FAILED, 'Confirm your password to disable MFA.');
    }

    await updateUserByEmail(email, {
      mfa: {
        ...(user.mfa || {}),
        enabled: false,
        disabledAt: new Date().toISOString(),
      },
    });

    await hubAccountEmail.sendMfaDisabledEmail(email, user.name, hubMailOptions(req, user));
    return authOk(res, { message: 'MFA disabled.', mfaEnabled: false });
  } catch (err) {
    console.error('[hub mfa disable]', err);
    return authFail(res, 500, CODES.INTERNAL_ERROR, 'Something went wrong.');
  }
});

/** POST /api/hub/account/google/disconnect */
router.post('/google/disconnect', authenticateMember, async (req, res) => {
  try {
    if (req.hubAuth.dev) {
      return authOk(res, { message: 'Google account disconnected.' });
    }

    const email = req.hubAuth.email;
    const user = req.hubAuth.user;
    const providers = Array.isArray(user.authProviders) ? user.authProviders.filter((p) => p !== 'google') : [];
    const hasGoogle = (user.authProviders || []).includes('google') || user.googleId;
    if (!hasGoogle) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'No Google account is linked.');
    }
    if (providers.length === 0 && !user.passwordUserSet) {
      return authFail(
        res,
        400,
        CODES.VALIDATION_ERROR,
        'Set a password before disconnecting Google.',
      );
    }

    const disconnectedAt = new Date().toISOString();
    await updateUserByEmail(email, {
      googleId: null,
      authProviders: providers,
      updatedAt: disconnectedAt,
    });

    await hubAccountEmail.sendGoogleDisconnectedEmail(email, user.name, {
      ...hubMailOptions(req, user),
      correlationId: disconnectedAt,
    });
    return authOk(res, { message: 'Google account disconnected.' });
  } catch (err) {
    console.error('[hub google disconnect]', err);
    return authFail(res, 500, CODES.INTERNAL_ERROR, 'Something went wrong.');
  }
});

/** DELETE /api/hub/account */
router.delete('/', authenticateMember, async (req, res) => {
  try {
    if (req.hubAuth.dev) {
      return authOk(res, { message: 'Account deleted.' });
    }

    const email = req.hubAuth.email;
    const user = req.hubAuth.user;
    const { password, confirmEmail } = req.body || {};
    if (user.passwordUserSet) {
      if (!password || hashPassword(password) !== user.password) {
        return authFail(res, 401, CODES.AUTHENTICATION_FAILED, 'Confirm your password to delete your account.');
      }
    } else if (normalizeEmail(confirmEmail) !== email) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'Confirm your email address to delete your account.');
    }

    await hubAccountEmail.sendAccountDeletedEmail(email, user.name, hubMailOptions(req, user));

    await db.executeOperation({
      database_name: 'peakmode',
      collection_name: 'users',
      command: '--delete',
      data: { email },
    });

    return authOk(res, { message: 'Your Peak Mode account has been deleted.' });
  } catch (err) {
    console.error('[hub account delete]', err);
    return authFail(res, 500, CODES.INTERNAL_ERROR, 'Something went wrong.');
  }
});

module.exports = router;
