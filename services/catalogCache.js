/**
 * Shared in-memory catalog snapshot — one DB read serves list, filter-options, and count
 * for the same scope (featured vs full) within a short TTL.
 */

const featuredProduct = require('../utils/featuredProduct');

const TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS) || 90_000;

const buckets = {
    featured: { products: null, expiresAt: 0 },
    all: { products: null, expiresAt: 0 }
};

function isPublishedForStorefront(product) {
    return product && product.published === true;
}

async function loadFromDb(db, req, { featuredOnly }) {
    let query = {};
    if (!req.isAdminRequest) {
        query.published = true;
    }
    if (featuredOnly) {
        Object.assign(query, featuredProduct.buildFeaturedMongoClause());
    }

    const result = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'products',
        command: '--read',
        data: query
    });

    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load catalog' };
    }

    let products = result.data || [];
    if (!Array.isArray(products)) products = products ? [products] : [];

    if (!req.isAdminRequest) {
        products = products.filter(isPublishedForStorefront);
    }
    if (featuredOnly) {
        products = products.filter(featuredProduct.isFeaturedProduct);
    }
    products = products.filter((p) => p.active !== false);

    return { ok: true, products };
}

/**
 * @param {object} db — vornify db instance
 * @param {object} req — express request
 * @param {{ featuredOnly?: boolean, forceRefresh?: boolean }} opts
 */
async function getCatalogProducts(db, req, { featuredOnly = false, forceRefresh = false } = {}) {
    const bucketKey = featuredOnly ? 'featured' : 'all';
    const bucket = buckets[bucketKey];
    const now = Date.now();

    if (!forceRefresh && bucket.products && now < bucket.expiresAt) {
        return { ok: true, products: bucket.products, fromCache: true };
    }

    const loaded = await loadFromDb(db, req, { featuredOnly });
    if (!loaded.ok) return loaded;

    bucket.products = loaded.products;
    bucket.expiresAt = now + TTL_MS;
    return { ok: true, products: loaded.products, fromCache: false };
}

function invalidateCatalogCache() {
    buckets.featured = { products: null, expiresAt: 0 };
    buckets.all = { products: null, expiresAt: 0 };
}

module.exports = {
    getCatalogProducts,
    invalidateCatalogCache,
    loadFromDb
};
