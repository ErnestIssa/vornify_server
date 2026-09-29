const crypto = require('crypto');

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function authOk(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function authFail(res, status, code, message, extra = {}) {
  const requestId = crypto.randomBytes(8).toString('hex');
  return res.status(status).json({
    success: false,
    code,
    message,
    requestId,
    ...extra,
  });
}

const CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  EMAIL_VERIFICATION_REQUIRED: 'EMAIL_VERIFICATION_REQUIRED',
  ACCOUNT_LOCKED: 'ACCOUNT_TEMPORARILY_LOCKED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ACCOUNT_EXISTS: 'ACCOUNT_EXISTS',
};

module.exports = {
  normalizeEmail,
  authOk,
  authFail,
  CODES,
};
