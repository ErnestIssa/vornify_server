const crypto = require('crypto');
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();
const DB = 'peakmode';
const COLLECTION = 'notifications';

function newNotificationId() {
  return `nt_${crypto.randomBytes(10).toString('hex')}`;
}

async function create(doc) {
  const result = await db.executeOperation({
    database_name: DB,
    collection_name: COLLECTION,
    command: '--create',
    data: doc,
  });
  return result.success ? doc : null;
}

async function findByUser(userId, { limit = 50, unreadOnly = false } = {}) {
  const filter = { userId };
  if (unreadOnly) filter.readAt = null;
  const result = await db.executeOperation({
    database_name: DB,
    collection_name: COLLECTION,
    command: '--read',
    data: { filter },
  });
  if (!result.success || !result.data) return [];
  const rows = Array.isArray(result.data) ? result.data : [result.data];
  return rows
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

async function markRead(notificationId, userId) {
  return db.executeOperation({
    database_name: DB,
    collection_name: COLLECTION,
    command: '--update',
    data: {
      filter: { notificationId, userId },
      update: { readAt: new Date().toISOString() },
    },
  });
}

async function markAllRead(userId) {
  const rows = await findByUser(userId, { limit: 500 });
  for (const row of rows) {
    if (!row.readAt) {
      await markRead(row.notificationId, userId);
    }
  }
  return { success: true };
}

module.exports = {
  newNotificationId,
  create,
  findByUser,
  markRead,
  markAllRead,
  COLLECTION,
};
