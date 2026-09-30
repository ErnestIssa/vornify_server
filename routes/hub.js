const express = require('express');
const router = express.Router();
const authenticateMember = require('../middleware/authenticateMember');
const hubIdentity = require('../services/hub/hubIdentityService');
const hubAccountSecurityRoutes = require('./hubAccountSecurity');
const hubVerificationEmail = require('../services/hub/hubVerificationEmail');

/**
 * POST /api/hub/auth/check-email
 * Two-step login: determine next screen (password | register | verify_email).
 */
router.use('/account', hubAccountSecurityRoutes);

router.post('/auth/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await hubIdentity.checkEmailStep(email);
    if (result.step === 'invalid') {
      return res.status(400).json({ success: false, error: 'Enter a valid email address' });
    }
    const { existingCustomer, ...publicResult } = result;
    let verificationEmailSent;
    if (publicResult.step === 'verify_email') {
      const delivery = await hubVerificationEmail.sendVerificationEmail({
        email,
        fallbackOrigin: req.headers.origin,
      });
      verificationEmailSent = delivery.sent;
      if (!delivery.sent && delivery.reason === 'rate_limited') {
        verificationEmailSent = 'rate_limited';
      }
    }
    res.json({
      success: true,
      ...publicResult,
      ...(verificationEmailSent !== undefined ? { verificationEmailSent } : {}),
    });
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

const notificationService = require('../notifications/notificationService');

router.get('/notifications', authenticateMember, async (req, res) => {
  try {
    const userId = req.hubAuth?.userId || req.hubAuth?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const unreadOnly = req.query.unread === 'true';
    const notifications = await notificationService.listForUser(userId, {
      limit: parseInt(req.query.limit || '50', 10),
      unreadOnly,
    });
    res.json({ success: true, notifications });
  } catch (err) {
    console.error('[hub notifications list]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/notifications/:notificationId/read', authenticateMember, async (req, res) => {
  try {
    const userId = req.hubAuth?.userId || req.hubAuth?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    await notificationService.markNotificationRead(req.params.notificationId, userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[hub notifications read]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/notifications/read-all', authenticateMember, async (req, res) => {
  try {
    const userId = req.hubAuth?.userId || req.hubAuth?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    await notificationService.markAllNotificationsRead(userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[hub notifications read-all]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
