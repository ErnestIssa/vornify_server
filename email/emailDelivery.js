const sendgridProvider = require('./sendgridProvider');
const { resolveAttachments } = require('./attachments');
const { getDefinition } = require('./emailDefinitions');
const { CATEGORY } = require('./emailTypes');
const marketing = require('../services/subscriberMarketingService');

async function deliverEmailMessage(msg) {
  const def = getDefinition(msg.emailType);
  const mode = def?.deliveryMode || msg.deliveryMode || 'template';
  const from = {
    fromEmail: (process.env.EMAIL_FROM || 'support@peakmode.se').trim(),
    fromName: process.env.SUPPORT_INBOX_NAME || 'Peak Mode Support',
    replyToEmail: process.env.SUPPORT_INBOX_EMAIL || process.env.EMAIL_FROM || 'support@peakmode.se',
    replyToName: process.env.SUPPORT_INBOX_NAME || 'Peak Mode Support',
  };
  const payload = msg.payload || {};
  const isMarketing = def?.category === CATEGORY.MARKETING;
  const bypass = isMarketing ? false : def?.bypassListManagement !== false;
  let listUnsubscribe;
  if (isMarketing) {
    const urls = marketing.buildUrlsForSubscriber(msg.recipient);
    listUnsubscribe = {
      url: urls.unsubscribeUrl,
      oneClickPostUrl: urls.oneClickUrl,
    };
    payload.unsubscribe_url = urls.unsubscribeUrl;
    payload.unsubscribeUrl = urls.unsubscribeUrl;
  }

  if (mode === 'html') {
    const to = payload.recipients?.length ? payload.recipients : msg.recipient;
    let attachments = [];
    if (payload.attachments?.length || payload.attachmentUrls?.length) {
      attachments = await resolveAttachments(payload);
    }
    return sendgridProvider.sendHtmlEmail({
      to,
      subject: msg.subject,
      html: payload.html,
      text: payload.text,
      cc: payload.cc,
      bcc: payload.bcc,
      attachments,
      ...from,
      bypassListManagement: bypass,
      listUnsubscribe,
    });
  }

  const { buildDynamicPayload } = require('./payloadBuilder');
  const dynamicData = buildDynamicPayload(msg.emailType, {
    ...payload,
    recipient: msg.recipient,
    subject: msg.subject || def?.subject,
  });

  return sendgridProvider.sendDynamicTemplate({
    to: msg.recipient,
    subject: msg.subject || def?.subject,
    templateId: msg.providerTemplateId,
    dynamicData,
    fromEmail: from.fromEmail,
    fromName: from.fromName,
    replyToEmail: from.replyToEmail,
    replyToName: from.replyToName,
    bypassListManagement: bypass,
    listUnsubscribe,
  });
}

module.exports = { deliverEmailMessage };
