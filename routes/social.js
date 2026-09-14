const express = require('express');
const getDBInstance = require('../vornifydb/dbInstance');
const socialPostService = require('../services/socialPostService');
const instagramSyncService = require('../services/instagramSyncService');
const responseCache = require('../core/cache/responseCache');

const router = express.Router();
const db = getDBInstance();

/**
 * GET /api/social/feed — unified community + social feed (from MongoDB)
 */
router.get('/feed', async (req, res) => {
    try {
        if (responseCache.tryHit(req, res, 'social:feed')) return;

        const feed = await socialPostService.getPublicFeed(db, req.query);
        return responseCache.json(
            res,
            req,
            { success: true, ...feed },
            'social:feed',
            120
        );
    } catch (err) {
        console.error('[SOCIAL] feed error:', err);
        res.status(500).json({ success: false, error: 'Failed to load social feed' });
    }
});

/**
 * GET /api/social/instagram-feed — Instagram posts from DB cache (not live Graph API)
 */
router.get('/instagram-feed', async (req, res) => {
    try {
        if (responseCache.tryHit(req, res, 'social:instagram')) return;

        const feed = await socialPostService.getInstagramFeedFromDb(db, req.query);
        return responseCache.json(
            res,
            req,
            { success: true, ...feed },
            'social:instagram',
            180
        );
    } catch (err) {
        console.error('[SOCIAL] instagram-feed error:', err);
        res.status(500).json({ success: false, error: 'Failed to load Instagram feed' });
    }
});

/**
 * GET /api/social/categories
 */
router.get('/categories', async (req, res) => {
    res.json({ success: true, categories: socialPostService.CATEGORIES });
});

/**
 * GET /api/social/sync-status — public read of last Instagram sync (no secrets)
 */
router.get('/sync-status', async (req, res) => {
    try {
        const state = await socialPostService.getSyncState(db);
        res.json({
            success: true,
            instagram: {
                configured: instagramSyncService.isConfigured(),
                lastSyncAt: state?.lastSyncAt || null,
                lastSyncOk: state?.lastSyncOk === true,
                lastError: state?.lastError || null,
                postCount: state?.postCount || 0
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to load sync status' });
    }
});

/**
 * GET /api/social/cron/sync-instagram?key=...
 * External cron (cron-job.org) or manual ping — same as admin sync.
 */
router.get('/cron/sync-instagram', async (req, res) => {
    try {
        const secret = process.env.SOCIAL_CRON_SECRET || process.env.INSTAGRAM_SYNC_CRON_KEY;
        if (!secret || req.query.key !== secret) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const result = await instagramSyncService.syncInstagramPosts(db);
        if (!result.ok) {
            return res.status(result.code === 'NOT_CONFIGURED' ? 503 : 502).json({
                success: false,
                ...result
            });
        }
        const cacheInvalidation = require('../services/cacheInvalidation');
        cacheInvalidation.onSocialChanged();
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[SOCIAL] cron sync error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
