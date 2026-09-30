const crypto = require('crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    (process.env.BACKEND_PUBLIC_URL
      ? `${process.env.BACKEND_PUBLIC_URL.replace(/\/$/, '')}/api/auth/google/callback`
      : null);

  return { clientId, clientSecret, redirectUri };
}

function isGoogleOAuthConfigured() {
  const { clientId, clientSecret } = getOAuthConfig();
  return Boolean(clientId && clientSecret);
}

function stateSecret() {
  return (
    process.env.GOOGLE_OAUTH_STATE_SECRET ||
    process.env.JWT_SECRET ||
    process.env.ADMIN_JWT_SECRET ||
    'peak-mode-google-oauth-state-dev-only'
  );
}

function signOAuthState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyOAuthState(state) {
  if (!state || typeof state !== 'string') return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!parsed.ts || Date.now() - parsed.ts > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildGoogleAuthUrl({ returnTo }) {
  const { clientId, redirectUri } = getOAuthConfig();
  if (!clientId || !redirectUri) {
    throw new Error('Google OAuth is not configured');
  }

  const state = signOAuthState({
    returnTo: sanitizeReturnTo(returnTo),
    nonce: crypto.randomBytes(16).toString('hex'),
    ts: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

function sanitizeReturnTo(returnTo) {
  const fallback = '/peak-mode-hub';
  if (!returnTo || typeof returnTo !== 'string') return fallback;
  const path = returnTo.trim();
  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  if (path.includes('://')) return fallback;
  return path;
}

async function exchangeCodeForUser(code, redirectUriOverride) {
  const { clientId, clientSecret, redirectUri: configuredRedirect } = getOAuthConfig();
  const redirectUri = redirectUriOverride || configuredRedirect;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth is not configured');
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    const err = tokenData.error_description || tokenData.error || 'token_exchange_failed';
    throw new Error(err);
  }

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json().catch(() => ({}));
  if (!profileRes.ok || !profile.email) {
    throw new Error('google_profile_failed');
  }

  if (profile.email_verified === false) {
    throw new Error('google_email_not_verified');
  }

  return {
    googleId: profile.sub,
    email: String(profile.email).trim().toLowerCase(),
    name: profile.name || profile.given_name || profile.email.split('@')[0],
    picture: profile.picture || null,
  };
}

module.exports = {
  isGoogleOAuthConfigured,
  getOAuthConfig,
  buildGoogleAuthUrl,
  verifyOAuthState,
  sanitizeReturnTo,
  exchangeCodeForUser,
};
