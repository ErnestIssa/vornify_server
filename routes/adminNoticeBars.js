const express = require('express');
const getDBInstance = require('../vornifydb/dbInstance');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { requirePermission } = require('../middleware/requirePermission');
const noticeBarService = require('../services/noticeBarService');
const cacheInvalidation = require('../services/cacheInvalidation');

const router = express.Router();
const db = getDBInstance();

const DATABASE_NAME = 'peakmode';
const COLLECTION_NAME = 'notice_bars';

async function readAllNoticeBars(includeDeleted = false) {
    const query = includeDeleted ? {} : { deletedAt: null };
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTION_NAME,
        command: '--read',
        data: query
    });
    if (!result.success || !result.data) return [];
    return Array.isArray(result.data) ? result.data : [result.data];
}

async function readNoticeBarById(id) {
    const query = noticeBarService.buildProductLookupQuery(id);
    if (!query) return null;
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTION_NAME,
        command: '--read',
        data: query
    });
    if (!result.success || !result.data) return null;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    const row = rows.find((r) => !r.deletedAt) || rows[0];
    return row || null;
}

async function updateNoticeBarById(id, updateFields) {
    const query = noticeBarService.buildProductLookupQuery(id);
    if (!query) return { success: false, error: 'Invalid id' };
    return db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTION_NAME,
        command: '--update',
        data: {
            filter: query,
            update: updateFields
        }
    });
}

/**
 * GET /api/admin/notice-bars
 */
router.get('/notice-bars', authenticateAdmin, requirePermission('hub.view'), async (req, res) => {
    try {
        const includeDeleted = req.query.includeDeleted === 'true';
        const rows = await readAllNoticeBars(includeDeleted);
        const items = rows
            .map(noticeBarService.normalizeId)
            .filter((d) => includeDeleted || !d.deletedAt)
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))
            .map(noticeBarService.toListItem);
        res.json({
            success: true,
            items,
            placementOptions: noticeBarService.NOTICE_BAR_PLACEMENTS,
            placementAliases: noticeBarService.PLACEMENT_ALIASES,
            animationOptions: noticeBarService.NOTICE_BAR_ANIMATIONS,
            animationAliases: noticeBarService.ANIMATION_ALIASES
        });
    } catch (err) {
        console.error('[NOTICE BARS] list error:', err);
        res.status(500).json({ success: false, error: 'Failed to list notice bars' });
    }
});

/**
 * POST /api/admin/notice-bars — create
 */
router.post('/notice-bars', authenticateAdmin, requirePermission('hub.edit'), async (req, res) => {
    try {
        const body = req.body || {};
        if (body.placement !== undefined) {
            body.placement = noticeBarService.normalizePlacement(body.placement);
        }
        const metaCheck = noticeBarService.validateDocumentMeta(body, { isCreate: true });
        if (!metaCheck.ok) {
            return res.status(400).json({
                success: false,
                error: metaCheck.error,
                fields: metaCheck.fields
            });
        }
        const scheduleCheck = noticeBarService.validateSchedule(body.schedule);
        if (!scheduleCheck.ok) {
            return res.status(400).json({
                success: false,
                error: scheduleCheck.error,
                fields: scheduleCheck.fields
            });
        }
        const draftCheck = noticeBarService.validateNoticeBarContent(
            noticeBarService.extractDraftPatchFromBody(body) || {
                text: body.text || body.message || '',
                animation: 'scroll_marquee'
            },
            { draftAutosave: true }
        );
        if (!draftCheck.ok) {
            return res.status(400).json({
                success: false,
                error: draftCheck.error,
                fields: draftCheck.fields
            });
        }

        const doc = noticeBarService.newDocumentDefaults(
            {
                ...body,
                draft: draftCheck.content,
                schedule: scheduleCheck.schedule
            },
            req.admin?.username || req.admin?.email || 'admin'
        );

        const createResult = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTION_NAME,
            command: '--create',
            data: doc
        });

        if (!createResult.success) {
            return res.status(500).json({
                success: false,
                error: createResult.error || 'Failed to create notice bar'
            });
        }

        const insertedId = createResult.data?.insertedId?.toString?.();
        if (insertedId) {
            await updateNoticeBarById(insertedId, { id: insertedId });
        }

        const created = insertedId ? await readNoticeBarById(insertedId) : doc;
        res.status(201).json({
            success: true,
            ...noticeBarService.toAdminDetail(created || doc)
        });
    } catch (err) {
        console.error('[NOTICE BARS] create error:', err);
        res.status(500).json({ success: false, error: 'Failed to create notice bar' });
    }
});

/**
 * GET /api/admin/notice-bars/:id
 */
router.get('/notice-bars/:id', authenticateAdmin, requirePermission('hub.view'), async (req, res) => {
    try {
        const doc = await readNoticeBarById(req.params.id);
        if (!doc || doc.deletedAt) {
            return res.status(404).json({ success: false, error: 'Notice bar not found' });
        }
        res.json({ success: true, ...noticeBarService.toAdminDetail(doc) });
    } catch (err) {
        console.error('[NOTICE BARS] get error:', err);
        res.status(500).json({ success: false, error: 'Failed to load notice bar' });
    }
});

/**
 * PUT /api/admin/notice-bars/:id/draft — autosave (partial draft allowed)
 */
router.put('/notice-bars/:id/draft', authenticateAdmin, requirePermission('hub.edit'), async (req, res) => {
    try {
        const doc = await readNoticeBarById(req.params.id);
        if (!doc || doc.deletedAt) {
            return res.status(404).json({ success: false, error: 'Notice bar not found' });
        }

        const body = req.body || {};
        const update = { updatedAt: new Date().toISOString(), updatedBy: req.admin?.username || 'admin' };

        if (body.enabled !== undefined) update.enabled = Boolean(body.enabled);
        if (body.priority !== undefined) {
            const metaCheck = noticeBarService.validateDocumentMeta({ priority: body.priority });
            if (!metaCheck.ok) {
                return res.status(400).json({
                    success: false,
                    error: metaCheck.error,
                    fields: metaCheck.fields
                });
            }
            update.priority = Math.floor(Number(body.priority));
        }
        if (body.placement !== undefined) {
            const placement = noticeBarService.normalizePlacement(body.placement);
            const metaCheck = noticeBarService.validateDocumentMeta({ placement });
            if (!metaCheck.ok) {
                return res.status(400).json({
                    success: false,
                    error: metaCheck.error,
                    fields: metaCheck.fields
                });
            }
            update.placement = placement;
        }
        if (body.schedule !== undefined) {
            const scheduleCheck = noticeBarService.validateSchedule(body.schedule);
            if (!scheduleCheck.ok) {
                return res.status(400).json({
                    success: false,
                    error: scheduleCheck.error,
                    fields: scheduleCheck.fields
                });
            }
            update.schedule = scheduleCheck.schedule;
        }

        const draftPatch = noticeBarService.extractDraftPatchFromBody(body);
        if (Object.keys(draftPatch).length > 0 || body.draft !== undefined) {
            const mergedDraft = noticeBarService.normalizeContent(
                {
                    ...(doc.draft || noticeBarService.DEFAULT_CONTENT),
                    ...draftPatch
                },
                { partial: false }
            );
            const draftCheck = noticeBarService.validateNoticeBarContent(mergedDraft, {
                draftAutosave: true
            });
            if (!draftCheck.ok) {
                return res.status(400).json({
                    success: false,
                    error: draftCheck.error,
                    fields: draftCheck.fields
                });
            }
            update.draft = mergedDraft;
        }

        const nextDraft = update.draft || doc.draft;
        update.hasUnpublishedChanges = noticeBarService.computeHasUnpublishedChanges({
            ...doc,
            draft: nextDraft
        });

        const result = await updateNoticeBarById(req.params.id, update);
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to save draft'
            });
        }

        const refreshed = await readNoticeBarById(req.params.id);
        res.json({ success: true, ...noticeBarService.toAdminDetail(refreshed) });
    } catch (err) {
        console.error('[NOTICE BARS] draft save error:', err);
        res.status(500).json({ success: false, error: 'Failed to save draft' });
    }
});

/**
 * POST /api/admin/notice-bars/:id/publish
 */
router.post('/notice-bars/:id/publish', authenticateAdmin, requirePermission('hub.edit'), async (req, res) => {
    try {
        const doc = await readNoticeBarById(req.params.id);
        if (!doc || doc.deletedAt) {
            return res.status(404).json({ success: false, error: 'Notice bar not found' });
        }

        const draftCheck = noticeBarService.validateNoticeBarContent(doc.draft || {}, {
            requireForPublish: true
        });
        if (!draftCheck.ok) {
            return res.status(400).json({
                success: false,
                error: draftCheck.error,
                fields: draftCheck.fields,
                userMessage: 'Add notice text before publishing (1–120 characters).'
            });
        }

        const now = new Date().toISOString();
        const published = JSON.parse(JSON.stringify(draftCheck.content));
        const version = (typeof doc.version === 'number' ? doc.version : 0) + 1;

        const update = {
            published,
            draft: published,
            hasUnpublishedChanges: false,
            version,
            publishedAt: now,
            updatedAt: now,
            publishedBy: req.admin?.username || req.admin?.email || 'admin',
            updatedBy: req.admin?.username || 'admin'
        };

        const result = await updateNoticeBarById(req.params.id, update);
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to publish'
            });
        }

        cacheInvalidation.onSiteContentChanged();

        const refreshed = await readNoticeBarById(req.params.id);
        res.json({
            success: true,
            id: refreshed.id,
            version: refreshed.version,
            publishedAt: refreshed.publishedAt,
            hasUnpublishedChanges: false,
            published: refreshed.published
        });
    } catch (err) {
        console.error('[NOTICE BARS] publish error:', err);
        res.status(500).json({ success: false, error: 'Failed to publish' });
    }
});

/**
 * POST /api/admin/notice-bars/:id/discard-draft
 */
router.post('/notice-bars/:id/discard-draft', authenticateAdmin, requirePermission('hub.edit'), async (req, res) => {
    try {
        const doc = await readNoticeBarById(req.params.id);
        if (!doc || doc.deletedAt) {
            return res.status(404).json({ success: false, error: 'Notice bar not found' });
        }
        if (!doc.published) {
            return res.status(400).json({
                success: false,
                error: 'Nothing published yet; cannot discard draft to published snapshot'
            });
        }

        const published = JSON.parse(JSON.stringify(doc.published));
        const update = {
            draft: published,
            hasUnpublishedChanges: false,
            updatedAt: new Date().toISOString(),
            updatedBy: req.admin?.username || 'admin'
        };

        const result = await updateNoticeBarById(req.params.id, update);
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to discard draft'
            });
        }

        const refreshed = await readNoticeBarById(req.params.id);
        res.json({ success: true, ...noticeBarService.toAdminDetail(refreshed) });
    } catch (err) {
        console.error('[NOTICE BARS] discard error:', err);
        res.status(500).json({ success: false, error: 'Failed to discard draft' });
    }
});

/**
 * DELETE /api/admin/notice-bars/:id — soft delete
 */
router.delete('/notice-bars/:id', authenticateAdmin, requirePermission('hub.edit'), async (req, res) => {
    try {
        const doc = await readNoticeBarById(req.params.id);
        if (!doc || doc.deletedAt) {
            return res.status(404).json({ success: false, error: 'Notice bar not found' });
        }

        const now = new Date().toISOString();
        const result = await updateNoticeBarById(req.params.id, {
            deletedAt: now,
            enabled: false,
            updatedAt: now,
            updatedBy: req.admin?.username || 'admin'
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to delete notice bar'
            });
        }

        res.json({ success: true, message: 'Notice bar deleted', id: req.params.id });
    } catch (err) {
        console.error('[NOTICE BARS] delete error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete notice bar' });
    }
});

module.exports = router;
