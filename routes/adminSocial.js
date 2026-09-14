const express = require('express');
const getDBInstance = require('../vornifydb/dbInstance');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const socialPostService = require('../services/socialPostService');
const instagramSyncService = require('../services/instagramSyncService');
const cacheInvalidation = require('../services/cacheInvalidation');

const router = express.Router();
const db = getDBInstance();

function bustCache() {
    cacheInvalidation.onSocialChanged();
}

/**
 * GET /api/admin/social/posts
 */
router.get('/social/posts', authenticateAdmin, async (req, res) => {
    try {
        const rows = await socialPostService.readAllPosts(db);
        const includeHidden = req.query.includeHidden === 'true';
        const items = rows
            .filter((r) => includeHidden || !r.hidden)
            .map(socialPostService.toAdminItem)
            .sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                return b.sortOrder - a.sortOrder || new Date(b.createdAt) - new Date(a.createdAt);
            });
        res.json({
            success: true,
            items,
            categories: socialPostService.CATEGORIES,
            sources: [...socialPostService.SOURCES]
        });
    } catch (err) {
        console.error('[ADMIN SOCIAL] list error:', err);
        res.status(500).json({ success: false, error: 'Failed to list social posts' });
    }
});

/**
 * GET /api/admin/social/posts/:id
 */
router.get('/social/posts/:id', authenticateAdmin, async (req, res) => {
    try {
        const row = await socialPostService.readPostById(db, req.params.id);
        if (!row) return res.status(404).json({ success: false, error: 'Post not found' });
        res.json({ success: true, data: socialPostService.toAdminItem(row) });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to load post' });
    }
});

/**
 * POST /api/admin/social/posts — admin upload metadata (after Cloudinary upload)
 */
router.post('/social/posts', authenticateAdmin, async (req, res) => {
    try {
        const result = await socialPostService.createPost(db, {
            ...req.body,
            source: req.body.source || 'admin'
        });
        if (!result.ok) {
            return res.status(400).json({ success: false, error: result.error });
        }
        bustCache();
        res.status(201).json({ success: true, data: result.data });
    } catch (err) {
        console.error('[ADMIN SOCIAL] create error:', err);
        res.status(500).json({ success: false, error: 'Failed to create post' });
    }
});

/**
 * POST /api/admin/social/tiktok — shortcut for TikTok embed entries
 */
router.post('/social/tiktok', authenticateAdmin, async (req, res) => {
    try {
        const result = await socialPostService.createPost(db, {
            ...req.body,
            source: 'tiktok',
            platform: 'tiktok',
            type: 'embed'
        });
        if (!result.ok) {
            return res.status(400).json({ success: false, error: result.error });
        }
        bustCache();
        res.status(201).json({ success: true, data: result.data });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to create TikTok embed' });
    }
});

/**
 * PUT /api/admin/social/posts/:id
 */
router.put('/social/posts/:id', authenticateAdmin, async (req, res) => {
    try {
        const result = await socialPostService.updatePost(db, req.params.id, req.body);
        if (!result.ok) {
            return res.status(result.status || 400).json({ success: false, error: result.error });
        }
        bustCache();
        res.json({ success: true, data: result.data });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update post' });
    }
});

/**
 * DELETE /api/admin/social/posts/:id — soft delete
 */
router.delete('/social/posts/:id', authenticateAdmin, async (req, res) => {
    try {
        const result = await socialPostService.deletePost(db, req.params.id);
        if (!result.ok) {
            return res.status(result.status || 400).json({ success: false, error: result.error });
        }
        bustCache();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete post' });
    }
});

/**
 * POST /api/admin/social/posts/reorder — body: { ids: string[] }
 */
router.post('/social/posts/reorder', authenticateAdmin, async (req, res) => {
    try {
        const result = await socialPostService.reorderPosts(db, req.body?.ids);
        if (!result.ok) {
            return res.status(400).json({ success: false, error: result.error });
        }
        bustCache();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to reorder posts' });
    }
});

/**
 * POST /api/admin/social/sync-instagram — manual Instagram sync
 */
router.post('/social/sync-instagram', authenticateAdmin, async (req, res) => {
    try {
        const result = await instagramSyncService.syncInstagramPosts(db, {
            limit: req.body?.limit
        });
        if (!result.ok) {
            return res.status(result.code === 'NOT_CONFIGURED' ? 503 : 502).json({
                success: false,
                ...result
            });
        }
        bustCache();
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[ADMIN SOCIAL] instagram sync error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/social/sync-status
 */
router.get('/social/sync-status', authenticateAdmin, async (req, res) => {
    try {
        const state = await socialPostService.getSyncState(db);
        res.json({
            success: true,
            instagram: {
                configured: instagramSyncService.isConfigured(),
                lastSyncAt: state?.lastSyncAt || null,
                lastSyncOk: state?.lastSyncOk === true,
                lastError: state?.lastError || null,
                postCount: state?.postCount || 0,
                created: state?.created,
                updated: state?.updated
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to load sync status' });
    }
});

module.exports = router;
