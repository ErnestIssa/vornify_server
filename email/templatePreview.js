const { getDefinition, resolveProviderTemplateId, resolveSubjectForJob } = require('./emailDefinitions');
const { validateEmailJob } = require('./emailValidator');
const { buildBrandUrls } = require('./emailUrls');
const emailWorker = require('./emailWorker');
const { isHttpsUrl } = require('./emailValidator');

const SAMPLE_PAYLOADS = {
  HUB_VERIFY_EMAIL: {
    customer_name: 'Alex',
    verificationUrl: 'https://peakmode.se/verify-email?token=sample&email=alex%40example.com',
  },
  ORDER_CONFIRMATION: {
    customer_name: 'Alex',
    order_number: 'PM-1001',
    order_status_url: 'https://peakmode.se/track-order?orderId=PM-1001',
    language: 'en',
  },
  PAYMENT_FAILED: {
    customer_name: 'Alex',
    order_number: 'PM-1001',
    retry_url: 'https://peakmode.se/checkout',
  },
  HUB_ACCOUNT_RECOVERY: {
    customer_name: 'Alex',
    recoveryUrl: 'https://peakmode.se/hub/auth?recovery=sample&email=alex%40example.com',
    request_date: new Date().toISOString(),
    language: 'en',
  },
};

function extractUrlFields(payload) {
  const urls = [];
  for (const [key, val] of Object.entries(payload || {})) {
    if (typeof val === 'string' && (key.includes('url') || key.includes('Url') || key.endsWith('_link'))) {
      urls.push({ field: key, value: val });
    }
  }
  return urls;
}

function previewCommunicationType(communicationType, payloadOverride) {
  const def = getDefinition(communicationType);
  if (!def) {
    return { ok: false, error: 'UNKNOWN_TYPE' };
  }
  const payload = {
    ...buildBrandUrls(),
    ...(SAMPLE_PAYLOADS[communicationType] || { customer_name: 'Peak Mode Member' }),
    ...(payloadOverride || {}),
  };
  const validation = validateEmailJob({
    emailType: communicationType,
    recipient: 'preview@peakmode.se',
    payload,
  });
  const templateId = resolveProviderTemplateId(communicationType, { language: payload.language });
  const dynamicData = emailWorker.buildDynamicPayload(communicationType, {
    ...payload,
    subject: validation.subject || resolveSubjectForJob(communicationType, payload),
  });
  const links = extractUrlFields(dynamicData).map((l) => ({
    ...l,
    valid: isHttpsUrl(l.value),
  }));
  return {
    ok: validation.valid,
    communicationType,
    subject: validation.subject,
    templateId,
    validation,
    requiredFields: def.requiredFields,
    dynamicDataKeys: Object.keys(dynamicData),
    links,
  };
}

module.exports = {
  previewCommunicationType,
  SAMPLE_PAYLOADS,
};
