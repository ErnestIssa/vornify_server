const express = require('express');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { requirePermission } = require('../middleware/requirePermission');
const releaseService = require('../services/releaseService');
const releaseStore = require('../services/releaseStore');
const cacheInvalidation = require('../services/cacheInvalidation');

const router = express.Router();

function actor(req) {
    return req.admin?.username || req.admin?.email || req.admin?.id || 'admin';
}

function adminReaderId(req) {
    return `admin:${req.admin?.id || req.admin?.email || 'unknown'}`;
}

/**
 * GET /api/admin/releases/versions
 */
router.get('/releases/versions', authenticateAdmin, requirePermission('releases.view'), (_req, res) => {
    res.json({ success: true, data: releaseService.appVersions() });
});

/**
 * GET /api/admin/releases/feed — published notes visible to this admin.
 */
router.get('/releases/feed', authenticateAdmin, requirePermission('releases.view'), async (req, res) => {
    try {
        const docs = await releaseStore.livePublished({
            surface: 'admin',
            role: req.admin?.role
        });
        const receipts = await releaseStore.readReceiptsForReader(adminReaderId(req));
        const items = releaseStore.attachReceipts(docs, receipts);
        res.json({ success: true, items });
    } catch (err) {
        console.error('[RELEASES] admin feed error:', err);
        res.status(500).json({ success: false, error: 'Failed to load release feed' });
    }
});

/**
 * GET /api/admin/releases
 */
router.get('/releases', authenticateAdmin, requirePermission('releases.view'), async (req, res) => {
    try {
        await releaseStore.publishDueScheduled();
        const status = req.query.status ? String(req.query.status) : '';
        const rows = await releaseStore.readAllReleases();
        const items = rows
            .filter((d) => !status || d.status === status)
            .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
            .map(releaseService.toAdminListItem);
        res.json({
            success: true,
            items,
            types: releaseService.RELEASE_TYPES,
            severities: releaseService.RELEASE_SEVERITIES,
            audiences: releaseService.RELEASE_AUDIENCES,
            statuses: releaseService.RELEASE_STATUSES,
            versions: releaseService.appVersions()
        });
    } catch (err) {
        console.error('[RELEASES] list error:', err);
        res.status(500).json({ success: false, error: 'Failed to list releases' });
    }
});

/**
 * GET /api/admin/releases/:id
 */
router.get('/releases/:id', authenticateAdmin, requirePermission('releases.view'), async (req, res) => {
    try {
        const doc = await releaseStore.readReleaseById(req.params.id);
        if (!doc || doc.deletedAt) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        res.json({ success: true, data: releaseService.toAdminDetail(doc) });
    } catch (err) {
        console.error('[RELEASES] detail error:', err);
        res.status(500).json({ success: false, error: 'Failed to load release' });
    }
});

/**
 * POST /api/admin/releases
 */
router.post('/releases', authenticateAdmin, requirePermission('releases.create'), async (req, res) => {
    try {
        const doc = releaseService.newDocumentDefaults(req.body || {}, actor(req));
        const check = releaseService.validateRelease(doc, { forPublish: false });
        if (!check.ok) {
            return res.status(400).json({ success: false, error: check.error, fields: check.fields });
        }
        const created = await releaseStore.createRelease(doc);
        if (!created.success) {
            return res.status(500).json({ success: false, error: created.error });
        }
        cacheInvalidation.onReleasesChanged();
        res.status(201).json({ success: true, data: releaseService.toAdminDetail(created.data) });
    } catch (err) {
        console.error('[RELEASES] create error:', err);
        res.status(500).json({ success: false, error: 'Failed to create release' });
    }
});

/**
 * PATCH /api/admin/releases/:id
 */
router.patch('/releases/:id', authenticateAdmin, requirePermission('releases.edit'), async (req, res) => {
    try {
        const existing = await releaseStore.readReleaseById(req.params.id);
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        const next = releaseService.applyPatch(existing, req.body || {});
        next.updatedBy = actor(req);
        const check = releaseService.validateRelease(next, { forPublish: existing.status === 'published' });
        if (!check.ok) {
            return res.status(400).json({ success: false, error: check.error, fields: check.fields });
        }
        await releaseStore.updateReleaseById(existing.id, next);
        const updated = await releaseStore.readReleaseById(existing.id);
        cacheInvalidation.onReleasesChanged();
        res.json({ success: true, data: releaseService.toAdminDetail(updated) });
    } catch (err) {
        console.error('[RELEASES] update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update release' });
    }
});

/**
 * POST /api/admin/releases/:id/publish
 */
router.post('/releases/:id/publish', authenticateAdmin, requirePermission('releases.publish'), async (req, res) => {
    try {
        const existing = await releaseStore.readReleaseById(req.params.id);
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        const next = releaseService.applyPatch(existing, req.body || {});
        const check = releaseService.validateRelease(next, { forPublish: true });
        if (!check.ok) {
            return res.status(400).json({ success: false, error: check.error, fields: check.fields });
        }
        const publishedAt = releaseService.nowIso();
        await releaseStore.updateReleaseById(existing.id, {
            ...next,
            status: 'published',
            publishedAt: existing.publishedAt || publishedAt,
            archivedAt: null,
            updatedBy: actor(req),
            updatedAt: publishedAt
        });
        const updated = await releaseStore.readReleaseById(existing.id);
        cacheInvalidation.onReleasesChanged();
        res.json({ success: true, data: releaseService.toAdminDetail(updated) });
    } catch (err) {
        console.error('[RELEASES] publish error:', err);
        res.status(500).json({ success: false, error: 'Failed to publish release' });
    }
});

/**
 * POST /api/admin/releases/:id/schedule
 */
router.post('/releases/:id/schedule', authenticateAdmin, requirePermission('releases.publish'), async (req, res) => {
    try {
        const existing = await releaseStore.readReleaseById(req.params.id);
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        const next = releaseService.applyPatch(existing, req.body || {});
        const scheduledAt = next.scheduledAt;
        if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
            return res.status(400).json({
                success: false,
                error: 'Choose a future publish time',
                fields: { scheduledAt: 'Choose a future publish time' }
            });
        }
        const check = releaseService.validateRelease(next, { forPublish: true });
        if (!check.ok) {
            return res.status(400).json({ success: false, error: check.error, fields: check.fields });
        }
        await releaseStore.updateReleaseById(existing.id, {
            ...next,
            status: 'scheduled',
            scheduledAt,
            archivedAt: null,
            updatedBy: actor(req),
            updatedAt: releaseService.nowIso()
        });
        const updated = await releaseStore.readReleaseById(existing.id);
        cacheInvalidation.onReleasesChanged();
        res.json({ success: true, data: releaseService.toAdminDetail(updated) });
    } catch (err) {
        console.error('[RELEASES] schedule error:', err);
        res.status(500).json({ success: false, error: 'Failed to schedule release' });
    }
});

/**
 * POST /api/admin/releases/:id/archive
 */
router.post('/releases/:id/archive', authenticateAdmin, requirePermission('releases.archive'), async (req, res) => {
    try {
        const existing = await releaseStore.readReleaseById(req.params.id);
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        const stamp = releaseService.nowIso();
        await releaseStore.updateReleaseById(existing.id, {
            status: 'archived',
            archivedAt: stamp,
            updatedBy: actor(req),
            updatedAt: stamp
        });
        const updated = await releaseStore.readReleaseById(existing.id);
        cacheInvalidation.onReleasesChanged();
        res.json({ success: true, data: releaseService.toAdminDetail(updated) });
    } catch (err) {
        console.error('[RELEASES] archive error:', err);
        res.status(500).json({ success: false, error: 'Failed to archive release' });
    }
});

/**
 * POST /api/admin/releases/:id/read
 */
router.post('/releases/:id/read', authenticateAdmin, requirePermission('releases.view'), async (req, res) => {
    try {
        const existing = await releaseStore.readReleaseById(req.params.id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        const receipt = await releaseStore.upsertReceipt(existing.id, adminReaderId(req), 'admin', {
            readAt: releaseService.nowIso()
        });
        res.json({ success: true, data: receipt });
    } catch (err) {
        console.error('[RELEASES] read error:', err);
        res.status(500).json({ success: false, error: 'Failed to mark release as read' });
    }
});

/**
 * POST /api/admin/releases/read-all
 */
router.post('/releases/read-all', authenticateAdmin, requirePermission('releases.view'), async (req, res) => {
    try {
        const docs = await releaseStore.livePublished({
            surface: 'admin',
            role: req.admin?.role
        });
        const readerId = adminReaderId(req);
        const stamp = releaseService.nowIso();
        for (const doc of docs) {
            await releaseStore.upsertReceipt(doc.id, readerId, 'admin', { readAt: stamp });
        }
        res.json({ success: true, data: { marked: docs.length } });
    } catch (err) {
        console.error('[RELEASES] read-all error:', err);
        res.status(500).json({ success: false, error: 'Failed to mark releases as read' });
    }
});

/**
 * POST /api/admin/releases/:id/dismiss
 * body: { kind: 'popup' | 'banner' }
 */
router.post('/releases/:id/dismiss', authenticateAdmin, requirePermission('releases.view'), async (req, res) => {
    try {
        const existing = await releaseStore.readReleaseById(req.params.id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        const kind = req.body?.kind === 'banner' ? 'banner' : 'popup';
        const stamp = releaseService.nowIso();
        const patch = kind === 'banner' ? { bannerDismissedAt: stamp } : { dismissedAt: stamp };
        const receipt = await releaseStore.upsertReceipt(existing.id, adminReaderId(req), 'admin', patch);
        res.json({ success: true, data: receipt });
    } catch (err) {
        console.error('[RELEASES] dismiss error:', err);
        res.status(500).json({ success: false, error: 'Failed to dismiss release' });
    }
});

/**
 * DELETE /api/admin/releases/:id
 */
router.delete('/releases/:id', authenticateAdmin, requirePermission('releases.archive'), async (req, res) => {
    try {
        const existing = await releaseStore.readReleaseById(req.params.id);
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        const stamp = releaseService.nowIso();
        await releaseStore.updateReleaseById(existing.id, {
            deletedAt: stamp,
            updatedAt: stamp,
            updatedBy: actor(req)
        });
        cacheInvalidation.onReleasesChanged();
        res.json({ success: true });
    } catch (err) {
        console.error('[RELEASES] delete error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete release' });
    }
});

module.exports = router;
