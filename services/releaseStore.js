/**
 * Mongo access for releases + read receipts.
 */

const getDBInstance = require('../vornifydb/dbInstance');
const releaseService = require('./releaseService');

const db = getDBInstance();
const DATABASE_NAME = 'peakmode';
const RELEASES = 'releases';
const READS = 'release_reads';

async function readAllReleases(includeDeleted = false) {
    const query = includeDeleted ? {} : { deletedAt: null };
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: RELEASES,
        command: '--read',
        data: query
    });
    if (!result.success || !result.data) return [];
    return (Array.isArray(result.data) ? result.data : [result.data])
        .map(releaseService.normalizeId)
        .filter((d) => includeDeleted || !d.deletedAt);
}

async function readReleaseById(id) {
    const query = releaseService.buildLookupQuery(id);
    if (!query) return null;
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: RELEASES,
        command: '--read',
        data: query
    });
    if (!result.success || !result.data) return null;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    const row = rows.find((r) => !r.deletedAt) || rows[0];
    return releaseService.normalizeId(row);
}

function writableFields(updateFields) {
    if (!updateFields || typeof updateFields !== 'object') return {};
    const { _id, ...rest } = updateFields;
    return rest;
}

async function updateReleaseById(id, updateFields) {
    const query = releaseService.buildLookupQuery(id);
    if (!query) return { success: false, error: 'Invalid id' };
    return db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: RELEASES,
        command: '--update',
        data: { filter: query, update: writableFields(updateFields) }
    });
}

async function createRelease(doc) {
    const createResult = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: RELEASES,
        command: '--create',
        data: doc
    });
    if (!createResult.success) return { success: false, error: createResult.error || 'Failed to create release' };
    const insertedId = createResult.data?.insertedId?.toString?.();
    if (insertedId) {
        await updateReleaseById(insertedId, { id: insertedId });
    }
    const created = insertedId ? await readReleaseById(insertedId) : doc;
    return { success: true, data: created };
}

async function publishDueScheduled() {
    const now = new Date();
    const rows = await readAllReleases();
    const due = rows.filter(
        (doc) => doc.status === 'scheduled' && doc.scheduledAt && new Date(doc.scheduledAt) <= now
    );
    const publishedAt = releaseService.nowIso();
    for (const doc of due) {
        await updateReleaseById(doc.id, {
            status: 'published',
            publishedAt: doc.publishedAt || publishedAt,
            updatedAt: publishedAt
        });
    }
    return due.length;
}

async function livePublished({ surface, role }) {
    await publishDueScheduled();
    const now = new Date();
    return (await readAllReleases())
        .filter((doc) => releaseService.isPublishedAndLive(doc, now))
        .filter((doc) => releaseService.matchesAudience(doc, { surface, role }))
        .sort(releaseService.comparePublishedDesc);
}

async function readReceiptsForReader(readerId) {
    const id = String(readerId || '').trim();
    if (!id) return [];
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: READS,
        command: '--read',
        data: { readerId: id }
    });
    if (!result.success || !result.data) return [];
    return (Array.isArray(result.data) ? result.data : [result.data]).map(releaseService.normalizeId);
}

async function readReceipt(releaseId, readerId) {
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: READS,
        command: '--read',
        data: { releaseId: String(releaseId), readerId: String(readerId) }
    });
    if (!result.success || !result.data) return null;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    return releaseService.normalizeId(rows[0] || null);
}

async function upsertReceipt(releaseId, readerId, readerKind, patch) {
    const existing = await readReceipt(releaseId, readerId);
    const stamp = releaseService.nowIso();
    if (!existing) {
        const doc = {
            releaseId: String(releaseId),
            readerId: String(readerId),
            readerKind,
            readAt: patch.readAt || null,
            dismissedAt: patch.dismissedAt || null,
            bannerDismissedAt: patch.bannerDismissedAt || null,
            createdAt: stamp,
            updatedAt: stamp
        };
        const created = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: READS,
            command: '--create',
            data: doc
        });
        const insertedId = created.data?.insertedId?.toString?.();
        if (insertedId) {
            await db.executeOperation({
                database_name: DATABASE_NAME,
                collection_name: READS,
                command: '--update',
                data: { filter: { _id: insertedId }, update: { id: insertedId } }
            });
        }
        return { ...doc, id: insertedId };
    }
    const update = { ...patch, updatedAt: stamp };
    await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: READS,
        command: '--update',
        data: {
            filter: releaseService.buildLookupQuery(existing.id) || { readerId, releaseId },
            update
        }
    });
    return { ...existing, ...update };
}

function receiptMap(receipts) {
    const map = new Map();
    for (const row of receipts) {
        if (row?.releaseId) map.set(String(row.releaseId), row);
    }
    return map;
}

function attachReceipts(docs, receipts) {
    const map = receiptMap(receipts);
    return docs.map((doc) => releaseService.toPublicItem(doc, map.get(String(doc.id))));
}

module.exports = {
    readAllReleases,
    readReleaseById,
    updateReleaseById,
    createRelease,
    publishDueScheduled,
    livePublished,
    readReceiptsForReader,
    readReceipt,
    upsertReceipt,
    attachReceipts
};
