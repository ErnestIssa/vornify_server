/**
 * In-memory HTTP response cache (ISR-style at the API layer).
 * Serves precomputed JSON for identical storefront requests until TTL expires.
 * Admin requests and X-Skip-Cache bypass the cache.
 */

const crypto = require('crypto');

const store = new Map();

const DEFAULT_TTL_SEC = {
    'products:list': 120,
    'products:filter-options': 180,
    'products:count': 90,
    'products:categories': 300,
    'products:most-viewed': 120,
    'products:detail': 120,
    'products:variants': 120,
    'products:sitemap': 600,
    'notice-bars:active': 60,
    'admin:content': 120,
    'currency:display': 3600,
    'currency:settings': 3600,
    'vat:config': 3600,
    'reviews:list': 180,
    'reviews:detail': 180,
    'payments:checkout-nav': 300,
    'payments:methods': 300,
    'payments:config': 600,
    'tiktok:catalog': 300,
    'tiktok:health': 60
};

const MAX_ENTRIES = Number(process.env.RESPONSE_CACHE_MAX_ENTRIES) || 2000;

function isCacheDisabled() {
    return process.env.DISABLE_RESPONSE_CACHE === 'true';
}

function shouldBypass(req) {
    return (
        isCacheDisabled() ||
        req.isAdminRequest === true ||
        req.headers['x-skip-cache'] === '1'
    );
}

function stableQuery(query = {}) {
    const keys = Object.keys(query).sort();
    return keys.map((k) => `${k}=${String(query[k])}`).join('&');
}

function buildCacheKey(req, namespace) {
    const raw = [namespace, stableQuery(req.query), req.path || ''].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function etagForBody(body) {
    const hash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex');
    return `"${hash}"`;
}

function pruneIfNeeded() {
    if (store.size <= MAX_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        if (entry.expiresAt <= now) store.delete(key);
    }
    if (store.size <= MAX_ENTRIES) return;
    const sorted = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const remove = sorted.length - MAX_ENTRIES;
    for (let i = 0; i < remove; i++) store.delete(sorted[i][0]);
}

function get(namespace, cacheKey) {
    const entry = store.get(`${namespace}:${cacheKey}`);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
        store.delete(`${namespace}:${cacheKey}`);
        return null;
    }
    return entry;
}

function set(namespace, cacheKey, body, ttlSec) {
    const etag = etagForBody(body);
    const maxAge = ttlSec || DEFAULT_TTL_SEC[namespace] || 60;
    const entry = {
        body,
        etag,
        maxAge,
        expiresAt: Date.now() + maxAge * 1000
    };
    store.set(`${namespace}:${cacheKey}`, entry);
    pruneIfNeeded();
    return entry;
}

/**
 * Try to respond from cache. Returns true if response was sent (200 or 304).
 */
function tryHit(req, res, namespace) {
    if (shouldBypass(req)) return false;
    const cacheKey = buildCacheKey(req, namespace);
    const entry = get(namespace, cacheKey);
    if (!entry) return false;

    res.set('Cache-Control', `public, max-age=${entry.maxAge}, stale-while-revalidate=120`);
    res.set('ETag', entry.etag);
    res.set('X-Cache', 'HIT');

    const inm = req.headers['if-none-match'];
    if (inm && inm === entry.etag) {
        res.status(304).end();
        return true;
    }

    res.status(200).json(entry.body);
    return true;
}

/**
 * Store body and send JSON with cache headers.
 */
function json(res, req, body, namespace, ttlSec) {
    if (shouldBypass(req)) {
        res.set('X-Cache', 'BYPASS');
        return res.json(body);
    }

    const cacheKey = buildCacheKey(req, namespace);
    const entry = set(namespace, cacheKey, body, ttlSec);
    res.set('Cache-Control', `public, max-age=${entry.maxAge}, stale-while-revalidate=120`);
    res.set('ETag', entry.etag);
    res.set('X-Cache', 'MISS');

    const inm = req.headers['if-none-match'];
    if (inm && inm === entry.etag) {
        return res.status(304).end();
    }

    return res.json(body);
}

/** Invalidate all namespaces whose store key starts with any prefix (e.g. "products:") */
function invalidatePrefixes(prefixes) {
    const list = Array.isArray(prefixes) ? prefixes : [prefixes];
    for (const key of [...store.keys()]) {
        if (list.some((p) => key.startsWith(p))) store.delete(key);
    }
}

function invalidateNamespace(namespace) {
    invalidatePrefixes(`${namespace}:`);
}

function stats() {
    const now = Date.now();
    let active = 0;
    for (const entry of store.values()) {
        if (entry.expiresAt > now) active++;
    }
    return { totalKeys: store.size, activeEntries: active };
}

module.exports = {
    DEFAULT_TTL_SEC,
    shouldBypass,
    tryHit,
    json,
    invalidatePrefixes,
    invalidateNamespace,
    stats
};
