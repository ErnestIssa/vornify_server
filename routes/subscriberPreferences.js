const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyUnsubscribeToken } = require('../lib/unsubscribeToken');
const marketing = require('../services/subscriberMarketingService');
const emailService = require('../services/emailService');
const { buildUnsubscribeUrl } = require('../email/emailUrls');
const { signUnsubscribeToken } = require('../lib/unsubscribeToken');

const router = express.Router();

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

const linkRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => marketing.normalizeEmail(req.body?.email) || req.ip,
});

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;
}

/** GET read-only — does not change state */
router.get('/preferences', publicLimiter, async (req, res) => {
  try {
    const token = req.query.token;
    const verified = token ? verifyUnsubscribeToken(String(token)) : { ok: false };
    if (!verified.ok) {
      return res.json({
        success: true,
        verified: false,
        message: marketing.NEUTRAL_MESSAGE,
      });
    }
    const view = await marketing.getPreferencesView(verified.email);
    return res.json({
      success: true,
      verified: true,
      maskedEmail: view.maskedEmail,
      unsubscribed: view.unsubscribed,
      preferences: view.preferences,
      language: view.language,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: marketing.NEUTRAL_MESSAGE });
  }
});

/**
 * POST /api/subscribers/unsubscribe
 * { token?, email?, scope: 'all' | { preferences }, reason?, source? }
 */
router.post('/unsubscribe', publicLimiter, async (req, res) => {
  try {
    const { token, email, scope, reason, source } = req.body || {};
    let resolvedEmail = null;
    if (token) {
      const v = verifyUnsubscribeToken(String(token));
      if (v.ok) resolvedEmail = v.email;
    }
    if (!resolvedEmail && email) {
      resolvedEmail = marketing.normalizeEmail(email);
    }
    if (!resolvedEmail) {
      return res.json({ success: true, message: marketing.NEUTRAL_MESSAGE });
    }

    const ip = clientIp(req);
    const src = source || (token ? 'page' : 'page_unverified');

    if (scope === 'all' || !scope || scope === 'ALL') {
      await marketing.applyUnsubscribeAll({
        email: resolvedEmail,
        reason,
        source: src,
        ip,
      });
      return res.json({ success: true, message: marketing.NEUTRAL_MESSAGE, scope: 'all' });
    }

    if (typeof scope === 'object' && scope !== null) {
      await marketing.applyPreferenceUpdate({
        email: resolvedEmail,
        preferences: scope,
        reason,
        source: src,
        ip,
      });
      return res.json({ success: true, message: marketing.NEUTRAL_MESSAGE, scope: 'partial' });
    }

    return res.json({ success: true, message: marketing.NEUTRAL_MESSAGE });
  } catch (err) {
    return res.status(500).json({ success: true, message: marketing.NEUTRAL_MESSAGE });
  }
});

/** RFC 8058 one-click — POST only, no redirect */
router.post('/unsubscribe/one-click', publicLimiter, async (req, res) => {
  try {
    const token = req.query.token || req.body?.token;
    if (!token) {
      return res.status(200).send('OK');
    }
    const v = verifyUnsubscribeToken(String(token));
    if (!v.ok) {
      return res.status(200).send('OK');
    }
    await marketing.applyUnsubscribeAll({
      email: v.email,
      source: 'one-click',
      ip: clientIp(req),
    });
    return res.status(200).send('OK');
  } catch {
    return res.status(200).send('OK');
  }
});

router.post('/resubscribe', publicLimiter, async (req, res) => {
  try {
    const { token, email, preferences } = req.body || {};
    let resolvedEmail = null;
    if (token) {
      const v = verifyUnsubscribeToken(String(token));
      if (v.ok) resolvedEmail = v.email;
    }
    if (!resolvedEmail && email) resolvedEmail = marketing.normalizeEmail(email);
    if (!resolvedEmail) {
      return res.json({ success: true, message: marketing.NEUTRAL_MESSAGE });
    }
    await marketing.applyResubscribe({
      email: resolvedEmail,
      source: 'page',
      ip: clientIp(req),
      preferences,
    });
    return res.json({ success: true, message: marketing.NEUTRAL_MESSAGE, resubscribed: true });
  } catch {
    return res.status(500).json({ success: true, message: marketing.NEUTRAL_MESSAGE });
  }
});

/** Direct visit — send signed link (rate limited). Honeypot: website field must be empty */
router.post('/unsubscribe-request-link', linkRequestLimiter, async (req, res) => {
  try {
    const { email, website } = req.body || {};
    if (website) {
      return res.json({ success: true, message: marketing.NEUTRAL_MESSAGE });
    }
    const normalized = marketing.normalizeEmail(email);
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return res.json({ success: true, message: marketing.NEUTRAL_MESSAGE });
    }
    const token = signUnsubscribeToken(normalized);
    const link = buildUnsubscribeUrl({ token });
    await emailService.sendTransactionalHtmlEmail(
      normalized,
      'Manage your Peak Mode email preferences',
      `<p>Click the link below to manage your email preferences or unsubscribe from marketing emails.</p><p><a href="${link}">Manage preferences</a></p><p>This link does not expire.</p>`,
      `Manage your preferences: ${link}`,
      { idempotencyKey: `unsub-link:${normalized}:${token.slice(-8)}` },
    );
    return res.json({ success: true, message: marketing.NEUTRAL_MESSAGE, linkSent: true });
  } catch {
    return res.json({ success: true, message: marketing.NEUTRAL_MESSAGE });
  }
});

module.exports = router;
