/**
 * Normalize catalog products for filters, list, and PDP (matrix + variant qty).
 */
const variantService = require('./variantService');

function ensureInventoryStorefrontDefaults(inv) {
    if (!inv) return;
    if (!inv.storefront || typeof inv.storefront !== 'object') inv.storefront = {};
    if (typeof inv.storefront.showListingWhenFullySoldOut !== 'boolean') {
        inv.storefront.showListingWhenFullySoldOut = false;
    }
}

function normalizeProductForCatalog(product) {
    if (!product) return product;
    if (!product.id && product._id) {
        product.id = typeof product._id === 'string' ? product._id : product._id.toString();
    }
    const inv = product.inventory;
    ensureInventoryStorefrontDefaults(inv);
    if (inv && Array.isArray(inv.variants)) {
        inv.variants = inv.variants.map((v) => ({
            ...v,
            quantity: v.quantity !== undefined ? v.quantity : v.stock !== undefined ? v.stock : 0
        }));
    }
    if (product.variants && Array.isArray(product.variants)) {
        product.variants = product.variants.map((v) => ({
            ...v,
            quantity: v.quantity !== undefined ? v.quantity : v.stock !== undefined ? v.stock : 0
        }));
    }
    if (inv) {
        const matrix = variantService.buildColorSizeMatrix(inv);
        if (matrix) inv.colorSizeMatrix = matrix;
        else delete inv.colorSizeMatrix;
    }
    return product;
}

function normalizeCatalogProducts(products) {
    if (!Array.isArray(products)) return [];
    return products.map((p) => normalizeProductForCatalog(p));
}

module.exports = {
    ensureInventoryStorefrontDefaults,
    normalizeProductForCatalog,
    normalizeCatalogProducts
};
