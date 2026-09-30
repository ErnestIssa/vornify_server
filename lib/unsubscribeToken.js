const crypto = require('crypto');

function getSecret() {
  const secret =
    process.env.UNSUBSCRIBE_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SESSION_SECRET;
  if (!secret || !String(secret).trim()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('UNSUBSCRIBE_TOKEN_SECRET not configured');
    }
    return 'dev-unsubscribe-secret-change-me';
  }
  return String(secret).trim();
}

/** Permanent token (no expiry) — HMAC over normalized subscriber email id. */
function signUnsubscribeToken(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const payload = Buffer.from(normalized, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyUnsubscribeToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, error: 'INVALID_TOKEN' };
  const parts = token.trim().split('.');
  if (parts.length !== 2) return { ok: false, error: 'INVALID_TOKEN' };
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  if (sig.length !== expected.length) {
    return { ok: false, error: 'INVALID_TOKEN' };
  }
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, error: 'INVALID_TOKEN' };
  }
  try {
    const email = Buffer.from(payload, 'base64url').toString('utf8').trim().toLowerCase();
    if (!email || !email.includes('@')) return { ok: false, error: 'INVALID_TOKEN' };
    return { ok: true, email };
  } catch {
    return { ok: false, error: 'INVALID_TOKEN' };
  }
}

module.exports = { signUnsubscribeToken, verifyUnsubscribeToken };
