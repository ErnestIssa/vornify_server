/**
 * Bootstrap Admin Records from seeds/admin/records.json when collections are empty.
 */

const fs = require('fs');
const path = require('path');
const recordService = require('./recordService');
const recordStore = require('./recordStore');

function resolveSeedPath() {
    const candidates = [
        path.join(__dirname, '../seeds/admin/records.json'),
        path.join(__dirname, '../../Seeds/admin/records.json')
    ];
    return candidates.find((filePath) => fs.existsSync(filePath)) || null;
}

function loadSeedFile() {
    const filePath = resolveSeedPath();
    if (!filePath) {
        return { error: 'Records seed file not found (expected vornify_server/seeds/admin/records.json)' };
    }
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { data: raw, path: filePath };
    } catch (err) {
        return { error: `Failed to read records seed: ${err.message}` };
    }
}

async function seedFromFile({ force = false } = {}) {
    const loaded = loadSeedFile();
    if (loaded.error) return { success: false, error: loaded.error };

    const existingItems = await recordStore.readItems();
    const existingCategories = await recordStore.readCategories();
    if (!force && (existingItems.length > 0 || existingCategories.length > 0)) {
        return {
            success: false,
            error: 'Records already contain data. Pass force=true to re-seed (destructive).',
            code: 'NOT_EMPTY',
            counts: {
                items: existingItems.length,
                categories: existingCategories.length
            }
        };
    }

    if (force) {
        for (const item of existingItems) {
            await recordStore.deleteItemById(item.id);
        }
        for (const category of existingCategories) {
            await recordStore.deleteCategoryById(category.id);
        }
        for (const dossier of await recordStore.readDossiers()) {
            await recordStore.deleteDossierById(dossier.id);
        }
        for (const tag of await recordStore.readTags()) {
            await recordStore.deleteTagByName(tag.name || tag.id);
        }
        for (const entry of await recordStore.readActivity()) {
            // Hard delete activity rows used only for demo seed reset
            const getDBInstance = require('../vornifydb/dbInstance');
            const db = getDBInstance();
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: recordStore.ACTIVITY,
                command: '--delete',
                data: recordService.buildLookupQuery(entry.id)
            });
        }
    }

    const seed = loaded.data;
    const stamp = recordService.nowIso();
    let categories = 0;
    let dossiers = 0;
    let items = 0;
    let activity = 0;
    let tags = 0;

    for (const category of seed.categories || []) {
        const id = String(category.id || recordService.newId('cat'));
        await recordStore.createCategory({
            id,
            title: category.title,
            description: category.description || '',
            createdAt: stamp,
            updatedAt: stamp
        });
        categories += 1;
    }

    for (const dossier of seed.dossiers || []) {
        const id = String(dossier.id || recordService.newId('dossier'));
        await recordStore.createDossier({
            id,
            title: dossier.title,
            subject: dossier.subject || '',
            description: dossier.description || '',
            createdAt: stamp,
            updatedAt: stamp
        });
        dossiers += 1;
    }

    const tagNames = new Set();
    for (const item of seed.records || []) {
        const tagsList = recordService.normalizeTags(item.tags || []);
        tagsList.forEach((tag) => tagNames.add(tag));
        await recordStore.createItem({
            id: String(item.id || recordService.newId('rec')),
            type: item.type,
            title: item.title,
            description: item.description || '',
            categoryId: item.categoryId,
            tags: tagsList,
            dossierId: item.dossierId || null,
            linkedTo: item.linkedTo || null,
            visibility: item.visibility || 'everyone',
            status: item.status || 'draft',
            expiresAt: recordService.resolveDaysFromNow(item.expiresAt),
            awaitingSignature: Boolean(item.awaitingSignature),
            pinned: Boolean(item.pinned),
            addedBy: item.addedBy || 'System',
            addedById: null,
            createdAt: recordService.resolveDaysFromNow(item.createdAt) || stamp,
            updatedAt: recordService.resolveDaysFromNow(item.updatedAt) || stamp,
            fileName: item.fileName,
            fileSize: item.fileSize,
            url: item.url,
            body: item.body,
            deletedAt: null
        });
        items += 1;
    }

    for (const name of tagNames) {
        await recordStore.createTag({
            id: recordService.newId('tag'),
            name,
            createdAt: stamp
        });
        tags += 1;
    }

    for (const entry of seed.activity || []) {
        await recordStore.createActivity({
            id: String(entry.id || recordService.newId('act')),
            actor: entry.actor || 'System',
            actorId: null,
            action: entry.action,
            itemId: null,
            itemTitle: entry.itemTitle || '',
            at: recordService.resolveDaysFromNow(entry.at) || stamp,
            detail: entry.detail || undefined,
            createdAt: stamp
        });
        activity += 1;
    }

    return {
        success: true,
        path: loaded.path,
        counts: { categories, dossiers, items, activity, tags }
    };
}

module.exports = { resolveSeedPath, loadSeedFile, seedFromFile };
