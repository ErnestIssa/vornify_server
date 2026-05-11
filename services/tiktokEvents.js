/**
 * TikTok Events API (v1.3) — server-side conversion tracking
 * ---------------------------------------------------------------------------
 * Production-grade integration for Peak Mode. Works alongside the TikTok
 * Pixel installed on the storefront. Pixel and Events API must share the
 * SAME `event_id` per event so TikTok deduplicates them within the 48h
 * matching window.
 *
 * Endpoint:   POST https://business-api.tiktok.com/open_api/v1.3/event/track/
 * Header:     Access-Token: <TIKTOK_ACCESS_TOKEN>
 *
 * Design rules (must not be broken):
 *   - Never throw out to callers (checkout success must NEVER depend on
 *     TikTok). All errors are swallowed and logged.
 *   - Read all credentials from env. Never hardcode.
 *   - Hash PII (email, phone, external_id) with SHA-256 (lowercased, trimmed).
 *   - Never log raw PII; only log redacted preview + hash prefix.
 *   - Be a no-op when credentials missing or `TIKTOK_EVENTS_ENABLED=false`.
 *   - Use Node's global fetch (Node ≥18) — no extra dependency.
 *
 * Future expansion: the same architecture can host Meta CAPI / Google
 * Enhanced Conversions by adding sibling files (e.g. metaEvents.js) and
 * a thin orchestrator. Keep this file focused on TikTok only.
 */

const crypto = require('crypto');
const { logger } = require('../core/logging/logger');
const { devLog } = require('../core/logging/devConsole');

const TIKTOK_TRACK_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
const TIKTOK_BATCH_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/batch/';

const STANDARD_EVENTS = new Set([
    'AddPaymentInfo',
    'AddToCart',
    'AddToWishlist',
    'ClickButton',
    'CompletePayment',
    'CompleteRegistration',
    'Contact',
    'Download',
    'InitiateCheckout',
    'PlaceAnOrder',
    'Search',
    'SubmitForm',
    'Subscribe',
    'ViewContent'
]);

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.TIKTOK_REQUEST_TIMEOUT_MS, 10) || 4500;
const DEFAULT_CURRENCY = (process.env.TIKTOK_DEFAULT_CURRENCY || 'SEK').toUpperCase();

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function getConfig() {
    return {
        pixelId: process.env.TIKTOK_PIXEL_ID || '',
        accessToken: process.env.TIKTOK_ACCESS_TOKEN || '',
        testEventCode: process.env.TIKTOK_TEST_EVENT_CODE || '',
        enabled: process.env.TIKTOK_EVENTS_ENABLED !== 'false'
    };
}

function isEnabled() {
    const cfg = getConfig();
    return !!(cfg.enabled && cfg.pixelId && cfg.accessToken);
}

function configStatus() {
    const cfg = getConfig();
    return {
        enabled: cfg.enabled,
        pixelIdConfigured: !!cfg.pixelId,
        accessTokenConfigured: !!cfg.accessToken,
        testMode: !!cfg.testEventCode,
        ready: isEnabled()
    };
}

// ---------------------------------------------------------------------------
// Hashing & sanitization helpers
// ---------------------------------------------------------------------------

function sha256(value) {
    if (value == null) return null;
    const str = String(value).trim().toLowerCase();
    if (!str) return null;
    return crypto.createHash('sha256').update(str).digest('hex');
}

function hashEmail(email) {
    if (!email || typeof email !== 'string') return null;
    return sha256(email.trim().toLowerCase());
}

function hashPhone(phone) {
    if (!phone) return null;
    // Strip everything except digits + leading '+' per E.164 best-effort
    const cleaned = String(phone).replace(/[^\d+]/g, '');
    if (!cleaned) return null;
    return sha256(cleaned);
}

function hashExternalId(id) {
    if (id == null) return null;
    return sha256(String(id));
}

function safeIp(ip) {
    if (!ip || typeof ip !== 'string') return null;
    // Normalize comma-delimited X-Forwarded-For lists; keep only first hop
    const first = ip.split(',')[0].trim();
    return first || null;
}

function truncateUserAgent(ua) {
    if (!ua || typeof ua !== 'string') return null;
    return ua.length > 512 ? ua.substring(0, 512) : ua;
}

// ---------------------------------------------------------------------------
// Identity extraction
// ---------------------------------------------------------------------------

/**
 * Pull (and hash) user-matching identifiers from arbitrary input.
 * Accepts both raw fields and a `req`-like object via .ip / .headers.
 *
 * @param {object} input
 * @param {string} [input.email]                Raw email (will be hashed)
 * @param {string} [input.phone]                Raw phone (will be hashed)
 * @param {string} [input.externalId]           Raw user/customer id (hashed)
 * @param {string} [input.ttclid]               TikTok click id (NOT hashed)
 * @param {string} [input.ttp]                  TikTok browser cookie value (NOT hashed)
 * @param {string} [input.ip]                   Client IP (raw)
 * @param {string} [input.userAgent]            Client user agent (raw)
 * @returns {object} TikTok-compatible `user` object
 */
function buildUserObject(input = {}) {
    const user = {};

    const emailHash = hashEmail(input.email);
    if (emailHash) user.email = emailHash;

    const phoneHash = hashPhone(input.phone);
    if (phoneHash) user.phone = phoneHash;

    const extHash = hashExternalId(input.externalId);
    if (extHash) user.external_id = extHash;

    if (input.ttclid && typeof input.ttclid === 'string') user.ttclid = input.ttclid.trim();
    if (input.ttp && typeof input.ttp === 'string') user.ttp = input.ttp.trim();

    const ip = safeIp(input.ip);
    if (ip) user.ip = ip;

    const ua = truncateUserAgent(input.userAgent);
    if (ua) user.user_agent = ua;

    return user;
}

/**
 * Build a TikTok `contents[]` array from Peak Mode cart/order items.
 * Tolerates missing fields — TikTok matches by content_id primarily.
 */
function buildContentsFromItems(items, { fallbackCurrency } = {}) {
    if (!Array.isArray(items) || items.length === 0) return [];
    return items.map((item) => {
        const id =
            item.productId ||
            item.id ||
            item.variantId ||
            item.sku ||
            null;
        const price = Number.isFinite(Number(item.price)) ? Number(item.price) : undefined;
        const qty = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1;
        const name = item.title || item.name || item.productName || undefined;
        const brand = item.brand || undefined;
        const category = item.category || item.categoryPath || undefined;

        const content = {
            content_id: id ? String(id) : 'unknown',
            content_type: 'product',
            quantity: qty
        };
        if (price !== undefined) content.price = price;
        if (name) content.content_name = name;
        if (brand) content.brand = brand;
        if (category) content.content_category = category;
        return content;
    });
}

function buildContentIdsFromItems(items) {
    if (!Array.isArray(items)) return [];
    return items
        .map((i) => i.productId || i.id || i.variantId || i.sku)
        .filter(Boolean)
        .map(String);
}

// ---------------------------------------------------------------------------
// Event ID helpers
// ---------------------------------------------------------------------------

/**
 * Generate a server-side event_id. Use ONLY as a last-resort fallback —
 * for deduplication to work, the frontend Pixel must provide the same
 * event_id that the backend sends. The frontend should always be the
 * source of truth for event_id values that have a corresponding Pixel
 * event.
 */
function generateEventId(prefix = 'evt') {
    const id = crypto.randomUUID
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString('hex');
    return `${prefix}_${id}`;
}

// ---------------------------------------------------------------------------
// Core sender
// ---------------------------------------------------------------------------

/**
 * Send a single event to the TikTok Events API.
 *
 * NEVER throws. Returns a result envelope.
 *
 * @param {string} eventName              Standard or custom event name
 * @param {object} payload                Event payload
 * @param {string} [payload.eventId]      REQUIRED for deduplication — should match the
 *                                        event_id used in the Pixel `ttq.track()` call.
 *                                        Auto-generated if missing (no dedup possible then).
 * @param {number} [payload.eventTime]    Unix seconds. Defaults to now.
 * @param {object} [payload.user]         Output of `buildUserObject()` OR raw inputs that
 *                                        this function will normalize for you.
 * @param {object} [payload.page]         { url, referrer }
 * @param {object} [payload.properties]   { value, currency, contents, content_ids,
 *                                          content_type, query, description, order_id }
 * @param {string} [payload.eventSourceUrl] Convenience: shortcut for page.url
 *
 * @returns {Promise<{ok: boolean, skipped?: boolean, status?: number, code?: number,
 *                    message?: string, eventId?: string, requestId?: string,
 *                    error?: string}>}
 */
async function sendTikTokEvent(eventName, payload = {}) {
    const cfg = getConfig();

    if (!cfg.enabled) {
        return { ok: false, skipped: true, message: 'TikTok Events disabled (TIKTOK_EVENTS_ENABLED=false)' };
    }
    if (!cfg.pixelId || !cfg.accessToken) {
        // Soft no-op: keep checkout flowing even before credentials are issued.
        return {
            ok: false,
            skipped: true,
            message: 'TikTok credentials not configured (TIKTOK_PIXEL_ID / TIKTOK_ACCESS_TOKEN)'
        };
    }
    if (!eventName || typeof eventName !== 'string') {
        return { ok: false, error: 'eventName_required' };
    }

    const eventId = payload.eventId || generateEventId(eventName.toLowerCase());
    const eventTime = Number.isFinite(payload.eventTime)
        ? Math.floor(payload.eventTime)
        : Math.floor(Date.now() / 1000);

    // Normalize user object — accept either pre-built or raw fields.
    let user = {};
    if (payload.user && typeof payload.user === 'object') {
        // If raw fields are provided alongside the user object, merge — raw wins.
        const hasRawIdentity =
            payload.user.email ||
            payload.user.phone ||
            payload.user.externalId ||
            payload.user.ttclid ||
            payload.user.ttp ||
            payload.user.ip ||
            payload.user.userAgent;
        user = hasRawIdentity ? buildUserObject(payload.user) : { ...payload.user };
    }

    // Page object
    const page = {};
    const pageUrl = payload.eventSourceUrl || payload.page?.url;
    if (pageUrl) page.url = pageUrl;
    if (payload.page?.referrer) page.referrer = payload.page.referrer;

    // Properties (value, currency, contents, etc.)
    const properties = { ...(payload.properties || {}) };
    if (properties.value !== undefined) {
        const n = Number(properties.value);
        properties.value = Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
    }
    if (properties.currency) {
        properties.currency = String(properties.currency).toUpperCase();
    } else if (properties.value !== undefined) {
        // Default currency when value is set but currency missing
        properties.currency = DEFAULT_CURRENCY;
    }

    // Build the per-event object
    const eventEntry = {
        event: eventName,
        event_time: eventTime,
        event_id: eventId
    };
    if (Object.keys(user).length) eventEntry.user = user;
    if (Object.keys(page).length) eventEntry.page = page;
    if (Object.keys(properties).length) eventEntry.properties = properties;

    const body = {
        event_source: 'web',
        event_source_id: cfg.pixelId,
        data: [eventEntry]
    };
    if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;
    if (payload.partnerName) body.partner_name = String(payload.partnerName);

    return performRequest(eventName, eventId, body, cfg);
}

/**
 * Send multiple events in a single round-trip. Returns aggregate result.
 * Each event must already include eventId (recommended) and eventTime.
 */
async function sendTikTokEventsBatch(events = []) {
    const cfg = getConfig();
    if (!cfg.enabled || !cfg.pixelId || !cfg.accessToken) {
        return { ok: false, skipped: true, message: 'TikTok Events not ready' };
    }
    if (!Array.isArray(events) || events.length === 0) {
        return { ok: false, error: 'events_required' };
    }

    const data = events.map((evt) => {
        const eventId = evt.eventId || generateEventId(String(evt.event || 'event').toLowerCase());
        const entry = {
            event: evt.event,
            event_time: Number.isFinite(evt.eventTime) ? Math.floor(evt.eventTime) : Math.floor(Date.now() / 1000),
            event_id: eventId
        };
        if (evt.user && typeof evt.user === 'object') {
            const hasRaw = evt.user.email || evt.user.phone || evt.user.externalId || evt.user.ttclid;
            entry.user = hasRaw ? buildUserObject(evt.user) : { ...evt.user };
        }
        if (evt.page && (evt.page.url || evt.page.referrer)) entry.page = { ...evt.page };
        if (evt.properties && Object.keys(evt.properties).length) entry.properties = { ...evt.properties };
        return entry;
    });

    const body = {
        event_source: 'web',
        event_source_id: cfg.pixelId,
        data
    };
    if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;

    return performRequest(`batch(${data.length})`, data.map((d) => d.event_id).join(','), body, cfg);
}

async function performRequest(eventLabel, eventId, body, cfg) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
        const response = await fetch(TIKTOK_TRACK_URL, {
            method: 'POST',
            headers: {
                'Access-Token': cfg.accessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        const text = await response.text();
        let parsed = null;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch (_) {
            parsed = null;
        }

        const apiCode = parsed?.code;
        const apiMessage = parsed?.message;
        const requestId = parsed?.request_id;
        const httpOk = response.ok;
        // TikTok returns HTTP 200 with code:0 for success and non-zero for app-level errors.
        const apiOk = apiCode === 0 || apiCode === '0';
        const success = httpOk && (apiOk || apiCode === undefined);

        if (success) {
            devLog('tiktok_event_sent', { event: eventLabel, eventId, requestId, testMode: !!cfg.testEventCode });
        } else {
            logger.warn('tiktok_event_failed', {
                event: eventLabel,
                eventId,
                httpStatus: response.status,
                apiCode,
                apiMessage,
                requestId,
                hint: 'verify TIKTOK_PIXEL_ID + TIKTOK_ACCESS_TOKEN belong to the same pixel and that the access token has Events API permission'
            });
        }

        return {
            ok: success,
            status: response.status,
            code: apiCode,
            message: apiMessage,
            eventId,
            requestId
        };
    } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
        logger.warn('tiktok_event_exception', {
            event: eventLabel,
            eventId,
            aborted,
            message: err?.message || String(err)
        });
        return {
            ok: false,
            eventId,
            error: aborted ? 'timeout' : (err?.message || 'unknown_error')
        };
    } finally {
        clearTimeout(timeout);
    }
}

// ---------------------------------------------------------------------------
// High-level convenience helpers — one per supported event
// ---------------------------------------------------------------------------

/**
 * Fire CompletePayment for a Peak Mode order.
 * Should be called AFTER Stripe confirms payment success (webhook).
 *
 * @param {object} order             The full order document from MongoDB
 * @param {object} [options]
 * @param {string} [options.eventId] Override event_id. Falls back to
 *                                   order.tiktok?.completePaymentEventId →
 *                                   order.tiktokEventIds?.completePayment →
 *                                   newly generated (no dedup possible).
 * @param {string} [options.ttclid]  Override ttclid. Falls back to order.tiktok?.ttclid.
 * @param {string} [options.ip]      Client IP (raw)
 * @param {string} [options.userAgent]
 * @param {string} [options.pageUrl]
 * @returns {Promise<object>}        Result envelope from sendTikTokEvent
 */
async function trackCompletePayment(order, options = {}) {
    try {
        if (!order || typeof order !== 'object') {
            return { ok: false, error: 'order_required' };
        }

        const tk = order.tiktok || {};
        const legacyIds = order.tiktokEventIds || {};
        const eventId =
            options.eventId ||
            tk.completePaymentEventId ||
            legacyIds.completePayment ||
            null;

        const ttclid = options.ttclid || tk.ttclid || order.ttclid || null;
        const ttp = options.ttp || tk.ttp || null;

        const items = Array.isArray(order.items) ? order.items : [];
        const currency = (order.currency || order.totals?.currency || DEFAULT_CURRENCY).toUpperCase();
        const totalValue =
            Number(order.totals?.total) ||
            Number(order.total) ||
            0;

        const email = order.customer?.email || order.customerEmail;
        const phone = order.customer?.phone || order.shippingAddress?.phone;
        const externalId = order.userId || order.customerId || email || null;

        const payload = {
            eventId: eventId || undefined,
            user: buildUserObject({
                email,
                phone,
                externalId,
                ttclid,
                ttp,
                ip: options.ip || tk.ip || null,
                userAgent: options.userAgent || tk.userAgent || null
            }),
            page: {
                url: options.pageUrl || tk.pageUrl || null,
                referrer: options.referrer || tk.referrer || null
            },
            properties: {
                currency,
                value: totalValue,
                content_type: 'product',
                content_ids: buildContentIdsFromItems(items),
                contents: buildContentsFromItems(items, { fallbackCurrency: currency }),
                order_id: order.orderId || order.id || null,
                description: `Order ${order.orderId || ''}`.trim()
            }
        };

        return sendTikTokEvent('CompletePayment', payload);
    } catch (err) {
        logger.warn('tiktok_complete_payment_exception', { message: err?.message });
        return { ok: false, error: err?.message || 'exception' };
    }
}

/**
 * Fire InitiateCheckout when the customer commits to pay (e.g. after
 * Peak Mode's /api/orders/create OR /api/payments/prepare-confirmation).
 */
async function trackInitiateCheckout({
    eventId,
    ttclid,
    ttp,
    email,
    phone,
    externalId,
    ip,
    userAgent,
    pageUrl,
    referrer,
    items,
    value,
    currency
} = {}) {
    try {
        const cur = (currency || DEFAULT_CURRENCY).toUpperCase();
        return sendTikTokEvent('InitiateCheckout', {
            eventId,
            user: buildUserObject({ email, phone, externalId, ttclid, ttp, ip, userAgent }),
            page: { url: pageUrl, referrer },
            properties: {
                currency: cur,
                value: Number(value) || 0,
                content_type: 'product',
                content_ids: buildContentIdsFromItems(items),
                contents: buildContentsFromItems(items)
            }
        });
    } catch (err) {
        logger.warn('tiktok_initiate_checkout_exception', { message: err?.message });
        return { ok: false, error: err?.message || 'exception' };
    }
}

/**
 * Fire AddPaymentInfo (optional). Fire when the user successfully attaches
 * a payment method but BEFORE confirming the payment.
 */
async function trackAddPaymentInfo({
    eventId,
    ttclid,
    ttp,
    email,
    phone,
    externalId,
    ip,
    userAgent,
    pageUrl,
    referrer,
    items,
    value,
    currency
} = {}) {
    try {
        const cur = (currency || DEFAULT_CURRENCY).toUpperCase();
        return sendTikTokEvent('AddPaymentInfo', {
            eventId,
            user: buildUserObject({ email, phone, externalId, ttclid, ttp, ip, userAgent }),
            page: { url: pageUrl, referrer },
            properties: {
                currency: cur,
                value: Number(value) || 0,
                content_type: 'product',
                content_ids: buildContentIdsFromItems(items),
                contents: buildContentsFromItems(items)
            }
        });
    } catch (err) {
        logger.warn('tiktok_add_payment_info_exception', { message: err?.message });
        return { ok: false, error: err?.message || 'exception' };
    }
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/**
 * Pull client IP + user agent from an Express `req` in a CF/Render-aware way.
 * Use this before persisting checkout drafts so the same identity travels with
 * the order all the way through to the webhook-fired CompletePayment.
 */
function extractClientContextFromReq(req) {
    if (!req || typeof req !== 'object') return { ip: null, userAgent: null };
    const headers = req.headers || {};
    const xff = headers['x-forwarded-for'] || '';
    const cfip = headers['cf-connecting-ip'] || headers['true-client-ip'] || '';
    const reqIp = req.ip || req.connection?.remoteAddress || '';
    const rawIp = cfip || (xff ? String(xff).split(',')[0].trim() : '') || reqIp || '';
    return {
        ip: safeIp(rawIp),
        userAgent: truncateUserAgent(headers['user-agent'] || ''),
        referrer: headers['referer'] || headers['referrer'] || null
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    // Core
    sendTikTokEvent,
    sendTikTokEventsBatch,

    // Helpers per event
    trackCompletePayment,
    trackInitiateCheckout,
    trackAddPaymentInfo,

    // Utilities (exported for reuse / testing)
    buildUserObject,
    buildContentsFromItems,
    buildContentIdsFromItems,
    extractClientContextFromReq,
    generateEventId,
    hashEmail,
    hashPhone,
    hashExternalId,

    // Diagnostics
    isEnabled,
    configStatus,

    // Constants
    STANDARD_EVENTS,
    TIKTOK_TRACK_URL,
    TIKTOK_BATCH_URL
};
