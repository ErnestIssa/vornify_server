const crypto = require('crypto');

/**
 * Verify SendGrid Event Webhook (signed webhook).
 * Set SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY to the verification key from SendGrid dashboard.
 */
function verifySendGridWebhook({ rawBody, signature, timestamp }) {
  const publicKey = process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY;
  if (!publicKey || !String(publicKey).trim()) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, error: 'WEBHOOK_VERIFICATION_NOT_CONFIGURED' };
    }
    return { ok: true, skipped: true };
  }
  if (!signature || !timestamp) {
    return { ok: false, error: 'MISSING_SIGNATURE_HEADERS' };
  }
  const ts = parseInt(String(timestamp), 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 600) {
    return { ok: false, error: 'STALE_WEBHOOK_TIMESTAMP' };
  }
  try {
    const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
    const verifier = crypto.createVerify('SHA256');
    verifier.update(timestamp + payload);
    verifier.end();
    const key = publicKey.includes('BEGIN PUBLIC KEY')
      ? publicKey
      : `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;
    const valid = verifier.verify(key, Buffer.from(signature, 'base64'));
    return valid ? { ok: true } : { ok: false, error: 'INVALID_SIGNATURE' };
  } catch (err) {
    return { ok: false, error: err.message || 'VERIFY_FAILED' };
  }
}

module.exports = { verifySendGridWebhook };
