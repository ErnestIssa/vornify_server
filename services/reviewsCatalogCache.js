/**
 * Short-lived in-memory cache of reviews for storefront filter endpoints.
 */

const TTL_MS = Number(process.env.REVIEWS_CATALOG_CACHE_TTL_MS) || 60_000;

let bucket = { reviews: null, expiresAt: 0 };

async function loadFromDb(db, status = null) {
    const query = status ? { status } : {};
    const result = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'reviews',
        command: '--read',
        data: query
    });
    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load reviews' };
    }
    let reviews = result.data || [];
    if (!Array.isArray(reviews)) reviews = reviews ? [reviews] : [];
    return { ok: true, reviews };
}

async function getReviews(db, { status = null, forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && bucket.reviews && now < bucket.expiresAt) {
        return { ok: true, reviews: bucket.reviews, fromCache: true };
    }
    const loaded = await loadFromDb(db, status);
    if (!loaded.ok) return loaded;
    bucket.reviews = loaded.reviews;
    bucket.expiresAt = now + TTL_MS;
    return { ok: true, reviews: loaded.reviews, fromCache: false };
}

function invalidateReviewsCatalogCache() {
    bucket = { reviews: null, expiresAt: 0 };
}

module.exports = {
    getReviews,
    invalidateReviewsCatalogCache,
    loadFromDb
};
