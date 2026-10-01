const { getStorefrontOrigin, normalizeAuthLink } = require('../lib/authMailLinks');

function normalizeUrl(raw, fallbackOrigin) {
  return normalizeAuthLink(raw, fallbackOrigin);
}

function resolveEmailLogoUrl(origin) {
  const fromEnv = (process.env.EMAIL_LOGO_URL || process.env.RECEIPT_LOGO_URL || '').trim();
  if (fromEnv) return fromEnv;
  const base = String(origin || getStorefrontOrigin()).replace(/\/+$/, '');
  return `${base}/favicon.svg`;
}

function buildBrandUrls(fallbackOrigin) {
  const origin = getStorefrontOrigin(fallbackOrigin);
  const supportEmail = (process.env.SUPPORT_INBOX_EMAIL || process.env.EMAIL_FROM || 'support@peakmode.se').trim();
  const logoImage = resolveEmailLogoUrl(origin);

  return {
    website_url: origin,
    site_url: origin,
    home_url: origin,
    shop_url: origin,
    logo_url: logoImage,
    logo_image_url: logoImage,
    brand_logo_url: logoImage,
    logo_src: logoImage,
    logo_link: origin,
    hub_url: `${origin}/peak-mode-hub`,
    hub_home_url: `${origin}/peak-mode-hub`,
    account_url: `${origin}/hub/auth`,
    login_url: `${origin}/hub/auth`,
    sign_in_url: `${origin}/hub/auth`,
    contact_url: `${origin}/contact`,
    privacy_policy_url: `${origin}/privacy-policy`,
    privacy_url: `${origin}/privacy-policy`,
    terms_of_service_url: `${origin}/terms-of-service`,
    terms_url: `${origin}/terms-of-service`,
    support_email: supportEmail,
    support_url: `mailto:${supportEmail}`,
    company_name: 'Peak Mode',
    brand_name: 'Peak Mode',
    year: new Date().getFullYear(),
  };
}

function buildHubVerificationUrl({ token, email, fallbackOrigin }) {
  const origin = getStorefrontOrigin(fallbackOrigin);
  const safeToken = encodeURIComponent(String(token || '').trim());
  const safeEmail = encodeURIComponent(String(email || '').trim());
  return `${origin}/verify-email?token=${safeToken}&email=${safeEmail}`;
}

function buildReviewUrl({ orderId, fallbackOrigin }) {
  const origin = getStorefrontOrigin(fallbackOrigin);
  const id = encodeURIComponent(String(orderId || '').trim());
  return `${origin}/review?orderId=${id}`;
}

function buildCartUrl({ fallbackOrigin }) {
  const origin = getStorefrontOrigin(fallbackOrigin);
  return `${origin}/cart`;
}

function buildCheckoutUrl({ fallbackOrigin }) {
  const origin = getStorefrontOrigin(fallbackOrigin);
  return `${origin}/checkout`;
}

function buildOrderStatusUrl({ orderId, fallbackOrigin }) {
  const origin = getStorefrontOrigin(fallbackOrigin);
  const id = encodeURIComponent(String(orderId || '').trim());
  return `${origin}/track-order?orderId=${id}`;
}

function buildPasswordResetUrl({ token, email, fallbackOrigin }) {
  const origin = getStorefrontOrigin(fallbackOrigin);
  const safeToken = encodeURIComponent(String(token || '').trim());
  const safeEmail = encodeURIComponent(String(email || '').trim());
  return `${origin}/reset-password?token=${safeToken}&email=${safeEmail}`;
}

function buildUnsubscribeUrl({ token, email, category, lang, fallbackOrigin }) {
  const origin = getStorefrontOrigin(fallbackOrigin);
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  else if (email) params.set('email', String(email).trim());
  if (category) params.set('category', category);
  if (lang) params.set('lang', lang);
  const q = params.toString();
  return `${origin}/unsubscribe${q ? `?${q}` : ''}`;
}

function buildOneClickUnsubscribeUrl({ token, fallbackOrigin }) {
  const origin = getStorefrontOrigin(fallbackOrigin);
  const apiBase = (process.env.API_PUBLIC_URL || process.env.BACKEND_PUBLIC_URL || origin).replace(/\/+$/, '');
  if (token) {
    return `${apiBase}/api/subscribers/unsubscribe/one-click?token=${encodeURIComponent(token)}`;
  }
  return `${apiBase}/api/subscribers/unsubscribe/one-click`;
}

function mirrorUrl(url, keys) {
  const link = String(url || '').trim();
  const out = {};
  if (!link) return out;
  const names = new Set([
    ...(keys || []),
    'action_url',
    'button_url',
    'cta_url',
    'primary_action_url',
    'link',
    'url',
  ]);
  for (const name of names) {
    out[name] = link;
  }
  return out;
}

module.exports = {
  resolveEmailLogoUrl,
  buildBrandUrls,
  buildHubVerificationUrl,
  buildPasswordResetUrl,
  buildOrderStatusUrl,
  buildReviewUrl,
  buildCartUrl,
  buildCheckoutUrl,
  buildUnsubscribeUrl,
  buildOneClickUnsubscribeUrl,
  normalizeUrl,
  mirrorUrl,
};
