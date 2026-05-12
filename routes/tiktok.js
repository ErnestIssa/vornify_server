const express = require('express');
const router = express.Router();
const tiktokEvents = require('../services/tiktokEvents');
const getDBInstance = require('../vornifydb/dbInstance');
const { logger } = require('../core/logging/logger');
const { devLog } = require('../core/logging/devConsole');

const db = getDBInstance();

/**
 * TikTok Events API — public routes
 * ---------------------------------------------------------------------------
 * Funnel events that ride the order pipeline (InitiateCheckout +
 * CompletePayment) fire automatically server-side. These endpoints exist for:
 *
 *   1. Server-side mirror of any other event (ViewContent, AddToCart, etc.)
 *      that the frontend Pixel fires — for ad-blocker resilience and EMQ.
 *   2. AddPaymentInfo mirror once Stripe PaymentElement reports completion.
 *   3. Early session stitching (`/session`) so ttclid + event_ids survive
 *      even if the checkout payload is incomplete or a redirected payment
 *      method (3DS / Klarna) reloads the SPA.
 *
 * Security contract:
 *   - PII (email/phone/externalId) is hashed by the backend; frontend MUST
 *     send raw values, never pre-hashed.
 *   - Backend overrides client IP + user agent from request headers
 *     (Cloudflare / Render aware).
 *   - Frontend MUST send a `consent` boolean — `false` short-circuits the
 *     server-side firing for GDPR/TTDSG compliance.
 *   - Frontend MUST send a deterministic `eventId` per occurrence so the
 *     Pixel and Events API deduplicate inside TikTok.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Standard TikTok event names that don't require special handling.
// Custom event names are accepted too (any non-empty string), but we warn so
// typos like `AddtoCart` don't silently break dedup.
const STANDARD_NAMES = tiktokEvents.STANDARD_EVENTS;

function consentDenied(body) {
    return body?.consent === false || body?.consentGranted === false;
}

function safeRespond(res, payload) {
    // Storefront must never see a 5xx because of TikTok. Wrap everything in 200.
    return res.json(payload);
}

const tiktokCatalog = require('../services/tiktokCatalogService');

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function buildProductLookupQuery(id) {
    if (/^[a-fA-F0-9]{24}$/.test(id)) {
        try {
            const { ObjectId } = require('mongodb');
            return { $or: [{ id }, { _id: new ObjectId(id) }] };
        } catch (e) {
            return { id };
        }
    }
    return { id };
}

// ---------------------------------------------------------------------------
// GET /api/tiktok/catalog
// TikTok Product Catalog data feed (JSON or CSV). Published products only.
// Query: ?format=json|csv (default json), optional ?key= when TIKTOK_CATALOG_FEED_KEY is set.
// ---------------------------------------------------------------------------
router.get('/catalog', async (req, res) => {
    try {
        if (!tiktokCatalog.validateCatalogFeedKey(req)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or missing catalog feed key',
                code: 'catalog_feed_unauthorized'
            });
        }

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { published: true }
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch products for TikTok catalog',
                code: 'catalog_db_error'
            });
        }

        let products = result.data || [];
        if (!Array.isArray(products)) products = products ? [products] : [];
        products = products.filter((p) => tiktokCatalog.isPublishedForCatalog(p));

        const items = products.map((p) => tiktokCatalog.productToTikTokCatalogItem(p)).filter((row) => row.id);

        const format = String(req.query.format || 'json').toLowerCase();
        if (format === 'csv') {
            const headers = [
                'id',
                'title',
                'description',
                'availability',
                'condition',
                'price',
                'currency',
                'link',
                'image_link',
                'brand',
                'gtin',
                'mpn'
            ];
            const lines = [headers.join(',')];
            for (const row of items) {
                lines.push(
                    [
                        row.id,
                        row.title,
                        row.description,
                        row.availability,
                        row.condition,
                        row.price,
                        row.currency,
                        row.link,
                        row.image_link,
                        row.brand,
                        row.gtin,
                        row.mpn
                    ].map(csvEscape).join(',')
                );
            }
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=300');
            return res.status(200).send(lines.join('\n'));
        }

        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(200).json({
            success: true,
            generatedAt: new Date().toISOString(),
            count: items.length,
            baseUrl: tiktokCatalog.getCatalogBaseUrl(),
            productPathPrefix: tiktokCatalog.getProductPathPrefix(),
            contentIdRule:
                'Use each item.id as the ONLY content_id in ViewContent, AddToCart, and purchase contents — must match MongoDB _id string.',
            linkRule:
                'item.link must match the storefront route exactly (including www vs apex if applicable).',
            tikTokCommerceManagerNote:
                'In TikTok Catalog product detail, "SKU ID" is often your feed `id` (here: MongoDB ObjectId). "Product ID" is TikTok internal — ignore it for Pixel matching. Pixel content_id must equal feed `id` only.',
            products: items
        });
    } catch (err) {
        logger.error('tiktok_catalog_route_failed', { message: err?.message });
        return res.status(500).json({
            success: false,
            error: err?.message || 'catalog generation failed',
            code: 'catalog_exception'
        });
    }
});

// ---------------------------------------------------------------------------
// GET /api/tiktok/product/:id/analytics
// Lightweight internal metrics: storefront views + catalog row for alignment.
// Does not replace TikTok Events Manager for conversion by content_id.
// ---------------------------------------------------------------------------
router.get('/product/:id/analytics', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (!id) {
            return res.status(400).json({ success: false, error: 'id is required' });
        }

        const query = buildProductLookupQuery(id);
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: query
        });

        if (!result.success || !result.data) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const product = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!tiktokCatalog.isPublishedForCatalog(product)) {
            return res.status(404).json({ success: false, error: 'Product not found or not published' });
        }

        const catalogItem = tiktokCatalog.productToTikTokCatalogItem(product);
        const catalogId = catalogItem.id;

        return res.json({
            success: true,
            productId: catalogId,
            storefrontMetrics: {
                views: typeof product.views === 'number' ? product.views : null,
                viewsLast7Days: typeof product.viewsLast7Days === 'number' ? product.viewsLast7Days : null,
                lastViewedAt: product.lastViewedAt || null
            },
            catalog: catalogItem,
            tiktokPixelContract: {
                content_id: catalogId,
                content_ids: [catalogId],
                page_url_must_match: catalogItem.link,
                note: 'Fire ViewContent on the product page with this content_id. AddToCart and CompletePayment contents[].content_id must use the same string for catalog matching.'
            },
            funnel: {
                purchasesByOrders: null,
                note: 'Aggregate purchase counts per SKU require a reporting job or TikTok Events Manager; not computed here to avoid full-order scans.'
            }
        });
    } catch (err) {
        logger.warn('tiktok_product_analytics_failed', { message: err?.message });
        return res.status(500).json({ success: false, error: err?.message || 'exception' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/tiktok/track
// Generic server-side mirror of any standard or custom TikTok event.
//
// Body shape:
// {
//   "event": "AddToCart",                      // required
//   "eventId": "<uuid>",                       // strongly recommended (dedup)
//   "eventTime": 1731331200,                   // optional unix seconds
//   "consent": true,                           // required boolean
//   "userId": "user_or_guest_id",              // optional → triggers session auto-merge
//   "sessionId": "<frontend-generated id>",    // optional alternative to userId for anon
//   "ttclid": "E.C.P....",                     // optional (auto-merged if userId/sessionId given)
//   "ttp": "...",                              // optional
//   "email": "user@example.com",               // raw, will be hashed
//   "phone": "+46701234567",                   // raw, will be hashed
//   "externalId": "user_123",                  // raw, will be hashed
//   "pageUrl": "https://peakmode.se/p/xyz",
//   "referrer": "https://peakmode.se/",
//   "value": 499,                              // for value-bearing events
//   "currency": "SEK",
//   "contentType": "product",
//   "items": [ { id, productId, title, price, quantity, brand, category } ],
//   "contentIds": [ "SKU1" ],                  // alternative to items
//   "contentName": "...",
//   "contentCategory": "Apparel > Tops",
//   "description": "...",                      // free-form
//   "query": "...",                            // for Search
//   "orderId": "..."                           // for post-purchase events
// }
// ---------------------------------------------------------------------------
router.post('/track', async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.event || typeof body.event !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'event is required and must be a string',
                code: 'missing_event'
            });
        }

        const eventName = body.event;
        if (!STANDARD_NAMES.has(eventName)) {
            // Accept but flag — useful for catching typos in dev.
            logger.warn('tiktok_track_non_standard_event', { event: eventName });
        }

        if (consentDenied(body)) {
            return safeRespond(res, {
                success: true,
                tiktok: { ok: false, skipped: true, message: 'consent_denied', event: eventName }
            });
        }

        if (!body.eventId) {
            logger.warn('tiktok_track_missing_event_id', { event: eventName });
        }

        const ctx = tiktokEvents.extractClientContextFromReq(req);

        // Session auto-merge: if frontend passed userId/sessionId, fill in
        // missing ttclid/ttp from the stored session record.
        let stored = null;
        if (body.userId || body.sessionId) {
            stored = await tiktokEvents.findStoredSessionContext({
                userId: body.userId || null,
                sessionId: body.sessionId || null
            });
        }

        // Always log funnel-critical events to tiktok_events_log so /stats can
        // show end-to-end funnel health. Cheap mirror events (ViewContent,
        // AddToCart) skip DB writes to keep collection size bounded.
        const isFunnelEvent =
            eventName === 'CompletePayment' ||
            eventName === 'InitiateCheckout' ||
            eventName === 'AddPaymentInfo';

        const baseOpts = {
            eventId: body.eventId,
            eventTime: body.eventTime,
            ttclid: body.ttclid,
            ttp: body.ttp,
            email: body.email,
            phone: body.phone,
            externalId: body.externalId || body.userId,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            pageUrl: body.pageUrl,
            referrer: body.referrer || ctx.referrer,
            value: body.value,
            currency: body.currency,
            contentType: body.contentType,
            items: body.items,
            contentIds: body.contentIds,
            contentName: body.contentName,
            contentCategory: body.contentCategory,
            description: body.description,
            query: body.query,
            orderId: body.orderId,
            logToDb: isFunnelEvent || body.logToDb === true,
            context: 'route_track'
        };
        const finalOpts = tiktokEvents.mergeSessionContext(baseOpts, stored);

        const result = await tiktokEvents.trackCommerceEvent(eventName, finalOpts);

        return safeRespond(res, {
            success: true,
            tiktok: { ...result, event: eventName, mergedFromSession: !!stored }
        });
    } catch (err) {
        logger.warn('tiktok_route_track_exception', { message: err?.message });
        return safeRespond(res, {
            success: true,
            tiktok: { ok: false, error: err?.message || 'exception' }
        });
    }
});

// ---------------------------------------------------------------------------
// POST /api/tiktok/session
// Early session stitching. Persist ttclid + event_ids as soon as they're
// known so attribution + deduplication survive partial checkouts, 3DS
// redirects, page reloads, and incomplete order payloads.
//
// Body:
// {
//   "userId": "user_or_guest_id",     // either userId OR sessionId required
//   "sessionId": "frontend-uuid",     //   (sessionId for true anonymous visitors)
//   "ttclid": "E.C.P....",
//   "ttp": "...",
//   "eventIds": {
//     "initiateCheckout": "ic_<uuid>",
//     "addPaymentInfo":   "api_<uuid>",
//     "completePayment":  "cp_<uuid>"
//   },
//   "pageUrl": "...",
//   "referrer": "...",
//   "consent": true                   // recommended; defaults to true
// }
//
// Idempotent: subsequent POSTs UPDATE the existing record (don't blow away
// already-stored event_ids if a later call sends an incomplete eventIds map).
// ---------------------------------------------------------------------------
router.post('/session', async (req, res) => {
    try {
        const body = req.body || {};
        const userId = body.userId ? String(body.userId) : null;
        const sessionId = body.sessionId ? String(body.sessionId) : null;
        if (!userId && !sessionId) {
            return res.status(400).json({
                success: false,
                error: 'userId or sessionId is required',
                code: 'missing_identifier'
            });
        }

        const ctx = tiktokEvents.extractClientContextFromReq(req);
        const nowIso = new Date().toISOString();
        const filter = userId ? { userId } : { sessionId };

        // Read existing (so we can merge eventIds rather than clobber them)
        let existing = null;
        try {
            const existingResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'tiktok_sessions',
                command: '--read',
                data: filter
            });
            if (existingResult.success && existingResult.data) {
                existing = Array.isArray(existingResult.data)
                    ? existingResult.data[0]
                    : existingResult.data;
            }
        } catch (_) {
            existing = null;
        }

        const mergedEventIds = {
            ...(existing?.eventIds || {}),
            ...(body.eventIds && typeof body.eventIds === 'object' ? body.eventIds : {})
        };

        const doc = {
            userId,
            sessionId,
            ttclid: body.ttclid || existing?.ttclid || null,
            ttp: body.ttp || existing?.ttp || null,
            eventIds: mergedEventIds,
            pageUrl: body.pageUrl || existing?.pageUrl || null,
            referrer: body.referrer || ctx.referrer || existing?.referrer || null,
            ip: ctx.ip || existing?.ip || null,
            userAgent: ctx.userAgent || existing?.userAgent || null,
            consentGranted: body.consent === false || body.consentGranted === false
                ? false
                : (existing?.consentGranted ?? true),
            updatedAt: nowIso,
            createdAt: existing?.createdAt || nowIso
        };

        try {
            if (existing) {
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'tiktok_sessions',
                    command: '--update',
                    data: { filter, update: doc }
                });
            } else {
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'tiktok_sessions',
                    command: '--create',
                    data: doc
                });
            }
            devLog('tiktok_session_stored', {
                identifier: userId || sessionId,
                hasTtclid: !!doc.ttclid,
                eventIdKeys: Object.keys(mergedEventIds)
            });
        } catch (dbErr) {
            logger.warn('tiktok_session_persist_failed', {
                identifier: userId || sessionId,
                message: dbErr.message
            });
        }

        return safeRespond(res, {
            success: true,
            session: {
                userId,
                sessionId,
                hasTtclid: !!doc.ttclid,
                eventIds: doc.eventIds,
                consentGranted: doc.consentGranted
            }
        });
    } catch (err) {
        logger.warn('tiktok_route_session_exception', { message: err?.message });
        return safeRespond(res, { success: false, error: err?.message || 'exception' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/tiktok/session/:id
// Read back the stored ttclid + event_ids for a userId OR sessionId.
// Returns 200 with `null` data when nothing stored.
// ---------------------------------------------------------------------------
router.get('/session/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ success: false, error: 'id is required' });

        const tryFilters = [{ userId: id }, { sessionId: id }];
        let doc = null;
        for (const filter of tryFilters) {
            const result = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'tiktok_sessions',
                command: '--read',
                data: filter
            });
            if (result.success && result.data) {
                doc = Array.isArray(result.data) ? result.data[0] : result.data;
                if (doc) break;
            }
        }
        return safeRespond(res, { success: true, data: doc || null });
    } catch (err) {
        logger.warn('tiktok_route_session_get_exception', { message: err?.message });
        return safeRespond(res, { success: false, error: err?.message || 'exception' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/tiktok/session/cleanup
// Admin-style maintenance — delete tiktok_sessions older than `days` days
// (default 30). Use to keep the collection bounded; ttclid attribution windows
// max out at 28 days on TikTok so anything older has no value.
// Body: { days?: number }
// ---------------------------------------------------------------------------
router.post('/session/cleanup', async (req, res) => {
    try {
        const days = Number(req.body?.days) > 0 ? Math.floor(Number(req.body.days)) : 30;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        let deleted = 0;
        try {
            const result = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'tiktok_sessions',
                command: '--delete-many',
                data: { updatedAt: { $lt: cutoff } }
            });
            deleted = Number(result?.data?.deletedCount) || 0;
        } catch (dbErr) {
            logger.warn('tiktok_session_cleanup_failed', { message: dbErr.message, days });
        }
        return res.json({ success: true, days, cutoff, deleted });
    } catch (err) {
        return res.status(500).json({ success: false, error: err?.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/tiktok/stats
// Lightweight diagnostics — counts of recent server-side events. Returns:
//   - last24h: { sent, failed, byEvent }
//   - last7d:  { sent, failed }
//   - emqAvg:  rolling EMQ score for CompletePayment
// Requires TIKTOK_EVENT_LOG_ENABLED=true so events are persisted.
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
    try {
        if (process.env.TIKTOK_EVENT_LOG_ENABLED !== 'true') {
            return res.json({
                success: true,
                enabled: false,
                hint: 'set TIKTOK_EVENT_LOG_ENABLED=true to enable analytics'
            });
        }

        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        // VornifyDB --read with $gte; tolerate adapter quirks by falling back to empty.
        const readSafe = async (filter) => {
            try {
                const r = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'tiktok_events_log',
                    command: '--read',
                    data: filter
                });
                if (!r.success || !r.data) return [];
                return Array.isArray(r.data) ? r.data : [r.data];
            } catch (_) {
                return [];
            }
        };

        const rows24 = await readSafe({ createdAt: { $gte: since24h } });
        const rows7d = await readSafe({ createdAt: { $gte: since7d } });

        const summarize = (rows) => {
            const out = { sent: 0, failed: 0, skipped: 0, byEvent: {} };
            for (const r of rows) {
                const evt = r.event || 'unknown';
                out.byEvent[evt] = out.byEvent[evt] || { sent: 0, failed: 0, skipped: 0 };
                if (r.status === 'success') {
                    out.sent += 1;
                    out.byEvent[evt].sent += 1;
                } else if (r.status === 'failure') {
                    out.failed += 1;
                    out.byEvent[evt].failed += 1;
                } else {
                    out.skipped += 1;
                    out.byEvent[evt].skipped += 1;
                }
            }
            return out;
        };

        // Rolling EMQ for CompletePayment over last 7d
        const cpRows = rows7d.filter((r) => r.event === 'CompletePayment' && typeof r.emqScore === 'number');
        const emqAvg = cpRows.length
            ? Number((cpRows.reduce((s, r) => s + r.emqScore, 0) / cpRows.length).toFixed(2))
            : null;

        return res.json({
            success: true,
            enabled: true,
            last24h: summarize(rows24),
            last7d: summarize(rows7d),
            completePaymentEmqAvg7d: emqAvg
        });
    } catch (err) {
        logger.warn('tiktok_route_stats_exception', { message: err?.message });
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
        eventLogEnabled: process.env.TIKTOK_EVENT_LOG_ENABLED === 'true',
        supportedEvents: Array.from(tiktokEvents.STANDARD_EVENTS),
        consentContract: {
            field: 'tiktok.consent (boolean) on /api/orders/create, or `consent` on /api/tiktok/track and /api/tiktok/session',
            default: 'true (granted) when omitted — legacy callers',
            denied: 'backend skips ALL server-side firing for that order/request',
            granted: 'backend fires server-side events, deduplicated against frontend Pixel by event_id'
        },
        recovery: {
            sessionLookup: 'webhook auto-recovers ttclid + completePaymentEventId from tiktok_sessions when missing on the order',
            idempotency: 'webhook never re-fires CompletePayment when order.tiktok.completePaymentSentAt is set'
        },
        catalog: {
            endpoints: {
                catalogJson: 'GET /api/tiktok/catalog?format=json',
                catalogCsv: 'GET /api/tiktok/catalog?format=csv',
                productAnalytics: 'GET /api/tiktok/product/:id/analytics'
            },
            baseUrl: tiktokCatalog.getCatalogBaseUrl(),
            productPathPrefix: tiktokCatalog.getProductPathPrefix(),
            contentIdRule: 'catalog id = MongoDB _id string; Pixel content_id must match exactly',
            feedKeyRequired: !!process.env.TIKTOK_CATALOG_FEED_KEY
        }
    });
});

// ---------------------------------------------------------------------------
// POST /api/tiktok/test
// Manual smoke test (best run with TIKTOK_TEST_EVENT_CODE to keep noise out of
// production stats). Useful right after credentials are filled in.
// Body: { event?: 'ViewContent', eventId?: '...', email?, value?, currency? }
// ---------------------------------------------------------------------------
router.post('/test', async (req, res) => {
    try {
        const body = req.body || {};
        const ctx = tiktokEvents.extractClientContextFromReq(req);
        const event = body.event || 'ViewContent';
        const result = await tiktokEvents.trackCommerceEvent(event, {
            eventId: body.eventId,
            ttclid: body.ttclid,
            email: body.email,
            phone: body.phone,
            externalId: body.externalId,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            pageUrl: body.pageUrl || 'https://peakmode.se/',
            value: body.value ?? 1,
            currency: body.currency || 'SEK',
            contentIds: body.contentIds || ['TEST_SKU'],
            items: [{
                id: 'TEST_SKU',
                title: 'TikTok Events API smoke test',
                price: Number(body.value ?? 1),
                quantity: 1
            }],
            context: 'route_test'
        });
        devLog('tiktok_smoke_test', result);
        return res.json({ success: true, result });
    } catch (err) {
        return res.status(500).json({ success: false, error: err?.message || 'exception' });
    }
});

module.exports = router;
