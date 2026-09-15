const express = require('express');
const releaseStore = require('../services/releaseStore');
const releaseService = require('../services/releaseService');
const responseCache = require('../core/cache/responseCache');

const router = express.Router();

function shopReaderId(req) {
    const fromQuery = req.query.readerId ? String(req.query.readerId).trim() : '';
    const fromBody = req.body?.readerId ? String(req.body.readerId).trim() : '';
    return (fromBody || fromQuery).slice(0, 120);
}

/**
 * GET /api/public/releases
 * Published shop-facing releases. Pass readerId to include read/dismissed state.
 */
router.get('/releases', async (req, res) => {
    try {
        const readerId = shopReaderId(req);
        if (!readerId && responseCache.tryHit(req, res, 'releases:list')) return;

        const docs = await releaseStore.livePublished({ surface: 'shop' });
        const receipts = readerId ? await releaseStore.readReceiptsForReader(readerId) : [];
        const items = releaseStore.attachReceipts(docs, receipts);

        if (!readerId) {
            return responseCache.json(res, req, { success: true, items }, 'releases:list', 60);
        }
        res.json({ success: true, items });
    } catch (err) {
        console.error('[PUBLIC RELEASES] list error:', err);
        res.status(500).json({ success: false, error: 'Failed to load releases' });
    }
});

/**
 * GET /api/public/releases/:id
 */
router.get('/releases/:id', async (req, res) => {
    try {
        const docs = await releaseStore.livePublished({ surface: 'shop' });
        const doc = docs.find((row) => String(row.id) === String(req.params.id));
        if (!doc) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        const readerId = shopReaderId(req);
        const receipt = readerId ? await releaseStore.readReceipt(doc.id, readerId) : null;
        res.json({ success: true, data: releaseService.toPublicItem(doc, receipt) });
    } catch (err) {
        console.error('[PUBLIC RELEASES] detail error:', err);
        res.status(500).json({ success: false, error: 'Failed to load release' });
    }
});

/**
 * POST /api/public/releases/:id/read
 * body: { readerId }
 */
router.post('/releases/:id/read', async (req, res) => {
    try {
        const readerId = shopReaderId(req);
        if (!readerId) {
            return res.status(400).json({ success: false, error: 'readerId is required' });
        }
        const docs = await releaseStore.livePublished({ surface: 'shop' });
        const doc = docs.find((row) => String(row.id) === String(req.params.id));
        if (!doc) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        const receipt = await releaseStore.upsertReceipt(doc.id, readerId, 'shop', {
            readAt: releaseService.nowIso()
        });
        res.json({ success: true, data: receipt });
    } catch (err) {
        console.error('[PUBLIC RELEASES] read error:', err);
        res.status(500).json({ success: false, error: 'Failed to mark release as read' });
    }
});

/**
 * POST /api/public/releases-read-all
 * body: { readerId }
 */
router.post('/releases/read-all', async (req, res) => {
    try {
        const readerId = shopReaderId(req);
        if (!readerId) {
            return res.status(400).json({ success: false, error: 'readerId is required' });
        }
        const docs = await releaseStore.livePublished({ surface: 'shop' });
        const stamp = releaseService.nowIso();
        for (const doc of docs) {
            await releaseStore.upsertReceipt(doc.id, readerId, 'shop', { readAt: stamp });
        }
        res.json({ success: true, data: { marked: docs.length } });
    } catch (err) {
        console.error('[PUBLIC RELEASES] read-all error:', err);
        res.status(500).json({ success: false, error: 'Failed to mark releases as read' });
    }
});

/**
 * POST /api/public/releases/:id/dismiss
 * body: { readerId, kind: 'popup' | 'banner' }
 */
router.post('/releases/:id/dismiss', async (req, res) => {
    try {
        const readerId = shopReaderId(req);
        if (!readerId) {
            return res.status(400).json({ success: false, error: 'readerId is required' });
        }
        const docs = await releaseStore.livePublished({ surface: 'shop' });
        const doc = docs.find((row) => String(row.id) === String(req.params.id));
        if (!doc) {
            return res.status(404).json({ success: false, error: 'Release not found' });
        }
        const kind = req.body?.kind === 'banner' ? 'banner' : 'popup';
        const stamp = releaseService.nowIso();
        const patch = kind === 'banner' ? { bannerDismissedAt: stamp } : { dismissedAt: stamp };
        const receipt = await releaseStore.upsertReceipt(doc.id, readerId, 'shop', patch);
        res.json({ success: true, data: receipt });
    } catch (err) {
        console.error('[PUBLIC RELEASES] dismiss error:', err);
        res.status(500).json({ success: false, error: 'Failed to dismiss release' });
    }
});

module.exports = router;
