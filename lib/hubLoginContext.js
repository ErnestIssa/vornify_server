const crypto = require('crypto');

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '';
}

function buildSessionKey(req) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 512);
  const ip = getClientIp(req);
  return crypto.createHash('sha256').update(`${ua}|${ip}`).digest('hex').slice(0, 24);
}

function getLoginContext(req) {
  const sessionKey = buildSessionKey(req);
  return {
    sessionKey,
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 512),
    at: new Date().toISOString(),
  };
}

/**
 * @returns {{ isNewSession: boolean, suspiciousLogin: boolean, patchSecurity: object }}
 */
function assessLoginSession(user, context) {
  const sec = user?.security || {};
  const known = Array.isArray(sec.knownSessionKeys) ? [...sec.knownSessionKeys] : [];
  const isNewSession = !known.includes(context.sessionKey);
  const recentFailures = (sec.failedLoginCount || 0) >= 3;
  const failedRecently =
    sec.lastFailedLoginAt &&
    Date.now() - new Date(sec.lastFailedLoginAt).getTime() < 30 * 60 * 1000;
  const suspiciousLogin = isNewSession && recentFailures && failedRecently;

  let knownSessionKeys = known;
  if (isNewSession) {
    knownSessionKeys = [context.sessionKey, ...known].slice(0, 20);
  }

  const patchSecurity = {
    ...sec,
    knownSessionKeys,
    lastLoginAt: context.at,
    lastLoginIp: context.ip,
    lastLoginUserAgent: context.userAgent,
    lastSessionKey: context.sessionKey,
  };

  return { isNewSession, suspiciousLogin, patchSecurity };
}

function buildSuccessfulLoginSecurityPatch(user, context) {
  const { patchSecurity, isNewSession, suspiciousLogin } = assessLoginSession(user, context);
  return {
    isNewSession,
    suspiciousLogin,
    update: {
      security: {
        ...patchSecurity,
        failedLoginCount: 0,
        lockedUntil: null,
        lockReason: null,
        lastSuccessfulLoginAt: context.at,
      },
      updatedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  getLoginContext,
  buildSessionKey,
  assessLoginSession,
  buildSuccessfulLoginSecurityPatch,
};
