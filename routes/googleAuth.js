const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const hubIdentity = require('../services/hub/hubIdentityService');
const googleOAuth = require('../services/googleOAuthService');
const googleAuthUser = require('../services/googleAuthUserService');
const { authFail, authOk, CODES } = require('../lib/authResponse');

function generateAuthToken(userId, email) {
  const payload = { userId, email, timestamp: Date.now() };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function frontendBase() {
  return (process.env.FRONTEND_URL || 'https://peakmode.se').replace(/\/$/, '');
}

function redirectAuthError(code, message) {
  const params = new URLSearchParams({ google_error: code, google_message: message });
  return `${frontendBase()}/hub/auth?${params.toString()}`;
}

router.get('/google/status', (req, res) => {
  return authOk(res, { enabled: googleOAuth.isGoogleOAuthConfigured() });
});

router.get('/google', (req, res) => {
  try {
    if (!googleOAuth.isGoogleOAuthConfigured()) {
      return res.redirect(redirectAuthError('not_configured', 'Google sign-in is not available yet.'));
    }
    const returnTo = googleOAuth.sanitizeReturnTo(req.query.returnTo);
    const url = googleOAuth.buildGoogleAuthUrl({ returnTo });
    return res.redirect(url);
  } catch (err) {
    console.error('Google OAuth start error:', err);
    return res.redirect(redirectAuthError('start_failed', 'Could not start Google sign-in.'));
  }
});

router.get('/google/callback', async (req, res) => {
  try {
    if (!googleOAuth.isGoogleOAuthConfigured()) {
      return res.redirect(redirectAuthError('not_configured', 'Google sign-in is not configured.'));
    }

    const { code, state, error } = req.query;
    if (error) {
      return res.redirect(redirectAuthError('denied', 'Google sign-in was cancelled.'));
    }
    if (!code || !state) {
      return res.redirect(redirectAuthError('invalid_callback', 'Invalid Google sign-in response.'));
    }

    const statePayload = googleOAuth.verifyOAuthState(String(state));
    if (!statePayload) {
      return res.redirect(redirectAuthError('invalid_state', 'Sign-in session expired. Try again.'));
    }

    const googleProfile = await googleOAuth.exchangeCodeForUser(String(code));
    const user = await googleAuthUser.upsertUserFromGoogle(googleProfile);
    const authToken = generateAuthToken(user._id || user.email, user.email);
    const hubSession = await hubIdentity.provisionForAuthenticatedUser(user);

    const exchangeCode = await googleAuthUser.createLoginExchangeCode({
      returnTo: statePayload.returnTo,
      authToken,
      user: {
        email: user.email,
        name: user.name,
        isVerified: true,
      },
      member: hubSession.member,
      profile: hubSession.profile,
      onboardingComplete: hubSession.onboardingComplete,
    });

    const params = new URLSearchParams({ google_exchange: exchangeCode });
    return res.redirect(`${frontendBase()}/hub/auth?${params.toString()}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.redirect(
      redirectAuthError('callback_failed', 'Something went wrong signing in with Google.'),
    );
  }
});

router.post('/google/exchange', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'Missing sign-in code.');
    }

    const payload = await googleAuthUser.consumeLoginExchangeCode(String(code).trim());
    if (!payload) {
      return authFail(
        res,
        400,
        CODES.VALIDATION_ERROR,
        'This sign-in link has expired. Try Google sign-in again.',
      );
    }

    return authOk(res, {
      returnTo: payload.returnTo,
      authToken: payload.authToken,
      token: payload.authToken,
      user: payload.user,
      member: payload.member,
      profile: payload.profile,
      onboardingComplete: payload.onboardingComplete,
    });
  } catch (err) {
    console.error('Google exchange error:', err);
    return authFail(res, 500, CODES.INTERNAL_ERROR, 'Something went wrong. Please try again.');
  }
});

module.exports = router;
