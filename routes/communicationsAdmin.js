const express = require('express');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { requirePermission } = require('../middleware/requirePermission');
const communicationStore = require('../communications/communicationStore');
const { STATUS } = require('../communications/communicationTypes');
const { listCommunicationDefinitionsForDiagnostics } = require('../communications/communicationDefinitions');
const { previewCommunicationType } = require('../email/templatePreview');
const emailWorker = require('../email/emailWorker');
const { STATUS: EMAIL_STATUS } = require('../email/emailTypes');

const router = express.Router();

router.get('/definitions', authenticateAdmin, requirePermission('email.view'), (req, res) => {
  res.json({ success: true, definitions: listCommunicationDefinitionsForDiagnostics() });
});

router.get('/messages', authenticateAdmin, requirePermission('email.view'), async (req, res) => {
  try {
    const { limit = 50, offset = 0, status, communicationType, recipient, correlationId } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (communicationType && communicationType !== 'all') {
      filter.$or = [{ communicationType }, { emailType: communicationType }];
    }
    if (recipient) filter.recipient = String(recipient).trim().toLowerCase();
    if (correlationId) filter.correlationId = correlationId;

    const { total, items } = await communicationStore.queryMessages({
      filter,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    res.json({ success: true, messages: items, total, limit: parseInt(limit, 10), offset: parseInt(offset, 10) });
  } catch (err) {
    console.error('[communications/messages]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/messages/:communicationId', authenticateAdmin, requirePermission('email.view'), async (req, res) => {
  const msg = await communicationStore.findById(req.params.communicationId);
  if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, message: msg });
});

router.post('/messages/:communicationId/retry', authenticateAdmin, requirePermission('email.view'), async (req, res) => {
  const msg = await communicationStore.findById(req.params.communicationId);
  if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
  if (![STATUS.FAILED, STATUS.DEAD_LETTER, STATUS.DEFERRED].includes(msg.status)) {
    return res.status(400).json({ success: false, error: 'Message not in retriable state' });
  }
  await communicationStore.updateMessage(msg.emailId, {
    status: EMAIL_STATUS.QUEUED,
    scheduledAt: new Date().toISOString(),
    lastError: null,
  });
  const processed = await emailWorker.processMessageById(msg.emailId);
  res.json({ success: true, processed });
});

router.get('/stats', authenticateAdmin, requirePermission('email.view'), async (req, res) => {
  const { items } = await communicationStore.queryMessages({ limit: 5000, offset: 0 });
  const stats = {
    total: items.length,
    queued: items.filter((m) => m.status === STATUS.QUEUED).length,
    acceptedByProvider: items.filter((m) => m.status === STATUS.ACCEPTED).length,
    delivered: items.filter((m) => m.status === STATUS.DELIVERED).length,
    deferred: items.filter((m) => m.status === STATUS.DEFERRED).length,
    failed: items.filter((m) => m.status === STATUS.FAILED || m.status === STATUS.DEAD_LETTER).length,
    bounced: items.filter((m) => m.status === STATUS.BOUNCED).length,
  };
  res.json({ success: true, stats });
});

router.get('/templates/:communicationType/preview', authenticateAdmin, requirePermission('email.view'), (req, res) => {
  const preview = previewCommunicationType(req.params.communicationType);
  res.json({ success: preview.ok, preview });
});

module.exports = router;
