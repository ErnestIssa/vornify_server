const crypto = require('crypto');
const getDBInstance = require('../vornifydb/dbInstance');
const hubIdentity = require('./hub/hubIdentityService');

const db = getDBInstance();
const DB = 'peakmode';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function randomPasswordPlaceholder() {
  return hashPassword(crypto.randomBytes(32).toString('hex'));
}

async function readUserByEmail(email) {
  const normalized = hubIdentity.normalizeEmail(email);
  const result = await db.executeOperation({
    database_name: DB,
    collection_name: 'users',
    command: '--read',
    data: { filter: { email: normalized } },
  });
  if (!result.success || !result.data) return null;
  return result.data;
}

/**
 * Link or create Peak Mode user from Google profile. Google-verified email → isVerified true.
 */
async function upsertUserFromGoogle(googleProfile) {
  const email = hubIdentity.normalizeEmail(googleProfile.email);
  const now = new Date().toISOString();
  let user = await readUserByEmail(email);

  if (user) {
    const authProviders = Array.isArray(user.authProviders) ? [...user.authProviders] : [];
    if (!authProviders.includes('google')) authProviders.push('google');

    const update = {
      googleId: googleProfile.googleId,
      authProviders,
      isVerified: true,
      updatedAt: now,
    };
    if (googleProfile.picture && !user.avatarUrl) {
      update.avatarUrl = googleProfile.picture;
    }
    if (googleProfile.name && !user.name) {
      update.name = googleProfile.name;
    }

    await db.executeOperation({
      database_name: DB,
      collection_name: 'users',
      command: '--update',
      data: { filter: { email }, update },
    });
    user = { ...user, ...update, email };
  } else {
    const newUser = {
      email,
      password: randomPasswordPlaceholder(),
      name: googleProfile.name || email.split('@')[0] || 'Member',
      phone: '',
      isVerified: true,
      googleId: googleProfile.googleId,
      authProviders: ['google'],
      avatarUrl: googleProfile.picture || null,
      createdAt: now,
      updatedAt: now,
    };
    const result = await db.executeOperation({
      database_name: DB,
      collection_name: 'users',
      command: '--create',
      data: newUser,
    });
    if (!result.success) {
      throw new Error('failed_to_create_user');
    }
    user = newUser;
  }

  await hubIdentity.ensureCustomer({ email, name: user.name });
  await hubIdentity.ensureMember({
    email,
    userId: user._id ? String(user._id) : email,
    customerId: email,
    name: user.name,
  });

  return user;
}

async function createLoginExchangeCode(sessionPayload) {
  const code = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  await db.executeOperation({
    database_name: DB,
    collection_name: 'oauth_login_codes',
    command: '--create',
    data: {
      code,
      payload: sessionPayload,
      expiresAt,
      used: false,
      createdAt: new Date().toISOString(),
    },
  });
  return code;
}

async function consumeLoginExchangeCode(code) {
  if (!code) return null;
  const result = await db.executeOperation({
    database_name: DB,
    collection_name: 'oauth_login_codes',
    command: '--read',
    data: { filter: { code, used: false } },
  });
  if (!result.success || !result.data) return null;
  const row = result.data;
  if (new Date(row.expiresAt) < new Date()) return null;

  await db.executeOperation({
    database_name: DB,
    collection_name: 'oauth_login_codes',
    command: '--update',
    data: {
      filter: { code },
      update: { used: true, usedAt: new Date().toISOString() },
    },
  });

  return row.payload || null;
}

module.exports = {
  upsertUserFromGoogle,
  createLoginExchangeCode,
  consumeLoginExchangeCode,
};
