const sgMail = require('@sendgrid/mail');

function initFromEnv() {
  const key = process.env.SENDGRID_API_KEY;
  if (key) sgMail.setApiKey(key);
}

initFromEnv();

/**
 * SendGrid dynamic templates expect flat string-friendly values.
 * Skips null/undefined; coerces primitives to strings so Handlebars substitution is reliable.
 */
const CAMEL_TO_SNAKE_URL = [
  ['recoveryUrl', 'recovery_url'],
  ['verificationUrl', 'verification_url'],
  ['resetUrl', 'reset_url'],
  ['confirmationUrl', 'confirmation_url'],
  ['hubUrl', 'hub_url'],
];

function sanitizeDynamicTemplateData(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value == null || key.startsWith('_')) continue;
    if (typeof value === 'object') continue;
    const s = String(value).trim();
    if (s === '') continue;
    out[key] = s;
  }
  for (const [camel, snake] of CAMEL_TO_SNAKE_URL) {
    if (out[camel] && !out[snake]) out[snake] = out[camel];
  }
  if (out.year && !out.current_year) out.current_year = out.year;
  return out;
}

function applyMailSettings(msg, { bypassListManagement = true } = {}) {
  if (process.env.SENDGRID_ENABLE_CLICK_TRACKING !== 'true') {
    msg.trackingSettings = {
      clickTracking: { enable: false, enableText: false },
      openTracking: { enable: process.env.SENDGRID_ENABLE_OPEN_TRACKING === 'true' },
      subscriptionTracking: { enable: false },
    };
  }
  if (bypassListManagement) {
    msg.mailSettings = {
      ...(msg.mailSettings || {}),
      bypassListManagement: { enable: true },
      footer: { enable: false },
      sandboxMode: { enable: false },
    };
  }
}

function applyListUnsubscribeHeaders(msg, listUnsubscribe) {
  if (!listUnsubscribe?.url) return;
  msg.headers = msg.headers || {};
  msg.headers['List-Unsubscribe'] = `<${listUnsubscribe.url}>`;
  if (listUnsubscribe.oneClickPostUrl) {
    msg.headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
}

async function sendDynamicTemplate({
  to,
  subject,
  templateId,
  dynamicData,
  fromEmail,
  fromName,
  replyToEmail,
  replyToName,
  bypassListManagement,
  listUnsubscribe,
}) {
  if (!process.env.SENDGRID_API_KEY) {
    return { ok: false, error: 'SENDGRID_API_KEY missing', retryable: false };
  }

  const safeSubject = String(subject || '').trim() || 'Peak Mode';
  const merged = sanitizeDynamicTemplateData({
    ...(dynamicData || {}),
    subject: safeSubject,
    email_subject: safeSubject,
    Subject: safeSubject,
    title: safeSubject,
  });

  const msg = {
    from: { email: fromEmail, name: fromName || 'Peak Mode' },
    templateId: String(templateId).trim(),
    personalizations: [
      {
        to: [{ email: to }],
        subject: safeSubject,
        dynamicTemplateData: merged,
      },
    ],
  };

  if (replyToEmail) {
    msg.replyTo = { email: replyToEmail, name: replyToName || fromName };
  }

  applyMailSettings(msg, { bypassListManagement });
  applyListUnsubscribeHeaders(msg, listUnsubscribe);

  try {
    const response = await sgMail.send(msg);
    const messageId = response[0]?.headers?.['x-message-id'] || null;
    const statusCode = response[0]?.statusCode;
    return {
      ok: true,
      providerMessageId: messageId,
      statusCode,
      accepted: statusCode === 202 || statusCode === 200,
    };
  } catch (error) {
    const status = error.response?.statusCode;
    const retryable = !status || status >= 500 || status === 429;
    return {
      ok: false,
      error: error.message,
      details: error.response?.body,
      retryable,
      statusCode: status,
    };
  }
}

async function sendHtmlEmail({
  to,
  subject,
  html,
  text,
  fromEmail,
  fromName,
  replyToEmail,
  replyToName,
  cc,
  bcc,
  attachments,
  bypassListManagement = true,
  listUnsubscribe,
}) {
  if (!process.env.SENDGRID_API_KEY) {
    return { ok: false, error: 'SENDGRID_API_KEY missing', retryable: false };
  }
  const recipients = Array.isArray(to) ? to : [to];
  const safeSubject = String(subject || '').trim() || 'Peak Mode';
  const msg = {
    to: recipients,
    from: { email: fromEmail, name: fromName || 'Peak Mode' },
    subject: safeSubject,
    html: html || '',
    text: text || (html ? String(html).replace(/<[^>]*>/g, '') : ''),
  };
  if (replyToEmail) msg.replyTo = { email: replyToEmail, name: replyToName || fromName };
  if (cc?.length) msg.cc = cc;
  if (bcc?.length) msg.bcc = bcc;
  if (attachments?.length) msg.attachments = attachments;
  applyMailSettings(msg, { bypassListManagement });
  applyListUnsubscribeHeaders(msg, listUnsubscribe);
  try {
    const response = await sgMail.send(msg);
    const messageId = response[0]?.headers?.['x-message-id'] || null;
    const statusCode = response[0]?.statusCode;
    return {
      ok: true,
      providerMessageId: messageId,
      statusCode,
      accepted: statusCode === 202 || statusCode === 200,
    };
  } catch (error) {
    const status = error.response?.statusCode;
    const retryable = !status || status >= 500 || status === 429;
    return {
      ok: false,
      error: error.message,
      details: error.response?.body,
      retryable,
      statusCode: status,
    };
  }
}

function verifyConfiguration() {
  const key = process.env.SENDGRID_API_KEY;
  return Boolean(key && String(key).trim().length > 10);
}

module.exports = {
  sendDynamicTemplate,
  sendHtmlEmail,
  verifyConfiguration,
  sanitizeDynamicTemplateData,
};
