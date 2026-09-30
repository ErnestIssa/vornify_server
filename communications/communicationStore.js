const crypto = require('crypto');
const os = require('os');
const getDBInstance = require('../vornifydb/dbInstance');
const { STATUS, PRIORITY } = require('./communicationTypes');

const db = getDBInstance();
const DB = 'peakmode';
const COLLECTION = process.env.COMMUNICATION_MESSAGES_COLLECTION || 'communication_messages';
const LEGACY_COLLECTION = 'email_messages';
const CLAIM_TTL_MS = 5 * 60 * 1000;
const WORKER_ID = `${os.hostname()}-${process.pid}`;

function newEmailId() {
  return `em_${crypto.randomBytes(10).toString('hex')}`;
}

function normalizeMessage(row) {
  if (!row) return null;
  return {
    ...row,
    communicationId: row.communicationId || row.emailId,
    emailId: row.emailId || row.communicationId,
    communicationType: row.communicationType || row.emailType,
    emailType: row.emailType || row.communicationType,
    channel: row.channel || 'email',
  };
}

async function readCollection(collectionName, filter) {
  const result = await db.executeOperation({
    database_name: DB,
    collection_name: collectionName,
    command: '--read',
    data: filter ? { filter } : {},
  });
  if (!result.success || !result.data) return [];
  return Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);
}

async function createMessage(doc) {
  const enriched = {
    channel: 'email',
    communicationId: doc.emailId,
    communicationType: doc.emailType,
    ...doc,
  };
  const result = await db.executeOperation({
    database_name: DB,
    collection_name: COLLECTION,
    command: '--create',
    data: enriched,
  });
  return result.success ? enriched : null;
}

async function findById(emailId) {
  for (const collection of [COLLECTION, LEGACY_COLLECTION]) {
    const rows = await readCollection(collection, { emailId });
    if (rows[0]) return normalizeMessage(rows[0]);
    const byComm = await readCollection(collection, { communicationId: emailId });
    if (byComm[0]) return normalizeMessage(byComm[0]);
  }
  return null;
}

async function findByIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey) return null;
  for (const collection of [COLLECTION, LEGACY_COLLECTION]) {
    const rows = await readCollection(collection, { idempotencyKey });
    const active = rows.find((r) => r.status !== STATUS.FAILED && r.status !== STATUS.DEAD_LETTER);
    if (active) return normalizeMessage(active);
    if (rows[0]) return normalizeMessage(rows[0]);
  }
  return null;
}

async function findByProviderMessageId(providerMessageId) {
  if (!providerMessageId) return null;
  for (const collection of [COLLECTION, LEGACY_COLLECTION]) {
    const rows = await readCollection(collection, { providerMessageId });
    if (rows[0]) return normalizeMessage(rows[0]);
  }
  return null;
}

async function updateMessage(emailId, patch) {
  for (const collection of [COLLECTION, LEGACY_COLLECTION]) {
    const result = await db.executeOperation({
      database_name: DB,
      collection_name: collection,
      command: '--update',
      data: {
        filter: { emailId },
        update: { ...patch, updatedAt: new Date().toISOString() },
      },
    });
    if (result.success) return result;
  }
  return { success: false, error: 'NOT_FOUND' };
}

async function appendEvent(emailId, event) {
  const msg = await findById(emailId);
  if (!msg) return false;
  const events = Array.isArray(msg.events) ? msg.events : [];
  events.push({ ...event, at: event.at || new Date().toISOString() });
  await updateMessage(emailId, { events });
  return true;
}

async function findPendingCandidates(limit = 50) {
  const now = Date.now();
  const rows = [];
  for (const collection of [COLLECTION, LEGACY_COLLECTION]) {
    for (const status of [STATUS.QUEUED, STATUS.DEFERRED, STATUS.PROCESSING]) {
      const chunk = await readCollection(collection, { status });
      rows.push(...chunk);
    }
  }
  const unique = new Map();
  for (const r of rows) {
    const id = r.emailId || r.communicationId;
    if (id && !unique.has(id)) unique.set(id, r);
  }
  return [...unique.values()]
    .filter((r) => {
      const scheduled = r.scheduledAt ? new Date(r.scheduledAt).getTime() : 0;
      if (scheduled > now) return false;
      if (r.status === STATUS.PROCESSING) {
        const claimExp = r.claimExpiresAt ? new Date(r.claimExpiresAt).getTime() : 0;
        return claimExp > 0 && claimExp <= now;
      }
      return r.status === STATUS.QUEUED || r.status === STATUS.DEFERRED;
    })
    .sort((a, b) => (a.priority ?? PRIORITY.NORMAL) - (b.priority ?? PRIORITY.NORMAL))
    .slice(0, limit);
}

async function claimNextPending() {
  const candidates = await findPendingCandidates(40);
  const nowIso = new Date().toISOString();
  const claimExpiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString();

  for (const candidate of candidates) {
    const emailId = candidate.emailId || candidate.communicationId;
    for (const collection of [COLLECTION, LEGACY_COLLECTION]) {
      const filter = {
        emailId,
        $or: [
          { status: { $in: [STATUS.QUEUED, STATUS.DEFERRED] } },
          {
            status: STATUS.PROCESSING,
            claimExpiresAt: { $lte: nowIso },
          },
        ],
      };
      const result = await db.executeOperation({
        database_name: DB,
        collection_name: collection,
        command: '--update-operator',
        data: {
          filter,
          update: {
            $set: {
              status: STATUS.PROCESSING,
              claimWorkerId: WORKER_ID,
              claimExpiresAt,
              processingAt: nowIso,
            },
          },
        },
      });
      if (result.success) {
        return findById(emailId);
      }
    }
  }
  return null;
}

async function findPending(limit = 25) {
  return findPendingCandidates(limit);
}

async function queryMessages({ filter = {}, limit = 50, offset = 0, sortField = 'createdAt' } = {}) {
  const rows = await readCollection(COLLECTION, Object.keys(filter).length ? filter : null);
  const legacy = await readCollection(LEGACY_COLLECTION, Object.keys(filter).length ? filter : null);
  const merged = [...rows, ...legacy].map(normalizeMessage);
  const seen = new Set();
  const deduped = merged.filter((m) => {
    const id = m.emailId;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  deduped.sort((a, b) => new Date(b[sortField] || b.createdAt) - new Date(a[sortField] || a.createdAt));
  return {
    total: deduped.length,
    items: deduped.slice(offset, offset + limit),
  };
}

async function tryClaimMessageById(emailId) {
  const nowIso = new Date().toISOString();
  const claimExpiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString();
  for (const collection of [COLLECTION, LEGACY_COLLECTION]) {
    const filter = {
      emailId,
      $or: [
        { status: { $in: [STATUS.QUEUED, STATUS.DEFERRED] } },
        { status: STATUS.PROCESSING, claimExpiresAt: { $lte: nowIso } },
      ],
    };
    const result = await db.executeOperation({
      database_name: DB,
      collection_name: collection,
      command: '--update-operator',
      data: {
        filter,
        update: {
          $set: {
            status: STATUS.PROCESSING,
            claimWorkerId: WORKER_ID,
            claimExpiresAt,
            processingAt: nowIso,
          },
        },
      },
    });
    if (result.success) {
      return findById(emailId);
    }
  }
  return null;
}

module.exports = {
  newEmailId,
  createMessage,
  findById,
  findByIdempotencyKey,
  findByProviderMessageId,
  updateMessage,
  appendEvent,
  findPending,
  claimNextPending,
  tryClaimMessageById,
  queryMessages,
  COLLECTION,
  LEGACY_COLLECTION,
  CLAIM_TTL_MS,
};
