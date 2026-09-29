const express = require('express');
const router = express.Router();
const authenticateMember = require('../middleware/authenticateMember');
const hubIdentity = require('../services/hub/hubIdentityService');

/**
 * POST /api/hub/auth/check-email
 * Two-step login: determine next screen (password | register | verify_email).
 */
router.post('/auth/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await hubIdentity.checkEmailStep(email);
    if (result.step === 'invalid') {
      return res.status(400).json({ success: false, error: 'Enter a valid email address' });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[hub check-email]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/hub/me — current member session (SSOT after login).
 */
router.get('/me', authenticateMember, async (req, res) => {
  try {
    if (req.hubAuth.dev) {
      return res.json({
        success: true,
        user: { email: 'developer@peakmode.se', name: 'Developer', isVerified: true },
        member: {
          id: 'dev',
          email: 'developer@peakmode.se',
          status: 'active',
          membershipState: 'active',
          onboardingCompletedAt: new Date().toISOString(),
        },
        profile: {
          displayName: 'Developer',
          username: 'developer',
          interests: [],
          goals: [],
          privacy: { profileVisibility: 'members_only' },
        },
        onboardingComplete: true,
      });
    }

    const session = await hubIdentity.getSessionByEmail(req.hubAuth.email);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Session expired' });
    }

    res.json({
      success: true,
      ...session,
      onboardingComplete: session.onboardingComplete,
    });
  } catch (err) {
    console.error('[hub me]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/hub/onboarding — complete Hub onboarding (profile + privacy).
 */
router.post('/onboarding', authenticateMember, async (req, res) => {
  try {
    if (req.hubAuth.dev) {
      return res.json({ success: true, onboardingComplete: true });
    }

    const session = await hubIdentity.completeOnboarding(req.hubAuth.email, req.body || {});
    res.json({
      success: true,
      ...session,
      onboardingComplete: true,
    });
  } catch (err) {
    if (err.code === 'USERNAME_TAKEN') {
      return res.status(409).json({ success: false, error: 'That username is already taken' });
    }
    console.error('[hub onboarding]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
