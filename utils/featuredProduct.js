/**
 * Featured product eligibility — shared contract with Peak Mode storefront.
 * Primary: tags[] includes "featured" (case-insensitive).
 * Legacy: featured === true or isFeatured === true.
 */

const FEATURED_TAG = 'featured';

function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags
        .map((t) => (t != null ? String(t).trim() : ''))
        .filter(Boolean);
}

function hasFeaturedTag(tags) {
    return normalizeTags(tags).some((t) => t.toLowerCase() === FEATURED_TAG);
}

/** Whether a product may appear on /shop or featured UI sections */
function isFeaturedProduct(product) {
    if (!product || typeof product !== 'object') return false;
    if (hasFeaturedTag(product.tags)) return true;
    if (product.featured === true || product.isFeatured === true) return true;
    return false;
}

/** Mongo filter for featured-only listings (tags + legacy booleans) */
function buildFeaturedMongoClause() {
    return {
        $or: [
            { tags: { $regex: /^featured$/i } },
            { featured: true },
            { isFeatured: true }
        ]
    };
}

/**
 * Keep tags[], featured, and isFeatured aligned.
 * @param {object} product — merged product fields used to derive state
 * @param {object} [opts]
 * @param {boolean} [opts.tagsFromRequest] — tags were sent on this request (not only inherited)
 * @param {boolean} [opts.legacyFromRequest] — featured/isFeatured sent on this request
 * @returns {{ tags: string[], featured: boolean, isFeatured: boolean }}
 */
function syncFeaturedFields(product, { tagsFromRequest = true, legacyFromRequest = true } = {}) {
    const tags = normalizeTags(product?.tags);
    const withoutFeatured = tags.filter((t) => t.toLowerCase() !== FEATURED_TAG);
    const tagsSayFeatured = hasFeaturedTag(tags);
    const legacyFeatured =
        product?.featured === true || product?.isFeatured === true;
    const legacyExplicitUnfeatured =
        product?.featured === false || product?.isFeatured === false;

    let shouldFeature = tagsSayFeatured || legacyFeatured;

    if (legacyFromRequest && legacyExplicitUnfeatured && !legacyFeatured) {
        shouldFeature = false;
    } else if (tagsFromRequest) {
        shouldFeature = tagsSayFeatured;
        if (legacyFromRequest && legacyFeatured) shouldFeature = true;
        if (legacyFromRequest && legacyExplicitUnfeatured && !legacyFeatured) {
            shouldFeature = false;
        }
    } else if (legacyFromRequest) {
        shouldFeature = legacyFeatured;
    }

    if (shouldFeature) {
        return {
            tags: [...withoutFeatured, FEATURED_TAG],
            featured: true,
            isFeatured: true
        };
    }
    return {
        tags: withoutFeatured,
        featured: false,
        isFeatured: false
    };
}

/** Apply featured sync onto a create/update payload */
function applyFeaturedSyncToPayload(payload, existingProduct = null) {
    if (!payload || typeof payload !== 'object') return payload;
    const touchesFeatured =
        payload.tags !== undefined ||
        payload.featured !== undefined ||
        payload.isFeatured !== undefined;
    if (!touchesFeatured) return payload;

    const tagsFromRequest = payload.tags !== undefined;
    const legacyFromRequest =
        payload.featured !== undefined || payload.isFeatured !== undefined;
    const merged = {
        ...(existingProduct || {}),
        ...payload,
        ...(tagsFromRequest ? { tags: payload.tags } : {}),
        ...(legacyFromRequest
            ? {
                  featured:
                      payload.featured !== undefined
                          ? payload.featured
                          : existingProduct?.featured,
                  isFeatured:
                      payload.isFeatured !== undefined
                          ? payload.isFeatured
                          : existingProduct?.isFeatured
              }
            : {})
    };

    const synced = syncFeaturedFields(merged, { tagsFromRequest, legacyFromRequest });
    return {
        ...payload,
        tags: synced.tags,
        featured: synced.featured,
        isFeatured: synced.isFeatured
    };
}

function parseFeaturedQueryParam(value) {
    if (value == null || value === '') return false;
    const v = String(value).trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
}

module.exports = {
    FEATURED_TAG,
    normalizeTags,
    hasFeaturedTag,
    isFeaturedProduct,
    buildFeaturedMongoClause,
    syncFeaturedFields,
    applyFeaturedSyncToPayload,
    parseFeaturedQueryParam
};
