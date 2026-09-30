const LOCK_AFTER_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

function getSecurity(user) {
  return user?.security || {};
}

function isAccountLocked(user) {
  const sec = getSecurity(user);
  if (user?.hubStatus === 'suspended' || user?.status === 'suspended') return { locked: true, reason: 'suspended' };
  if (user?.hubStatus === 'banned' || user?.status === 'banned') return { locked: true, reason: 'banned' };
  const until = sec.lockedUntil ? new Date(sec.lockedUntil) : null;
  if (until && until > new Date()) return { locked: true, reason: 'throttle' };
  return { locked: false };
}

function buildFailedLoginUpdate(user) {
  const sec = getSecurity(user);
  const failedLoginCount = (sec.failedLoginCount || 0) + 1;
  const update = {
    security: {
      ...sec,
      failedLoginCount,
      lastFailedLoginAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  let justLocked = false;
  if (failedLoginCount >= LOCK_AFTER_FAILURES) {
    update.security.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
    update.security.lockReason = 'too_many_failed_logins';
    justLocked = true;
  }
  return { update, justLocked, failedLoginCount };
}

/** @deprecated Use hubAuthLoginEvents.afterSuccessfulHubLogin for Hub sign-in. */
function buildSuccessfulLoginUpdate(user) {
  const sec = getSecurity(user);
  return {
    security: {
      ...sec,
      failedLoginCount: 0,
      lockedUntil: null,
      lockReason: null,
      lastSuccessfulLoginAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  LOCK_AFTER_FAILURES,
  isAccountLocked,
  buildFailedLoginUpdate,
  buildSuccessfulLoginUpdate,
};
