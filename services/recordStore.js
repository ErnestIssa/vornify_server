/**
 * Mongo access for Admin Records (items, categories, dossiers, activity).
 */

const getDBInstance = require('../vornifydb/dbInstance');
const recordService = require('./recordService');

const db = getDBInstance();
const DATABASE_NAME = 'peakmode';
const ITEMS = 'admin_records';
const CATEGORIES = 'admin_record_categories';
const DOSSIERS = 'admin_record_dossiers';
const ACTIVITY = 'admin_record_activity';
const TAGS = 'admin_record_tags';

function writableFields(updateFields) {
    if (!updateFields || typeof updateFields !== 'object') return {};
    const { _id, ...rest } = updateFields;
    return rest;
}

async function readAll(collection) {
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: collection,
        command: '--read',
        data: {}
    });
    if (!result.success || !result.data) return [];
    return (Array.isArray(result.data) ? result.data : [result.data])
        .map(recordService.normalizeId)
        .filter(Boolean);
}

async function readById(collection, id) {
    const query = recordService.buildLookupQuery(id);
    if (!query) return null;
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: collection,
        command: '--read',
        data: query
    });
    if (!result.success || !result.data) return null;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    return recordService.normalizeId(rows[0]);
}

async function createDoc(collection, doc) {
    const createResult = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: collection,
        command: '--create',
        data: doc
    });
    if (!createResult.success) {
        return { success: false, error: createResult.error || 'Failed to create' };
    }
    const insertedId = createResult.data?.insertedId?.toString?.();
    if (insertedId && !doc.id) {
        await updateById(collection, insertedId, { id: insertedId });
    }
    const id = doc.id || insertedId;
    const created = id ? await readById(collection, id) : doc;
    return { success: true, data: created };
}

async function updateById(collection, id, updateFields) {
    const query = recordService.buildLookupQuery(id);
    if (!query) return { success: false, error: 'Invalid id' };
    return db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: collection,
        command: '--update',
        data: { filter: query, update: writableFields(updateFields) }
    });
}

async function deleteById(collection, id) {
    const query = recordService.buildLookupQuery(id);
    if (!query) return { success: false, error: 'Invalid id' };
    return db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: collection,
        command: '--delete',
        data: query
    });
}

async function readItems() {
    return readAll(ITEMS);
}

async function readItemById(id) {
    return readById(ITEMS, id);
}

async function createItem(doc) {
    return createDoc(ITEMS, doc);
}

async function updateItemById(id, fields) {
    return updateById(ITEMS, id, fields);
}

async function deleteItemById(id) {
    return deleteById(ITEMS, id);
}

async function readCategories() {
    return readAll(CATEGORIES);
}

async function readCategoryById(id) {
    return readById(CATEGORIES, id);
}

async function createCategory(doc) {
    return createDoc(CATEGORIES, doc);
}

async function updateCategoryById(id, fields) {
    return updateById(CATEGORIES, id, fields);
}

async function deleteCategoryById(id) {
    return deleteById(CATEGORIES, id);
}

async function readDossiers() {
    return readAll(DOSSIERS);
}

async function readDossierById(id) {
    return readById(DOSSIERS, id);
}

async function createDossier(doc) {
    return createDoc(DOSSIERS, doc);
}

async function updateDossierById(id, fields) {
    return updateById(DOSSIERS, id, fields);
}

async function deleteDossierById(id) {
    return deleteById(DOSSIERS, id);
}

async function readActivity(limit = 200) {
    const cap = Math.min(500, Math.max(1, Number(limit) || 200));
    const rows = await readAll(ACTIVITY);
    return rows
        .sort((a, b) => String(b.at || b.createdAt || '').localeCompare(String(a.at || a.createdAt || '')))
        .slice(0, cap);
}

/**
 * Recent match for view-dedupe (same admin + record + action after `sinceIso`).
 */
async function findRecentActivity({ actorId, itemId, action, sinceIso }) {
    const aid = String(actorId || '').trim();
    const iid = String(itemId || '').trim();
    const act = String(action || '').trim();
    if (!aid || !iid || !act || !sinceIso) return null;

    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: ACTIVITY,
        command: '--read',
        data: { actorId: aid, itemId: iid, action: act }
    });
    if (!result.success || !result.data) return null;
    const rows = (Array.isArray(result.data) ? result.data : [result.data])
        .map(recordService.normalizeId)
        .filter(Boolean)
        .filter((row) => String(row.at || row.createdAt || '') >= String(sinceIso))
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return rows[0] || null;
}

async function createActivity(entry) {
    if (!entry || typeof entry !== 'object') {
        return { success: false, error: 'Invalid activity entry' };
    }
    return createDoc(ACTIVITY, entry);
}

async function readTags() {
    return readAll(TAGS);
}

async function readTagByName(name) {
    const tag = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/^#/, '');
    if (!tag) return null;
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: TAGS,
        command: '--read',
        data: { name: tag }
    });
    if (!result.success || !result.data) return null;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    return recordService.normalizeId(rows[0]);
}

async function createTag(doc) {
    return createDoc(TAGS, doc);
}

async function deleteTagByName(name) {
    const tag = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/^#/, '');
    if (!tag) return { success: false, error: 'Invalid tag' };
    return db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: TAGS,
        command: '--delete',
        data: { name: tag }
    });
}

async function renameTag(oldName, newName) {
    const from = String(oldName || '')
        .trim()
        .toLowerCase()
        .replace(/^#/, '');
    const to = String(newName || '')
        .trim()
        .toLowerCase()
        .replace(/^#/, '');
    if (!from || !to) return { success: false, error: 'Invalid tag' };
    if (from === to) return { success: true, name: to, renamedOn: 0 };

    const existing = await readTagByName(from);
    const clash = await readTagByName(to);
    if (clash && (!existing || clash.id !== existing.id)) {
        return { success: false, error: 'That tag name already exists' };
    }

    const items = await readItems();
    let renamedOn = 0;
    for (const item of items) {
        const tags = Array.isArray(item.tags) ? item.tags : [];
        if (!tags.includes(from)) continue;
        const next = [...new Set(tags.map((tag) => (tag === from ? to : tag)))];
        await updateItemById(item.id, { tags: next, updatedAt: recordService.nowIso() });
        renamedOn += 1;
    }

    if (existing) {
        await updateById(TAGS, existing.id, { name: to });
    } else {
        await createTag({
            id: recordService.newId('tag'),
            name: to,
            createdAt: recordService.nowIso()
        });
    }

    return { success: true, name: to, renamedOn };
}

module.exports = {
    DATABASE_NAME,
    ITEMS,
    CATEGORIES,
    DOSSIERS,
    ACTIVITY,
    TAGS,
    readItems,
    readItemById,
    createItem,
    updateItemById,
    deleteItemById,
    readCategories,
    readCategoryById,
    createCategory,
    updateCategoryById,
    deleteCategoryById,
    readDossiers,
    readDossierById,
    createDossier,
    updateDossierById,
    deleteDossierById,
    readActivity,
    findRecentActivity,
    createActivity,
    readTags,
    readTagByName,
    createTag,
    deleteTagByName,
    renameTag
};
