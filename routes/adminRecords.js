/**
 * Admin Records API — private business material (files, photos, links, notes).
 * Mounted at /api/admin/records
 */

const express = require('express');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { requirePermission, requireAnyPermission } = require('../middleware/requirePermission');
const recordService = require('../services/recordService');
const recordStore = require('../services/recordStore');
const recordSeedService = require('../services/recordSeedService');

const router = express.Router();

function actor(req) {
    return recordService.actorPerson(req.admin);
}

function queryOf(req) {
    const type = String(req.query.type || 'all');
    const status = String(req.query.status || 'all');
    const flag = String(req.query.flag || 'all');
    return {
        view: String(req.query.view || 'all'),
        q: String(req.query.q || '').trim(),
        type: recordService.TYPES.includes(type) || type === 'all' ? type : 'all',
        categoryId: String(req.query.categoryId || 'all').trim() || 'all',
        status: recordService.STATUSES.includes(status) || status === 'all' ? status : 'all',
        addedBy: String(req.query.addedBy || 'all').trim() || 'all',
        dossierId: String(req.query.dossierId || '').trim(),
        tag: String(req.query.tag || '')
            .trim()
            .toLowerCase()
            .replace(/^#/, ''),
        flag: recordService.FLAGS.includes(flag) ? flag : 'all',
        sort: String(req.query.sort || 'recent'),
        includeArchived: String(req.query.includeArchived || '') === 'true'
    };
}

async function writeActivity({ admin, action, item, detail }) {
    const person = recordService.actorPerson(admin);
    const stamp = recordService.nowIso();
    return recordStore.createActivity({
        id: recordService.newId('act'),
        actor: person.name,
        actorId: person.id,
        action,
        itemId: item?.id || null,
        itemTitle: item?.title || '',
        at: stamp,
        detail: detail || undefined,
        createdAt: stamp
    });
}

function rejectMissing(doc, res, label = 'Record') {
    if (!doc) {
        res.status(404).json({ success: false, error: `${label} not found` });
        return true;
    }
    return false;
}

function rejectVisibility(doc, req, res) {
    if (!recordService.canSeeVisibility(req.admin, doc.visibility)) {
        res.status(403).json({
            success: false,
            error: 'You do not have permission to open this record',
            code: 'RECORD_VISIBILITY_DENIED'
        });
        return true;
    }
    return false;
}

/* ---------- catalog / bootstrap ---------- */

router.get('/catalog', authenticateAdmin, requirePermission('records.view'), (_req, res) => {
    res.json({ success: true, catalog: recordService.catalog() });
});

router.post('/seed', authenticateAdmin, requirePermission('records.manage'), async (req, res) => {
    try {
        const force = Boolean(req.body?.force);
        const result = await recordSeedService.seedFromFile({ force });
        if (!result.success) {
            const status = result.code === 'NOT_EMPTY' ? 409 : 400;
            return res.status(status).json(result);
        }
        res.json(result);
    } catch (err) {
        console.error('[RECORDS] seed error:', err);
        res.status(500).json({ success: false, error: 'Failed to seed records' });
    }
});

/* ---------- categories ---------- */

router.get('/categories', authenticateAdmin, requirePermission('records.view'), async (_req, res) => {
    try {
        const items = await recordStore.readItems();
        const categories = (await recordStore.readCategories())
            .map(recordService.toPublicCategory)
            .filter(Boolean)
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((category) => ({
                ...category,
                count: items.filter((item) => item.categoryId === category.id && recordService.isLive(item)).length
            }));
        res.json({ success: true, items: categories });
    } catch (err) {
        console.error('[RECORDS] categories list error:', err);
        res.status(500).json({ success: false, error: 'Failed to list categories' });
    }
});

router.post('/categories', authenticateAdmin, requirePermission('records.manage'), async (req, res) => {
    try {
        const parsed = recordService.validateCategoryInput(req.body || {});
        if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
        const stamp = recordService.nowIso();
        const id = parsed.value.id || recordService.newId('cat');
        const existing = await recordStore.readCategoryById(id);
        if (existing) return res.status(409).json({ success: false, error: 'Category id already exists' });
        const created = await recordStore.createCategory({
            id,
            title: parsed.value.title,
            description: parsed.value.description || '',
            createdAt: stamp,
            updatedAt: stamp
        });
        if (!created.success) return res.status(500).json({ success: false, error: created.error });
        res.status(201).json({ success: true, item: recordService.toPublicCategory(created.data) });
    } catch (err) {
        console.error('[RECORDS] category create error:', err);
        res.status(500).json({ success: false, error: 'Failed to create category' });
    }
});

router.patch('/categories/:id', authenticateAdmin, requirePermission('records.manage'), async (req, res) => {
    try {
        const existing = await recordStore.readCategoryById(req.params.id);
        if (rejectMissing(existing, res, 'Category')) return;
        const parsed = recordService.validateCategoryInput(req.body || {}, { partial: true });
        if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
        const patch = { ...parsed.value, updatedAt: recordService.nowIso() };
        delete patch.id;
        await recordStore.updateCategoryById(existing.id, patch);
        const updated = await recordStore.readCategoryById(existing.id);
        res.json({ success: true, item: recordService.toPublicCategory(updated) });
    } catch (err) {
        console.error('[RECORDS] category update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update category' });
    }
});

router.delete('/categories/:id', authenticateAdmin, requirePermission('records.manage'), async (req, res) => {
    try {
        const existing = await recordStore.readCategoryById(req.params.id);
        if (rejectMissing(existing, res, 'Category')) return;
        const items = await recordStore.readItems();
        const inUse = items.some((item) => item.categoryId === existing.id && recordService.isLive(item));
        if (inUse) {
            return res.status(409).json({
                success: false,
                error: 'Move or archive records in this category before deleting it'
            });
        }
        await recordStore.deleteCategoryById(existing.id);
        res.json({ success: true });
    } catch (err) {
        console.error('[RECORDS] category delete error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete category' });
    }
});

/* ---------- dossiers ---------- */

router.get('/dossiers', authenticateAdmin, requirePermission('records.view'), async (req, res) => {
    try {
        const items = await recordStore.readItems();
        const dossiers = (await recordStore.readDossiers())
            .map(recordService.toPublicDossier)
            .filter(Boolean)
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((dossier) => ({
                ...dossier,
                count: items.filter(
                    (item) =>
                        item.dossierId === dossier.id &&
                        recordService.isLive(item) &&
                        recordService.canSeeVisibility(req.admin, item.visibility)
                ).length
            }));
        res.json({ success: true, items: dossiers });
    } catch (err) {
        console.error('[RECORDS] dossiers list error:', err);
        res.status(500).json({ success: false, error: 'Failed to list dossiers' });
    }
});

router.post('/dossiers', authenticateAdmin, requireAnyPermission('records.create', 'records.manage'), async (req, res) => {
    try {
        const parsed = recordService.validateDossierInput(req.body || {});
        if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
        const stamp = recordService.nowIso();
        const created = await recordStore.createDossier({
            id: recordService.newId('dossier'),
            title: parsed.value.title,
            subject: parsed.value.subject || '',
            description: parsed.value.description || '',
            createdAt: stamp,
            updatedAt: stamp
        });
        if (!created.success) return res.status(500).json({ success: false, error: created.error });
        res.status(201).json({ success: true, item: recordService.toPublicDossier(created.data) });
    } catch (err) {
        console.error('[RECORDS] dossier create error:', err);
        res.status(500).json({ success: false, error: 'Failed to create dossier' });
    }
});

router.get('/dossiers/:id', authenticateAdmin, requirePermission('records.view'), async (req, res) => {
    try {
        const dossier = await recordStore.readDossierById(req.params.id);
        if (rejectMissing(dossier, res, 'Dossier')) return;
        const items = (await recordStore.readItems())
            .filter(
                (item) =>
                    item.dossierId === dossier.id &&
                    recordService.isLive(item) &&
                    recordService.canSeeVisibility(req.admin, item.visibility)
            )
            .map(recordService.toPublic);
        res.json({
            success: true,
            item: recordService.toPublicDossier(dossier),
            records: recordService.sortRecords(items)
        });
    } catch (err) {
        console.error('[RECORDS] dossier get error:', err);
        res.status(500).json({ success: false, error: 'Failed to load dossier' });
    }
});

router.patch('/dossiers/:id', authenticateAdmin, requireAnyPermission('records.edit', 'records.manage'), async (req, res) => {
    try {
        const existing = await recordStore.readDossierById(req.params.id);
        if (rejectMissing(existing, res, 'Dossier')) return;
        const parsed = recordService.validateDossierInput(req.body || {}, { partial: true });
        if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
        await recordStore.updateDossierById(existing.id, {
            ...parsed.value,
            updatedAt: recordService.nowIso()
        });
        const updated = await recordStore.readDossierById(existing.id);
        res.json({ success: true, item: recordService.toPublicDossier(updated) });
    } catch (err) {
        console.error('[RECORDS] dossier update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update dossier' });
    }
});

router.delete('/dossiers/:id', authenticateAdmin, requirePermission('records.manage'), async (req, res) => {
    try {
        const existing = await recordStore.readDossierById(req.params.id);
        if (rejectMissing(existing, res, 'Dossier')) return;
        const items = await recordStore.readItems();
        const linked = items.filter((item) => item.dossierId === existing.id && recordService.isLive(item));
        for (const item of linked) {
            await recordStore.updateItemById(item.id, { dossierId: null, updatedAt: recordService.nowIso() });
        }
        await recordStore.deleteDossierById(existing.id);
        res.json({ success: true, unlinked: linked.length });
    } catch (err) {
        console.error('[RECORDS] dossier delete error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete dossier' });
    }
});

/* ---------- tags ---------- */

router.get('/tags', authenticateAdmin, requirePermission('records.view'), async (req, res) => {
    try {
        const items = (await recordStore.readItems()).filter(
            (item) => recordService.isLive(item) && recordService.canSeeVisibility(req.admin, item.visibility)
        );
        const counts = new Map();
        for (const item of items) {
            for (const tag of item.tags || []) {
                counts.set(tag, (counts.get(tag) || 0) + 1);
            }
        }
        const registered = await recordStore.readTags();
        for (const row of registered) {
            const name = String(row.name || '').toLowerCase();
            if (name && !counts.has(name)) counts.set(name, 0);
        }
        const tags = [...counts.entries()]
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        res.json({ success: true, items: tags });
    } catch (err) {
        console.error('[RECORDS] tags list error:', err);
        res.status(500).json({ success: false, error: 'Failed to list tags' });
    }
});

router.post('/tags', authenticateAdmin, requirePermission('records.manage'), async (req, res) => {
    try {
        const name = recordService.normalizeTags([req.body?.name || req.body?.tag])[0];
        if (!name) return res.status(400).json({ success: false, error: 'Tag name is required' });
        const existing = await recordStore.readTagByName(name);
        if (existing) return res.json({ success: true, item: { name, count: 0 } });
        await recordStore.createTag({
            id: recordService.newId('tag'),
            name,
            createdAt: recordService.nowIso()
        });
        res.status(201).json({ success: true, item: { name, count: 0 } });
    } catch (err) {
        console.error('[RECORDS] tag create error:', err);
        res.status(500).json({ success: false, error: 'Failed to create tag' });
    }
});

router.delete('/tags/:tag', authenticateAdmin, requirePermission('records.manage'), async (req, res) => {
    try {
        const name = recordService.normalizeTags([req.params.tag])[0];
        if (!name) return res.status(400).json({ success: false, error: 'Invalid tag' });
        const items = await recordStore.readItems();
        let updated = 0;
        for (const item of items) {
            if (!(item.tags || []).includes(name)) continue;
            const nextTags = (item.tags || []).filter((tag) => tag !== name);
            await recordStore.updateItemById(item.id, { tags: nextTags, updatedAt: recordService.nowIso() });
            updated += 1;
        }
        await recordStore.deleteTagByName(name);
        res.json({ success: true, removedFrom: updated });
    } catch (err) {
        console.error('[RECORDS] tag delete error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete tag' });
    }
});

/* ---------- activity / reminders ---------- */

router.get('/activity', authenticateAdmin, requirePermission('records.view'), async (req, res) => {
    try {
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const items = (await recordStore.readActivity())
            .map(recordService.toPublicActivity)
            .filter(Boolean)
            .slice(0, limit);
        res.json({ success: true, items });
    } catch (err) {
        console.error('[RECORDS] activity list error:', err);
        res.status(500).json({ success: false, error: 'Failed to list activity' });
    }
});

router.get('/reminders', authenticateAdmin, requirePermission('records.view'), async (req, res) => {
    try {
        const query = { ...queryOf(req), view: 'reminders' };
        const items = recordService
            .sortRecords(
                (await recordStore.readItems()).filter((item) => recordService.matchesFilters(item, query, req.admin)),
                'expiry'
            )
            .map(recordService.toPublic);
        res.json({ success: true, items });
    } catch (err) {
        console.error('[RECORDS] reminders error:', err);
        res.status(500).json({ success: false, error: 'Failed to list reminders' });
    }
});

/* ---------- items ---------- */

router.get('/', authenticateAdmin, requirePermission('records.view'), async (req, res) => {
    try {
        const query = queryOf(req);
        const documents = await recordStore.readItems();
        const stats = recordService.computeStats(documents, req.admin);
        const filtered = recordService.sortRecords(
            documents.filter((item) => recordService.matchesFilters(item, query, req.admin)),
            query.sort
        );
        const people = [
            ...new Set(
                documents
                    .filter((item) => recordService.canSeeVisibility(req.admin, item.visibility))
                    .map((item) => item.addedBy)
                    .filter(Boolean)
            )
        ].sort((a, b) => a.localeCompare(b));

        res.json({
            success: true,
            items: filtered.map(recordService.toPublic),
            stats,
            people,
            catalog: recordService.catalog()
        });
    } catch (err) {
        console.error('[RECORDS] list error:', err);
        res.status(500).json({ success: false, error: 'Failed to list records' });
    }
});

router.post('/', authenticateAdmin, requirePermission('records.create'), async (req, res) => {
    try {
        const parsed = recordService.validateCreateInput(req.body || {});
        if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });

        const category = await recordStore.readCategoryById(parsed.value.categoryId);
        if (!category) return res.status(400).json({ success: false, error: 'Unknown category' });
        if (parsed.value.dossierId) {
            const dossier = await recordStore.readDossierById(parsed.value.dossierId);
            if (!dossier) return res.status(400).json({ success: false, error: 'Unknown dossier' });
        }
        if (!recordService.canSeeVisibility(req.admin, parsed.value.visibility)) {
            return res.status(403).json({
                success: false,
                error: 'You cannot create a record with this visibility',
                code: 'RECORD_VISIBILITY_DENIED'
            });
        }

        const doc = recordService.buildCreateDoc(parsed.value, actor(req));
        const created = await recordStore.createItem(doc);
        if (!created.success) return res.status(500).json({ success: false, error: created.error });

        for (const tag of doc.tags || []) {
            const existing = await recordStore.readTagByName(tag);
            if (!existing) {
                await recordStore.createTag({
                    id: recordService.newId('tag'),
                    name: tag,
                    createdAt: recordService.nowIso()
                });
            }
        }

        await writeActivity({
            admin: req.admin,
            action: 'uploaded',
            item: created.data,
            detail: `Added "${created.data.title}" to Records.`
        });

        res.status(201).json({ success: true, item: recordService.toPublic(created.data) });
    } catch (err) {
        console.error('[RECORDS] create error:', err);
        res.status(500).json({ success: false, error: 'Failed to create record' });
    }
});

router.get('/:id', authenticateAdmin, requirePermission('records.view'), async (req, res) => {
    try {
        const item = await recordStore.readItemById(req.params.id);
        if (rejectMissing(item, res)) return;
        if (rejectVisibility(item, req, res)) return;

        await writeActivity({
            admin: req.admin,
            action: 'viewed',
            item,
            detail: `Opened "${item.title}".`
        });

        res.json({ success: true, item: recordService.toPublic(item) });
    } catch (err) {
        console.error('[RECORDS] get error:', err);
        res.status(500).json({ success: false, error: 'Failed to load record' });
    }
});

router.patch('/:id', authenticateAdmin, requirePermission('records.edit'), async (req, res) => {
    try {
        const existing = await recordStore.readItemById(req.params.id);
        if (rejectMissing(existing, res)) return;
        if (rejectVisibility(existing, req, res)) return;

        const applied = recordService.applyUpdate(existing, req.body || {});
        if (applied.error) return res.status(400).json({ success: false, error: applied.error });

        if (applied.value.categoryId) {
            const category = await recordStore.readCategoryById(applied.value.categoryId);
            if (!category) return res.status(400).json({ success: false, error: 'Unknown category' });
        }
        if (applied.value.dossierId) {
            const dossier = await recordStore.readDossierById(applied.value.dossierId);
            if (!dossier) return res.status(400).json({ success: false, error: 'Unknown dossier' });
        }
        if (!recordService.canSeeVisibility(req.admin, applied.value.visibility)) {
            return res.status(403).json({
                success: false,
                error: 'You cannot set this visibility',
                code: 'RECORD_VISIBILITY_DENIED'
            });
        }

        const { _id, ...fields } = applied.value;
        await recordStore.updateItemById(existing.id, fields);
        const updated = await recordStore.readItemById(existing.id);

        for (const tag of updated.tags || []) {
            const existingTag = await recordStore.readTagByName(tag);
            if (!existingTag) {
                await recordStore.createTag({
                    id: recordService.newId('tag'),
                    name: tag,
                    createdAt: recordService.nowIso()
                });
            }
        }

        await writeActivity({
            admin: req.admin,
            action: 'edited',
            item: updated,
            detail: `Edited "${updated.title}".`
        });

        res.json({ success: true, item: recordService.toPublic(updated) });
    } catch (err) {
        console.error('[RECORDS] update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update record' });
    }
});

router.post('/:id/archive', authenticateAdmin, requirePermission('records.edit'), async (req, res) => {
    try {
        const existing = await recordStore.readItemById(req.params.id);
        if (rejectMissing(existing, res)) return;
        if (rejectVisibility(existing, req, res)) return;
        if (recordService.isArchived(existing)) {
            return res.json({ success: true, item: recordService.toPublic(existing) });
        }
        const stamp = recordService.nowIso();
        await recordStore.updateItemById(existing.id, {
            status: 'archived',
            pinned: false,
            updatedAt: stamp
        });
        const updated = await recordStore.readItemById(existing.id);
        await writeActivity({
            admin: req.admin,
            action: 'archived',
            item: updated,
            detail: `Moved "${updated.title}" to Archive.`
        });
        res.json({ success: true, item: recordService.toPublic(updated) });
    } catch (err) {
        console.error('[RECORDS] archive error:', err);
        res.status(500).json({ success: false, error: 'Failed to archive record' });
    }
});

router.post('/:id/restore', authenticateAdmin, requirePermission('records.edit'), async (req, res) => {
    try {
        const existing = await recordStore.readItemById(req.params.id);
        if (rejectMissing(existing, res)) return;
        if (rejectVisibility(existing, req, res)) return;
        const stamp = recordService.nowIso();
        await recordStore.updateItemById(existing.id, {
            status: 'active',
            deletedAt: null,
            updatedAt: stamp
        });
        const updated = await recordStore.readItemById(existing.id);
        await writeActivity({
            admin: req.admin,
            action: 'restored',
            item: updated,
            detail: `Restored "${updated.title}" from Archive.`
        });
        res.json({ success: true, item: recordService.toPublic(updated) });
    } catch (err) {
        console.error('[RECORDS] restore error:', err);
        res.status(500).json({ success: false, error: 'Failed to restore record' });
    }
});

router.post('/:id/pin', authenticateAdmin, requirePermission('records.edit'), async (req, res) => {
    try {
        const existing = await recordStore.readItemById(req.params.id);
        if (rejectMissing(existing, res)) return;
        if (rejectVisibility(existing, req, res)) return;
        if (recordService.isArchived(existing)) {
            return res.status(409).json({ success: false, error: 'Restore this record before pinning it' });
        }
        const pinned = req.body?.pinned != null ? Boolean(req.body.pinned) : !existing.pinned;
        await recordStore.updateItemById(existing.id, { pinned, updatedAt: recordService.nowIso() });
        const updated = await recordStore.readItemById(existing.id);
        res.json({ success: true, item: recordService.toPublic(updated) });
    } catch (err) {
        console.error('[RECORDS] pin error:', err);
        res.status(500).json({ success: false, error: 'Failed to update pin' });
    }
});

router.delete('/:id', authenticateAdmin, requirePermission('records.delete'), async (req, res) => {
    try {
        const existing = await recordStore.readItemById(req.params.id);
        if (rejectMissing(existing, res)) return;
        if (rejectVisibility(existing, req, res)) return;
        await writeActivity({
            admin: req.admin,
            action: 'deleted',
            item: existing,
            detail: `Deleted "${existing.title}".`
        });
        await recordStore.deleteItemById(existing.id);
        res.json({ success: true });
    } catch (err) {
        console.error('[RECORDS] delete error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete record' });
    }
});

module.exports = router;
