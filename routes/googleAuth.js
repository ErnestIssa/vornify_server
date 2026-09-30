const express = require('express');
const router = express.Router();
const hubIdentity = require('../services/hub/hubIdentityService');
const googleOAuth = require('../services/googleOAuthService');
const googleAuthUser = require('../services/googleAuthUserService');
const { authFail, authOk, CODES } = require('../lib/authResponse');

function generateAuthToken(userId, email) {
  const payload = { userId, email, timestamp: Date.now() };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

async function buildGoogleAuthResponse(user, returnTo) {
  const authToken = generateAuthToken(user._id || user.email, user.email);
  const hubSession = await hubIdentity.provisionForAuthenticatedUser(user);
  return {
    returnTo: googleOAuth.sanitizeReturnTo(returnTo),
    authToken,
    token: authToken,
    user: {
      email: user.email,
      name: user.name,
      isVerified: true,
    },
    member: hubSession.member,
    profile: hubSession.profile,
    onboardingComplete: hubSession.onboardingComplete,
  };
}

router.get('/google/status', (req, res) => {
  return authOk(res, {
    enabled: googleOAuth.isGoogleOAuthConfigured(),
    popup: true,
  });
});

/** Legacy server redirect — prefer POST /google/code from Hub popup flow. */
router.get('/google', (req, res) => {
  if (!googleOAuth.isGoogleOAuthConfigured()) {
    return authFail(
      res,
      503,
      CODES.SERVICE_UNAVAILABLE,
      'Google sign-in is not configured on the server.',
    );
  }
  try {
    const returnTo = googleOAuth.sanitizeReturnTo(req.query.returnTo);
    const url = googleOAuth.buildGoogleAuthUrl({ returnTo });
    return res.redirect(url);
  } catch (err) {
    console.error('Google OAuth start error:', err);
    return authFail(
      res,
      500,
      CODES.INTERNAL_ERROR,
      'Could not start Google sign-in.',
    );
  }
});

/** Popup / SPA: authorization code from @react-oauth/google (redirect_uri=postmessage). */
router.post('/google/code', async (req, res) => {
  try {
    if (!googleOAuth.isGoogleOAuthConfigured()) {
      return authFail(
        res,
        503,
        CODES.SERVICE_UNAVAILABLE,
        'Google sign-in is not configured on the server.',
      );
    }

    const { code, returnTo } = req.body || {};
    if (!code) {
      return authFail(res, 400, CODES.VALIDATION_ERROR, 'Missing Google authorization code.');
    }

    const googleProfile = await googleOAuth.exchangeCodeForUser(String(code), 'postmessage');
    const user = await googleAuthUser.upsertUserFromGoogle(googleProfile);
    const payload = await buildGoogleAuthResponse(user, returnTo);

    return authOk(res, payload);
  } catch (err) {
    console.error('Google OAuth code exchange error:', err);
    return authFail(
      res,
      400,
      CODES.AUTHENTICATION_FAILED,
      'Google sign-in could not be completed. Try again.',
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
