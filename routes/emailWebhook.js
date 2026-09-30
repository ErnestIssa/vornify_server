const express = require('express');
const emailEvents = require('../email/emailEvents');
const { verifySendGridWebhook } = require('../lib/sendgridWebhookVerify');

const router = express.Router();

/** POST /api/email/webhooks/sendgrid — SendGrid Event Webhook (delivery, bounce, etc.) */
router.post(
  '/sendgrid',
  express.raw({ type: ['application/json', '*/json'] }),
  async (req, res) => {
    try {
      const rawBody = req.body;
      if (!rawBody || !rawBody.length) {
        return res.status(400).json({ success: false, error: 'Empty payload' });
      }

      const signature = req.headers['x-twilio-email-event-webhook-signature'];
      const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'];
      const verified = verifySendGridWebhook({ rawBody, signature, timestamp });
      if (!verified.ok && !verified.skipped) {
        return res.status(401).json({ success: false, error: verified.error || 'Unauthorized' });
      }

      let events;
      try {
        events = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid JSON' });
      }

      const summary = await emailEvents.ingestSendGridEvents(events);
      return res.status(200).json({ success: true, ...summary, verified: !verified.skipped });
    } catch (err) {
      console.error('[email webhook]', err);
      return res.status(500).json({ success: false, error: 'Webhook processing failed' });
    }
  },
);

module.exports = router;
