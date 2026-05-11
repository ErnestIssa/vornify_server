const express = require('express');
const router = express.Router();
const tiktokEvents = require('../services/tiktokEvents');
const { logger } = require('../core/logging/logger');
const { devLog } = require('../core/logging/devConsole');

/**
 * TikTok Events API — public routes
 * ---------------------------------------------------------------------------
 * These routes are OPTIONAL for the core conversion flow. The two events
 * that matter most (InitiateCheckout, CompletePayment) are fired
 * automatically from the order/payment pipeline, so the frontend does not
 * need to ping these endpoints to get deduplicated CompletePayment.
 *
 * Use these endpoints when the frontend wants a server-side mirror for:
 *   - ViewContent / AddToCart / AddToWishlist / Search / Subscribe
 *   - AddPaymentInfo (mirror)
 *   - Any future custom events
 *
 * SECURITY:
 *   - Backend hashes PII (email/phone) — frontend MUST send raw, not hashed.
 *   - Backend overrides client IP + user agent from request headers.
 *   - Frontend MUST always send a deterministic `event_id` if a corresponding
 *     Pixel event was fired in the browser. Otherwise deduplication breaks.
 */

// ---------------------------------------------------------------------------
// POST /api/tiktok/track
// Generic server-side mirror of any standard or custom TikTok event.
//
// Body:
// {
//   "event": "AddToCart",                      // required (standard or custom)
//   "eventId": "<uuid>",                       // strongly recommended — must match Pixel event_id
//   "eventTime": 1731331200,                   // optional, unix seconds
//   "ttclid": "E.C.P....",                     // optional
//   "ttp": "...",                              // optional
//   "email": "user@example.com",               // raw, will be hashed
//   "phone": "+46701234567",                   // raw, will be hashed
//   "externalId": "user_123",                  // raw, will be hashed
//   "pageUrl": "https://peakmode.se/p/xyz",
//   "referrer": "https://peakmode.se/",
//   "value": 499,
//   "currency": "SEK",
//   "items": [ { id, productId, title, price, quantity, brand, category } ]
// }
// ---------------------------------------------------------------------------
router.post('/track', async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.event) {
            return res.status(400).json({
                success: false,
                error: 'event is required',
                code: 'missing_event'
            });
        }

        // Skip clearly bad payloads early
        if (typeof body.event !== 'string') {
            return res.status(400).json({ success: false, error: 'event must be a string' });
        }

        // GDPR / TTDSG consent gate. Frontend MUST send consent:false (or
        // consentGranted:false) when its CMP has not granted analytics consent.
        // Null/undefined defaults to granted (legacy callers / admin tools).
        if (body.consent === false || body.consentGranted === false) {
            return res.json({
                success: true,
                tiktok: { ok: false, skipped: true, message: 'consent_denied' }
            });
        }

        const ctx = tiktokEvents.extractClientContextFromReq(req);
        const result = await tiktokEvents.sendTikTokEvent(body.event, {
            eventId: body.eventId,
            eventTime: body.eventTime,
            user: {
                email: body.email,
                phone: body.phone,
                externalId: body.externalId,
                ttclid: body.ttclid,
                ttp: body.ttp,
                ip: ctx.ip,
                userAgent: ctx.userAgent
            },
            page: {
                url: body.pageUrl,
                referrer: body.referrer || ctx.referrer
            },
            properties: {
                value: body.value,
                currency: body.currency,
                content_type: body.contentType || 'product',
                content_ids: Array.isArray(body.items)
                    ? tiktokEvents.buildContentIdsFromItems(body.items)
                    : (body.contentIds || undefined),
                contents: Array.isArray(body.items)
                    ? tiktokEvents.buildContentsFromItems(body.items)
                    : (body.contents || undefined),
                description: body.description,
                query: body.query,
                order_id: body.orderId
            }
        });

        // Always 200 — TikTok problems must not surface to the storefront
        return res.json({
            success: true,
            tiktok: result
        });
    } catch (err) {
        logger.warn('tiktok_route_track_exception', { message: err?.message });
        return res.json({ success: true, tiktok: { ok: false, error: err?.message || 'exception' } });
    }
});

// ---------------------------------------------------------------------------
// POST /api/tiktok/session
// Bind a TikTok click id (ttclid) + per-event event_ids to a user/cart so
// later checkout requests can still resolve them even if the user reloads.
// Stored in the `tiktok_sessions` collection — best-effort, non-blocking.
//
// Body:
// {
//   "userId": "guest_or_user_id",     // required
//   "ttclid": "E.C.P....",            // optional
//   "ttp": "...",                     // optional
//   "eventIds": {                      // optional, but used for dedup downstream
//     "initiateCheckout": "...",
//     "addPaymentInfo": "...",
//     "completePayment": "..."
//   },
//   "pageUrl": "...",
//   "referrer": "..."
// }
// ---------------------------------------------------------------------------
router.post('/session', async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.userId) {
            return res.status(400).json({ success: false, error: 'userId is required' });
        }

        const getDBInstance = require('../vornifydb/dbInstance');
        const db = getDBInstance();
        const ctx = tiktokEvents.extractClientContextFromReq(req);

        const nowIso = new Date().toISOString();
        const doc = {
            userId: String(body.userId),
            ttclid: body.ttclid || null,
            ttp: body.ttp || null,
            eventIds: body.eventIds && typeof body.eventIds === 'object' ? body.eventIds : {},
            pageUrl: body.pageUrl || null,
            referrer: body.referrer || ctx.referrer || null,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            updatedAt: nowIso
        };

        // Upsert-like behavior using VornifyDB
        try {
            const existing = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'tiktok_sessions',
                command: '--read',
                data: { userId: doc.userId }
            });
            const found = existing.success && existing.data
                ? (Array.isArray(existing.data) ? existing.data[0] : existing.data)
                : null;
            if (found) {
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'tiktok_sessions',
                    command: '--update',
                    data: {
                        filter: { userId: doc.userId },
                        update: doc
                    }
                });
            } else {
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'tiktok_sessions',
                    command: '--create',
                    data: { ...doc, createdAt: nowIso }
                });
            }
        } catch (dbErr) {
            logger.warn('tiktok_session_persist_failed', { userId: doc.userId, message: dbErr.message });
            // Continue — session binding is opportunistic
        }

        return res.json({ success: true });
    } catch (err) {
        logger.warn('tiktok_route_session_exception', { message: err?.message });
        return res.json({ success: false, error: err?.message || 'exception' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/tiktok/session/:userId
// Read back the stored ttclid + event_ids for a user (used during recovery /
// abandoned-checkout flows). Returns 200 with `null` data when nothing stored.
// ---------------------------------------------------------------------------
router.get('/session/:userId', async (req, res) => {
    try {
        const userId = String(req.params.userId || '').trim();
        if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

        const getDBInstance = require('../vornifydb/dbInstance');
        const db = getDBInstance();
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'tiktok_sessions',
            command: '--read',
            data: { userId }
        });
        const doc = result.success && result.data
            ? (Array.isArray(result.data) ? result.data[0] : result.data)
            : null;
        return res.json({ success: true, data: doc || null });
    } catch (err) {
        logger.warn('tiktok_route_session_get_exception', { message: err?.message });
        return res.json({ success: false, error: err?.message || 'exception' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/tiktok/health
// Public diagnostics — confirms whether the integration is wired correctly.
// Does NOT leak access tokens; only reports whether they are present.
// ---------------------------------------------------------------------------
router.get('/health', (req, res) => {
    const status = tiktokEvents.configStatus();
    res.json({
        success: true,
        service: 'tiktok-events-api',
        version: 'v1.3',
        endpoint: tiktokEvents.TIKTOK_TRACK_URL,
        ...status,
        supportedEvents: Array.from(tiktokEvents.STANDARD_EVENTS),
        consentContract: {
            field: 'tiktok.consent (boolean) on /api/orders/create, or `consent` on /api/tiktok/track',
            default: 'true (granted) when omitted — legacy callers',
            denied: 'backend skips ALL server-side firing for that order/request',
            granted: 'backend fires server-side events, deduplicated against frontend Pixel by event_id'
        }
    });
});

// ---------------------------------------------------------------------------
// POST /api/tiktok/test
// Owner-only manual smoke test (firing a no-op test event). Useful right
// after credentials are filled in. Set TIKTOK_TEST_EVENT_CODE to keep these
// out of production stats.
// Body: { event?: 'ViewContent', eventId?: '...', email?, value?, currency? }
// ---------------------------------------------------------------------------
router.post('/test', async (req, res) => {
    try {
        const body = req.body || {};
        const ctx = tiktokEvents.extractClientContextFromReq(req);
        const event = body.event || 'ViewContent';
        const result = await tiktokEvents.sendTikTokEvent(event, {
            eventId: body.eventId,
            user: {
                email: body.email,
                phone: body.phone,
                externalId: body.externalId,
                ttclid: body.ttclid,
                ip: ctx.ip,
                userAgent: ctx.userAgent
            },
            page: { url: body.pageUrl || 'https://peakmode.se/' },
            properties: {
                value: body.value ?? 1,
                currency: body.currency || 'SEK',
                content_type: 'product',
                content_ids: body.contentIds || ['TEST_SKU'],
                contents: [{
                    content_id: 'TEST_SKU',
                    content_type: 'product',
                    content_name: 'TikTok Events API smoke test',
                    quantity: 1,
                    price: Number(body.value ?? 1)
                }]
            }
        });
        devLog('tiktok_smoke_test', result);
        return res.json({ success: true, result });
    } catch (err) {
        return res.status(500).json({ success: false, error: err?.message || 'exception' });
    }
});

module.exports = router;
