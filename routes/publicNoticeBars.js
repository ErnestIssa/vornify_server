const express = require('express');
const getDBInstance = require('../vornifydb/dbInstance');
const noticeBarService = require('../services/noticeBarService');
const crypto = require('crypto');

const router = express.Router();
const db = getDBInstance();

const DATABASE_NAME = 'peakmode';
const COLLECTION_NAME = 'notice_bars';

/**
 * GET /api/public/notice-bars/active
 * Published, enabled, in-schedule notice bars only (CDN-friendly).
 */
router.get('/notice-bars/active', async (req, res) => {
    try {
        const locale = req.query.locale ? String(req.query.locale).toLowerCase() : null;
        const now = new Date();

        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTION_NAME,
            command: '--read',
            data: { deletedAt: null }
        });

        let rows = [];
        if (result.success && result.data) {
            rows = Array.isArray(result.data) ? result.data : [result.data];
        }

        const items = rows
            .filter((doc) => doc && !doc.deletedAt && doc.enabled !== false && doc.published)
            .filter((doc) => noticeBarService.isWithinSchedule(doc.schedule, now))
            .filter((doc) => {
                if (!locale || !doc.published?.locale) return true;
                return doc.published.locale === locale;
            })
            .map(noticeBarService.toPublicItem)
            .sort((a, b) => (b.priority || 0) - (a.priority || 0));

        const etag = crypto
            .createHash('md5')
            .update(JSON.stringify(items))
            .digest('hex');
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === `"${etag}"`) {
            return res.status(304).end();
        }

        res.set('Cache-Control', 'public, max-age=60');
        res.set('ETag', `"${etag}"`);
        res.json({ success: true, items });
    } catch (err) {
        console.error('[PUBLIC NOTICE BARS] active error:', err);
        res.status(500).json({ success: false, error: 'Failed to load notice bars' });
    }
});

module.exports = router;
