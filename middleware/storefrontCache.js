/**
 * Site-wide GET response cache for public storefront APIs.
 * Runs before route handlers: HIT → instant JSON; MISS → wrap res.json to store response.
 */

const responseCache = require('../core/cache/responseCache');

/** Never cache user-specific or transactional APIs */
const NO_CACHE_PREFIXES = [
    '/api/cart',
    '/api/checkout',
    '/api/orders',
    '/api/payments/status',
    '/api/payments/intent',
    '/api/payments/prepare',
    '/api/payments/create-intent',
    '/api/payments/confirm',
    '/api/payments/webhook',
    '/api/auth',
    '/api/support',
    '/api/customers',
    '/api/newsletter',
    '/api/subscribers',
    '/api/waitlist',
    '/api/abandoned-cart',
    '/api/payment-failure',
    '/api/email',
    '/api/upload',
    '/api/uploads',
    '/api/vornifydb',
    '/api/storage',
    '/api/tracking',
];

const RESERVED_PRODUCT_SEGMENTS = new Set([
    'filter-options',
    'count',
    'categories',
    'most-viewed',
    'sitemap'
]);

/**
 * { test(path), namespace, ttl }
 * path = req path without query (e.g. /api/products/abc)
 */
const CACHE_RULES = [
    { test: (p) => p === '/api/vat', namespace: 'vat:config', ttl: 3600 },
    { test: (p) => p === '/api/currency/display', namespace: 'currency:display', ttl: 3600 },
    { test: (p) => p === '/api/settings/currencies', namespace: 'currency:settings', ttl: 3600 },
    { test: (p) => p === '/api/admin/content', namespace: 'admin:content', ttl: 120 },
    { test: (p) => p === '/api/public/notice-bars/active', namespace: 'notice-bars:active', ttl: 60 },
    { test: (p) => p === '/api/products/filter-options', namespace: 'products:filter-options', ttl: 180 },
    { test: (p) => p === '/api/products/count', namespace: 'products:count', ttl: 90 },
    { test: (p) => p === '/api/products/categories', namespace: 'products:categories', ttl: 300 },
    { test: (p) => p === '/api/products/most-viewed', namespace: 'products:most-viewed', ttl: 120 },
    { test: (p) => p === '/api/products/sitemap', namespace: 'products:sitemap', ttl: 600 },
    { test: (p) => p === '/api/products', namespace: 'products:list', ttl: 120 },
    {
        test: (p) => {
            const m = p.match(/^\/api\/products\/([^/]+)$/);
            if (!m) return false;
            return !RESERVED_PRODUCT_SEGMENTS.has(m[1]);
        },
        namespace: 'products:detail',
        ttl: 120
    },
    {
        test: (p) => /^\/api\/products\/[^/]+\/variants$/.test(p),
        namespace: 'products:variants',
        ttl: 120
    },
    { test: (p) => p === '/api/reviews', namespace: 'reviews:list', ttl: 180 },
    {
        test: (p) => /^\/api\/reviews\/[^/]+$/.test(p) && p !== '/api/reviews/analytics',
        namespace: 'reviews:detail',
        ttl: 180
    },
    { test: (p) => p === '/api/payments/checkout-navigation', namespace: 'payments:checkout-nav', ttl: 300 },
    { test: (p) => p === '/api/payments/check-payment-methods', namespace: 'payments:methods', ttl: 300 },
    { test: (p) => p === '/api/payments/config', namespace: 'payments:config', ttl: 600 },
    { test: (p) => p === '/api/tiktok/catalog', namespace: 'tiktok:catalog', ttl: 300 },
    { test: (p) => p === '/api/tiktok/health', namespace: 'tiktok:health', ttl: 60 }
];

function pathWithoutQuery(req) {
    const raw = req.originalUrl || req.url || '';
    const path = raw.split('?')[0].replace(/\/+$/, '') || '/';
    return path;
}

function matchCacheRule(path) {
    if (path.startsWith('/api/admin/') && path !== '/api/admin/content') {
        return null;
    }
    if (NO_CACHE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
        return null;
    }
    for (const rule of CACHE_RULES) {
        if (rule.test(path)) {
            return { namespace: rule.namespace, ttl: rule.ttl };
        }
    }
    return null;
}

function storefrontCacheMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
    }
    if (responseCache.shouldBypass(req)) {
        return next();
    }

    const path = pathWithoutQuery(req);
    const rule = matchCacheRule(path);
    if (!rule) {
        return next();
    }

    if (!res._jsonWithoutCache) {
        res._jsonWithoutCache = res.json.bind(res);
    }

    if (responseCache.tryHit(req, res, rule.namespace)) {
        return;
    }

    req._responseCache = rule;

    const originalJson = res._jsonWithoutCache;
    res.json = function cacheAwareJson(body) {
        if (
            req._responseCache &&
            !res.headersSent &&
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            body !== undefined
        ) {
            return responseCache.json(
                res,
                req,
                body,
                req._responseCache.namespace,
                req._responseCache.ttl
            );
        }
        return originalJson(body);
    };

    next();
}

module.exports = storefrontCacheMiddleware;
module.exports.CACHE_RULES = CACHE_RULES;
module.exports.NO_CACHE_PREFIXES = NO_CACHE_PREFIXES;
