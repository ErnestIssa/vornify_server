/**
 * Central cache busting when catalog or site content changes.
 */

const responseCache = require('../core/cache/responseCache');
const catalogCache = require('./catalogCache');

function onCatalogChanged() {
    catalogCache.invalidateCatalogCache();
    responseCache.invalidatePrefixes(['products:', 'reviews:', 'tiktok:catalog', 'meta:']);
}

function onSiteContentChanged() {
    responseCache.invalidatePrefixes(['admin:content', 'notice-bars:']);
}

function onPaymentsConfigChanged() {
    responseCache.invalidatePrefixes(['payments:']);
}

function onReviewsChanged() {
    responseCache.invalidatePrefixes(['reviews:']);
    try {
        const reviewsCatalogCache = require('./reviewsCatalogCache');
        reviewsCatalogCache.invalidateReviewsCatalogCache();
    } catch (_) {
        /* optional */
    }
}

function onOrdersChanged() {
    responseCache.invalidatePrefixes(['reviews:purchasable-products']);
    try {
        const purchasableProductsCache = require('./purchasableProductsCache');
        purchasableProductsCache.invalidatePurchasableProductsCache();
    } catch (_) {
        /* optional */
    }
}

module.exports = {
    onCatalogChanged,
    onSiteContentChanged,
    onPaymentsConfigChanged,
    onReviewsChanged,
    onOrdersChanged
};
