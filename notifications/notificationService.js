const notificationStore = require('./notificationStore');
const { PRIORITY } = require('./notificationTypes');

async function createNotification({
  userId,
  type,
  title,
  body,
  deepLink,
  data,
  sourceEvent,
  priority = PRIORITY.NORMAL,
  expiresAt,
}) {
  if (!userId || !type) return null;
  const now = new Date().toISOString();
  const doc = {
    notificationId: notificationStore.newNotificationId(),
    userId,
    type,
    title: title || type,
    body: body || '',
    deepLink: deepLink || null,
    data: data || {},
    readAt: null,
    createdAt: now,
    expiresAt: expiresAt || null,
    priority,
    sourceEvent: sourceEvent || null,
  };
  return notificationStore.create(doc);
}

async function listForUser(userId, options) {
  return notificationStore.findByUser(userId, options);
}

async function markNotificationRead(notificationId, userId) {
  return notificationStore.markRead(notificationId, userId);
}

async function markAllNotificationsRead(userId) {
  return notificationStore.markAllRead(userId);
}

module.exports = {
  createNotification,
  listForUser,
  markNotificationRead,
  markAllNotificationsRead,
};
