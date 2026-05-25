/**
 * Storefront reviews page — filter, sort, facets, product suggest.
 */

const productFilterService = require('./productFilterService');
const { normalizeProductForCatalog } = require('./productCatalogNormalize');

const SORT_KEYS = new Set(['newest', 'oldest', 'highest-rated', 'lowest-rated']);
const DATE_RANGE_DAYS = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 };

function parseCommaList(value) {
    if (value == null || value === '') return [];
    return String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * @param {object} query — req.query
 */
function parseReviewFilterQuery(query = {}) {
    const status =
        query.status != null && String(query.status).trim() !== ''
            ? String(query.status).trim()
            : null;
    const search =
        query.search != null && String(query.search).trim() !== ''
            ? String(query.search).trim()
            : query.q != null && String(query.q).trim() !== ''
              ? String(query.q).trim()
              : '';

    let ratingMin = null;
    if (query.ratingMin != null && query.ratingMin !== '') {
        const n = parseInt(query.ratingMin, 10);
        if (Number.isFinite(n) && n >= 1 && n <= 5) ratingMin = n;
    } else if (query.rating != null && query.rating !== '') {
        const n = parseInt(query.rating, 10);
        if (Number.isFinite(n)) ratingMin = n;
    }

    const productIds = parseCommaList(query.productId || query.productIds);
    const sizes = parseCommaList(query.size || query.sizes).map((s) => s.toUpperCase());

    const verified =
        query.verified === 'true' || query.verified === true || query.verifiedPurchase === 'true';

    const dateRange =
        query.dateRange && DATE_RANGE_DAYS[query.dateRange] ? String(query.dateRange) : null;

    let sort = query.sort ? String(query.sort).trim().toLowerCase() : null;
    if (!sort && query.sortBy) {
        const by = String(query.sortBy).trim();
        const order = String(query.sortOrder || 'desc').toLowerCase();
        if (by === 'rating') sort = order === 'asc' ? 'lowest-rated' : 'highest-rated';
        else if (by === 'createdAt') sort = order === 'asc' ? 'oldest' : 'newest';
    }
    if (!sort || !SORT_KEYS.has(sort)) sort = 'newest';

    const media = query.media ? String(query.media).trim().toLowerCase() : null;

    return {
        status,
        search,
        ratingMin,
        productIds,
        verified,
        dateRange,
        sort,
        media: media === 'photos' || media === 'videos' ? media : null,
        sizes
    };
}

function isApprovedReview(review, statusFilter) {
    const status = (review.status || '').toLowerCase();
    if (statusFilter === 'approved') return status === 'approved';
    return status === (statusFilter || '').toLowerCase();
}

function reviewCreatedAt(review) {
    return new Date(review.createdAt || review.created_at || 0).getTime();
}

function getReviewRating(review) {
    const n = Number(review.rating);
    return Number.isFinite(n) ? n : 0;
}

function getReviewProductId(review) {
    return review.productId || review.product?.id || review.product?._id || null;
}

function getReviewProductEntries(review) {
    if (Array.isArray(review.products) && review.products.length > 0) {
        return review.products
            .map((p) => ({
                id: p?.productId && p.productId !== 'general' ? String(p.productId) : null,
                name: String(p?.productName || p?.name || '').trim()
            }))
            .filter((p) => p.id || p.name);
    }
    const pid = getReviewProductId(review);
    const name = getReviewProductName(review);
    if (pid && pid !== 'general') return [{ id: String(pid), name }];
    if (name) return [{ id: null, name }];
    return [];
}

function getReviewProductIds(review) {
    return getReviewProductEntries(review)
        .map((e) => e.id)
        .filter(Boolean);
}

function getReviewProductName(review) {
    if (Array.isArray(review.productNames) && review.productNames.length > 0) {
        return review.productNames.join(', ');
    }
    if (Array.isArray(review.products) && review.products.length > 0) {
        return review.products.map((p) => p.productName || p.name).filter(Boolean).join(', ');
    }
    return (
        review.productName ||
        review.product?.name ||
        review.product?.title ||
        ''
    );
}

function getReviewSize(review) {
    const raw = review.sizePurchased || review.size || review.variantSize || '';
    return raw ? String(raw).trim().toUpperCase() : '';
}

function hasPhotos(review) {
    const images = review.images;
    return Array.isArray(images) && images.length > 0;
}

function hasVideos(review) {
    const videos = review.videos;
    return Array.isArray(videos) && videos.length > 0;
}

function reviewMatchesSearch(review, searchTerm) {
    const q = String(searchTerm || '').trim().toLowerCase();
    if (!q) return true;
    const productLabels = [
        getReviewProductName(review),
        ...(Array.isArray(review.productNames) ? review.productNames : []),
        ...(Array.isArray(review.products)
            ? review.products.map((p) => p?.productName || p?.name)
            : [])
    ];
    const parts = [
        review.title,
        review.comment,
        review.feedback,
        ...productLabels,
        review.customerName,
        review.customer?.name,
        review.location,
        getReviewSize(review)
    ];
    const haystack = parts
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return haystack.includes(q) || q.split(/\s+/).every((tok) => tok.length >= 2 && haystack.includes(tok));
}

function reviewMatchesFilters(review, filters) {
    if (filters.status && !isApprovedReview(review, filters.status)) return false;

    if (filters.ratingMin != null && getReviewRating(review) < filters.ratingMin) return false;

    if (filters.productIds.length > 0) {
        const reviewIds = new Set(getReviewProductIds(review).map(String));
        const primary = String(getReviewProductId(review) || '');
        if (primary && primary !== 'general') reviewIds.add(primary);
        if (!filters.productIds.some((id) => reviewIds.has(String(id)))) return false;
    }

    if (filters.verified && !(review.verifiedPurchase === true)) return false;

    if (filters.dateRange && DATE_RANGE_DAYS[filters.dateRange]) {
        const days = DATE_RANGE_DAYS[filters.dateRange];
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        if (reviewCreatedAt(review) < cutoff) return false;
    }

    if (filters.media === 'photos' && !hasPhotos(review)) return false;
    if (filters.media === 'videos' && !hasVideos(review)) return false;

    if (filters.sizes.length > 0) {
        const size = getReviewSize(review);
        if (!size || !filters.sizes.includes(size)) return false;
    }

    if (filters.search && !reviewMatchesSearch(review, filters.search)) return false;

    return true;
}

function sortReviews(reviews, sortKey) {
    const list = [...reviews];
    switch (sortKey) {
        case 'oldest':
            list.sort((a, b) => reviewCreatedAt(a) - reviewCreatedAt(b));
            break;
        case 'highest-rated':
            list.sort((a, b) => getReviewRating(b) - getReviewRating(a) || reviewCreatedAt(b) - reviewCreatedAt(a));
            break;
        case 'lowest-rated':
            list.sort((a, b) => getReviewRating(a) - getReviewRating(b) || reviewCreatedAt(b) - reviewCreatedAt(a));
            break;
        case 'newest':
        default:
            list.sort((a, b) => reviewCreatedAt(b) - reviewCreatedAt(a));
            break;
    }
    return list;
}

function normalizeReviewForStorefront(review) {
    const images = Array.isArray(review.images)
        ? review.images
        : review.images
          ? [review.images]
          : [];
    const videos = Array.isArray(review.videos)
        ? review.videos
        : review.videos
          ? [review.videos]
          : [];
    const feedback = review.feedback || review.comment || review.title || '';

    return {
        ...review,
        id: review.id || review._id,
        rating: getReviewRating(review),
        name: review.customerName || review.customer?.name || 'Customer',
        feedback,
        comment: review.comment || feedback,
        isVerified: review.verifiedPurchase === true,
        verifiedPurchase: review.verifiedPurchase === true,
        images,
        videos,
        createdAt: review.createdAt || review.created_at,
        location: review.location || null,
        productId: getReviewProductId(review),
        productName: getReviewProductName(review),
        productNames: Array.isArray(review.productNames)
            ? review.productNames
            : getReviewProductEntries(review).map((e) => e.name).filter(Boolean),
        products: Array.isArray(review.products) ? review.products : undefined,
        sizePurchased: getReviewSize(review) || null
    };
}

function filterAndSortReviews(reviews, filters) {
    const filtered = (reviews || []).filter((r) => reviewMatchesFilters(r, filters));
    return sortReviews(filtered, filters.sort).map(normalizeReviewForStorefront);
}

function extractFacets(reviews, filters, productMetaById = {}) {
    const statusFilter = filters.status || 'approved';
    const approved = (reviews || []).filter((r) => isApprovedReview(r, statusFilter));
    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const sizeCounts = new Map();
    const productCounts = new Map();
    let verifiedCount = 0;
    let withPhotosCount = 0;
    let withVideosCount = 0;

    for (const review of approved) {
        const rating = getReviewRating(review);
        if (rating >= 1 && rating <= 5) {
            ratingCounts[String(Math.round(rating))]++;
        }
        if (review.verifiedPurchase === true) verifiedCount++;
        if (hasPhotos(review)) withPhotosCount++;
        if (hasVideos(review)) withVideosCount++;

        const size = getReviewSize(review);
        if (size) {
            sizeCounts.set(size, (sizeCounts.get(size) || 0) + 1);
        }

        const entries = getReviewProductEntries(review);
        const seenPid = new Set();
        for (const entry of entries) {
            if (!entry.id || seenPid.has(entry.id)) continue;
            seenPid.add(entry.id);
            if (!productCounts.has(entry.id)) {
                productCounts.set(entry.id, {
                    id: entry.id,
                    reviewCount: 0,
                    name: entry.name || getReviewProductName(review)
                });
            }
            productCounts.get(entry.id).reviewCount++;
        }
        if (entries.length === 0) {
            const pid = getReviewProductId(review);
            if (pid && pid !== 'general') {
                if (!productCounts.has(pid)) {
                    productCounts.set(pid, {
                        id: pid,
                        reviewCount: 0,
                        name: getReviewProductName(review)
                    });
                }
                productCounts.get(pid).reviewCount++;
            }
        }
    }

    const products = [...productCounts.values()]
        .map((row) => {
            const meta = productMetaById[row.id] || {};
            return {
                id: row.id,
                name: meta.name || row.name || 'Product',
                imageUrl: meta.imageUrl || null,
                reviewCount: row.reviewCount,
                inStock: meta.inStock !== false,
                slug: meta.slug || null,
                hasReviews: true
            };
        })
        .sort((a, b) => b.reviewCount - a.reviewCount);

    const sizes = [...sizeCounts.entries()]
        .map(([id, count]) => ({ id, name: id, count }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
        products,
        sizes,
        ratingCounts,
        totalReviews: approved.length,
        verifiedCount,
        withPhotosCount,
        withVideosCount
    };
}

function productImageUrl(product) {
    if (!product) return null;
    const media = product.media || product.images;
    if (Array.isArray(media) && media[0]) return media[0];
    if (product.image) return product.image;
    if (product.imageUrl) return product.imageUrl;
    return null;
}

function productInStock(product) {
    if (!product) return false;
    if (product.published !== true || product.active === false) return false;
    return productFilterService.isListableOnStorefront(normalizeProductForCatalog({ ...product }));
}

function rankProductNameMatch(product, qLower) {
    const name = (product.name || '').toLowerCase();
    if (name === qLower) return 100;
    if (name.startsWith(qLower)) return 80;
    if (name.includes(qLower)) return 60;
    return 0;
}

module.exports = {
    SORT_KEYS,
    DATE_RANGE_DAYS,
    parseReviewFilterQuery,
    parseCommaList,
    isApprovedReview,
    reviewMatchesFilters,
    filterAndSortReviews,
    extractFacets,
    normalizeReviewForStorefront,
    productImageUrl,
    productInStock,
    rankProductNameMatch,
    getReviewProductId,
    getReviewProductIds,
    getReviewProductEntries
};
