const { buildBrandUrls, mirrorUrl, buildUnsubscribeUrl } = require('./emailUrls');
const { signUnsubscribeToken } = require('../lib/unsubscribeToken');
const { getDefinition } = require('./emailDefinitions');
const { CATEGORY } = require('./emailTypes');
const { enrichTemplateData } = require('./templateDataEnrichment');
const { resolveSubjectForJob } = require('./emailDefinitions');

function buildDynamicPayload(emailType, payload) {
  const fallbackOrigin = payload?.fallbackOrigin || payload?.site_origin;
  const brand = buildBrandUrls(fallbackOrigin);
  let data = { ...brand, ...(payload || {}) };
  data.recipient = data.recipient || payload?.email;
  if (!data.recoveryUrl && data.recoveryLink) {
    data.recoveryUrl = data.recoveryLink;
  }
  if (!data.recoveryUrl && data.recovery_url) {
    data.recoveryUrl = data.recovery_url;
  }
  const def = getDefinition(emailType);
  const to = payload?.recipient || payload?.email;
  if (def?.category === CATEGORY.MARKETING && to) {
    const token = signUnsubscribeToken(String(to));
    const unsubscribe_url = buildUnsubscribeUrl({ token });
    data.unsubscribe_url = unsubscribe_url;
    data.unsubscribeUrl = unsubscribe_url;
    Object.assign(data, mirrorUrl(unsubscribe_url, ['unsubscribe_link']));
  }

  const urlMaps = [
    ['verificationUrl', ['verification_link', 'verification_url', 'verify_link']],
    [
      'resetUrl',
      ['reset_url', 'reset_link', 'password_reset_link', 'password_reset_url', 'reset_password_url'],
    ],
    ['confirmationUrl', ['confirmation_link', 'confirm_link']],
    ['recoveryUrl', ['recovery_url', 'recovery_link', 'continue_account_recovery_url']],
    ['hubUrl', ['hub_url', 'hub_home_url', 'dashboard_url']],
    ['order_status_url', ['order_status_link', 'track_order_url', 'tracking_url']],
    ['tracking_url', ['tracking_link', 'shipment_url']],
    ['retry_url', ['payment_retry_url', 'checkout_url']],
    ['cart_url', ['cart_link', 'basket_url']],
    ['review_url', ['review_link']],
  ];

  for (const [canonical, keys] of urlMaps) {
    if (data[canonical]) {
      Object.assign(data, mirrorUrl(data[canonical], [...keys, 'button_url', 'cta_url', 'action_url']));
    }
  }

  data = enrichTemplateData(data, emailType);

  const subject = resolveSubjectForJob(emailType, data);
  if (subject) {
    data.subject = subject;
    data.email_subject = subject;
    data.Subject = subject;
    data.subject_line = subject;
    data.emailSubject = subject;
    data.title = subject;
    data.email_title = subject;
  }

  return data;
}

module.exports = { buildDynamicPayload };
