const { getDefinition, resolveProviderTemplateId, isPlaceholderTemplateId } = require('./emailDefinitions');
const { validateEmailJob } = require('./emailValidator');
const emailStore = require('./emailStore');
const { STATUS } = require('./emailTypes');

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000, 1_800_000];

async function enqueue({
  emailType,
  recipient,
  payload,
  idempotencyKey,
  correlationId,
  userId,
  scheduledAt,
}) {
  const validation = validateEmailJob({ emailType, recipient, payload });
  if (!validation.valid) {
    return { ok: false, error: validation.error, details: validation, queued: false };
  }

  const def = getDefinition(emailType);
  const deliveryMode = def.deliveryMode || 'template';
  let templateId = null;
  if (deliveryMode === 'template') {
    templateId = resolveProviderTemplateId(emailType, {
      language: payload?.language,
    });
    if (isPlaceholderTemplateId(templateId)) {
      return { ok: false, error: 'TEMPLATE_NOT_CONFIGURED', emailType, queued: false };
    }
  }

  if (idempotencyKey) {
    const existing = await emailStore.findByIdempotencyKey(idempotencyKey);
    if (existing && existing.status !== STATUS.FAILED && existing.status !== STATUS.DEAD_LETTER) {
      return {
        ok: true,
        duplicate: true,
        message: existing,
        emailId: existing.emailId,
        status: existing.status,
      };
    }
  }

  const now = new Date().toISOString();
  const emailId = emailStore.newEmailId();
  const language = payload?.language || 'en';
  const doc = {
    emailId,
    communicationId: emailId,
    emailType,
    communicationType: emailType,
    channel: 'email',
    language,
    category: def.category,
    priority: def.priority,
    recipient: String(recipient).trim().toLowerCase(),
    userId: userId || null,
    correlationId: correlationId || null,
    idempotencyKey: idempotencyKey || null,
    subject: validation.subject,
    templateKey: emailType,
    templateVersion: 1,
    provider: 'sendgrid',
    deliveryMode,
    providerTemplateId: templateId,
    payload,
    status: STATUS.QUEUED,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    scheduledAt: scheduledAt || now,
    createdAt: now,
    updatedAt: now,
    queuedAt: now,
    events: [{ type: STATUS.QUEUED, at: now }],
  };

  const created = await emailStore.createMessage(doc);
  if (!created) {
    return { ok: false, error: 'OUTBOX_WRITE_FAILED', queued: false };
  }

  return { ok: true, duplicate: false, message: doc, emailId, status: STATUS.QUEUED };
}

function nextRetryAt(attempts) {
  const idx = Math.min(attempts, RETRY_DELAYS_MS.length - 1);
  const base = RETRY_DELAYS_MS[idx];
  const jitter = Math.floor(Math.random() * Math.min(15_000, base * 0.2));
  return new Date(Date.now() + base + jitter).toISOString();
}

module.exports = {
  enqueue,
  nextRetryAt,
  MAX_ATTEMPTS,
};
