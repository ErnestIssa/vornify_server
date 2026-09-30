const { buildBrandUrls, mirrorUrl, buildUnsubscribeUrl } = require('./emailUrls');
const { signUnsubscribeToken } = require('../lib/unsubscribeToken');
const { getDefinition } = require('./emailDefinitions');
const { CATEGORY } = require('./emailTypes');

function buildDynamicPayload(emailType, payload) {
  const brand = buildBrandUrls();
  const data = { ...brand, ...(payload || {}) };
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
    ['resetUrl', ['reset_link', 'reset_url', 'password_reset_link']],
    ['confirmationUrl', ['confirmation_link', 'confirm_link']],
    ['recoveryUrl', ['recovery_link']],
    ['hubUrl', ['hub_url', 'hub_home_url', 'dashboard_url']],
    ['order_status_url', ['order_status_link', 'track_order_url', 'tracking_url']],
    ['tracking_url', ['tracking_link', 'shipment_url']],
    ['retry_url', ['payment_retry_url', 'checkout_url']],
    ['cart_url', ['cart_link', 'basket_url']],
    ['review_url', ['review_link']],
  ];

  for (const [canonical, keys] of urlMaps) {
    if (data[canonical]) {
      Object.assign(data, mirrorUrl(data[canonical], keys));
    }
  }

  return data;
}

module.exports = { buildDynamicPayload };
