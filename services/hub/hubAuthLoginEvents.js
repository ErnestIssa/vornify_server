const getDBInstance = require('../../vornifydb/dbInstance');
const hubAccountEmail = require('./hubAccountEmailService');
const { getLoginContext, buildSuccessfulLoginSecurityPatch } = require('../../lib/hubLoginContext');

const db = getDBInstance();

/**
 * Persist successful login security state and send new/suspicious login alerts immediately.
 */
async function afterSuccessfulHubLogin(user, req) {
  const email = user.email;
  const context = getLoginContext(req);
  const { isNewSession, suspiciousLogin, update } = buildSuccessfulLoginSecurityPatch(user, context);

  await db.executeOperation({
    database_name: 'peakmode',
    collection_name: 'users',
    command: '--update',
    data: { filter: { email }, update },
  });

  const sends = [];
  if (isNewSession) {
    sends.push(
      hubAccountEmail.sendNewLoginEmail(email, user.name, context, {
        fallbackOrigin: req.headers?.origin,
        user,
        acceptLanguage: req.headers?.['accept-language'],
      }),
    );
  }
  if (suspiciousLogin) {
    sends.push(
      hubAccountEmail.sendSuspiciousLoginEmail(email, user.name, context, {
        fallbackOrigin: req.headers?.origin,
        user,
        acceptLanguage: req.headers?.['accept-language'],
      }),
    );
  }
  if (sends.length) {
    await Promise.all(sends);
  }

  return { isNewSession, suspiciousLogin };
}

async function afterLoginBlocked(user, req) {
  if (!user?.email) return;
  const lockEvent = user.security?.lockedUntil || user.security?.lastFailedLoginAt || 'blocked';
  await hubAccountEmail.sendLoginBlockedEmail(user.email, user.name, {
    fallbackOrigin: req?.headers?.origin,
    correlationId: lockEvent,
    user,
    acceptLanguage: req?.headers?.['accept-language'],
  });
}

module.exports = {
  afterSuccessfulHubLogin,
  afterLoginBlocked,
};
