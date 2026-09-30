/**
 * Peak Mode Hub identity — SSOT for customer ↔ user ↔ member ↔ profile.
 * Email is the join key until explicit customerId is stored on member.
 */
const getDBInstance = require('../../vornifydb/dbInstance');

const db = getDBInstance();
const DB = 'peakmode';

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

async function readOne(collection, filter) {
  const result = await db.executeOperation({
    database_name: DB,
    collection_name: collection,
    command: '--read',
    data: { filter },
  });
  if (!result.success || result.data == null) return null;
  if (Array.isArray(result.data)) {
    return result.data.length > 0 ? result.data[0] : null;
  }
  return result.data;
}

async function createDoc(collection, doc) {
  const result = await db.executeOperation({
    database_name: DB,
    collection_name: collection,
    command: '--create',
    data: doc,
  });
  return result.success ? result.data : null;
}

async function updateDoc(collection, filter, update) {
  const result = await db.executeOperation({
    database_name: DB,
    collection_name: collection,
    command: '--update',
    data: { filter, update: { ...update, updatedAt: new Date().toISOString() } },
  });
  return result.success;
}

async function findUserByEmail(email) {
  return readOne('users', { email: normalizeEmail(email) });
}

async function findUserByEmailAndFields(email, fields = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return readOne('users', { email: normalized, ...fields });
}

async function findCustomerByEmail(email) {
  return readOne('customers', { email: normalizeEmail(email) });
}

async function ensureCustomer({ email, name }) {
  const normalized = normalizeEmail(email);
  let customer = await findCustomerByEmail(normalized);
  if (customer) return customer;

  const now = new Date().toISOString();
  const doc = {
    email: normalized,
    id: normalized,
    name: name || normalized.split('@')[0] || 'Member',
    joinDate: now,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    customerType: 'new',
    tags: ['hub'],
    ordersCount: 0,
    totalSpent: 0,
    averageOrderValue: 0,
    recentOrders: [],
  };
  await createDoc('customers', doc);
  return readOne('customers', { email: normalized });
}

async function findMemberByEmail(email) {
  return readOne('hub_members', { email: normalizeEmail(email) });
}

async function findProfileByMemberId(memberId) {
  return readOne('hub_profiles', { memberId });
}

async function ensureMember({ email, userId, customerId, name }) {
  const normalized = normalizeEmail(email);
  let member = await findMemberByEmail(normalized);
  const now = new Date().toISOString();

  if (!member) {
    const doc = {
      email: normalized,
      userId: userId || null,
      customerId: customerId || normalized,
      status: 'active',
      membershipState: 'eligible',
      joinedAt: now,
      onboardingCompletedAt: null,
      membershipVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    await createDoc('hub_members', doc);
    member = await findMemberByEmail(normalized);
  } else {
    const patch = {};
    if (userId && !member.userId) patch.userId = userId;
    if (customerId && !member.customerId) patch.customerId = customerId;
    if (Object.keys(patch).length) {
      await updateDoc('hub_members', { email: normalized }, patch);
      member = await findMemberByEmail(normalized);
    }
  }

  let profile = await readOne('hub_profiles', { email: normalized });
  if (!profile && member) {
    const mid = member._id || member.id;
    if (mid) profile = await findProfileByMemberId(String(mid));
  }

  if (!profile && member) {
    const memberKey = member._id || member.id || normalized;
    const profileDoc = {
      memberId: String(memberKey),
      customerId: member.customerId || normalized,
      email: normalized,
      displayName: name || normalized.split('@')[0] || 'Member',
      username: null,
      avatarUrl: null,
      bio: '',
      interests: [],
      goals: [],
      privacy: {
        profileVisibility: 'members_only',
        showAchievements: true,
        showChallengeActivity: true,
        allowComments: true,
      },
      createdAt: now,
      updatedAt: now,
    };
    await createDoc('hub_profiles', profileDoc);
    profile = await readOne('hub_profiles', { email: normalized });
  }

  return { member, profile };
}

/**
 * After successful auth (verified user), link customer + member + profile.
 */
async function provisionForAuthenticatedUser(user) {
  const email = normalizeEmail(user.email);
  const userId = user._id ? String(user._id) : user.id || email;
  const customer = await ensureCustomer({ email, name: user.name });
  const customerId = customer?.id || customer?.email || email;
  const { member, profile } = await ensureMember({
    email,
    userId,
    customerId,
    name: user.name,
  });

  return {
    member: sanitizeMember(member),
    profile: sanitizeProfile(profile),
    customerId,
    onboardingComplete: Boolean(member?.onboardingCompletedAt),
  };
}

function sanitizeMember(member) {
  if (!member) return null;
  return {
    id: member._id || member.id,
    email: member.email,
    customerId: member.customerId,
    status: member.status,
    membershipState: member.membershipState,
    joinedAt: member.joinedAt,
    onboardingCompletedAt: member.onboardingCompletedAt,
  };
}

function sanitizeProfile(profile) {
  if (!profile) return null;
  return {
    displayName: profile.displayName,
    username: profile.username,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    interests: profile.interests || [],
    goals: profile.goals || [],
    privacy: profile.privacy || {},
  };
}

async function checkEmailStep(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { step: 'invalid', message: 'Invalid email' };
  }

  const user = await findUserByEmail(normalized);
  if (user) {
    if (!user.isVerified) {
      return { step: 'verify_email', email: normalized };
    }
    return { step: 'password', email: normalized };
  }

  const customer = await findCustomerByEmail(normalized);
  if (customer) {
    return { step: 'register', email: normalized, existingCustomer: true };
  }

  return { step: 'register', email: normalized, existingCustomer: false };
}

async function getSessionByEmail(email) {
  const normalized = normalizeEmail(email);
  const user = await findUserByEmail(normalized);
  if (!user || !user.isVerified) return null;

  const bundle = await provisionForAuthenticatedUser(user);
  return { user: { email: user.email, name: user.name, isVerified: user.isVerified }, ...bundle };
}

async function completeOnboarding(email, payload) {
  const normalized = normalizeEmail(email);
  const member = await findMemberByEmail(normalized);
  if (!member) {
    throw new Error('Member not found');
  }

  const { displayName, username, interests, goals, privacy } = payload;

  if (username) {
    const taken = await readOne('hub_profiles', { username: String(username).toLowerCase() });
    if (taken && normalizeEmail(taken.email) !== normalized) {
      const err = new Error('Username is taken');
      err.code = 'USERNAME_TAKEN';
      throw err;
    }
  }

  const profileFilter = { email: normalized };
  await updateDoc('hub_profiles', profileFilter, {
    displayName: displayName || member.displayName,
    username: username ? String(username).toLowerCase() : null,
    interests: Array.isArray(interests) ? interests : [],
    goals: Array.isArray(goals) ? goals : [],
    privacy: privacy || {},
  });

  const now = new Date().toISOString();
  await updateDoc('hub_members', { email: normalized }, {
    membershipState: 'active',
    onboardingCompletedAt: now,
  });

  return getSessionByEmail(normalized);
}

module.exports = {
  normalizeEmail,
  findUserByEmail,
  findUserByEmailAndFields,
  findCustomerByEmail,
  ensureCustomer,
  ensureMember,
  provisionForAuthenticatedUser,
  checkEmailStep,
  getSessionByEmail,
  completeOnboarding,
  sanitizeMember,
  sanitizeProfile,
};
