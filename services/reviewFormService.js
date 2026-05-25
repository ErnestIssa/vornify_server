/**
 * Desktop write-review form — payload parsing and media normalization.
 */

function processMediaArray(raw, label, reviewId) {
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item, index) => {
            if (item == null) return null;
            if (typeof item !== 'string') return null;
            if (
                item.startsWith('http://') ||
                item.startsWith('https://') ||
                item.startsWith('/uploads/') ||
                item.startsWith('data:image/') ||
                item.startsWith('data:video/')
            ) {
                return item;
            }
            return String(item);
        })
        .filter(Boolean);
}

/**
 * Normalize multi-product payload from storefront desktop form.
 */
function parseProductsPayload(body = {}) {
    const products = [];

    if (Array.isArray(body.products)) {
        for (const entry of body.products) {
            if (!entry || typeof entry !== 'object') continue;
            const productName = String(entry.productName || entry.name || '').trim();
            const rawId = entry.productId != null ? String(entry.productId).trim() : '';
            const productId = rawId && rawId !== 'general' ? rawId : null;
            if (productName || productId) {
                products.push({ productId, productName: productName || 'Product' });
            }
        }
    }

    let productNames = Array.isArray(body.productNames)
        ? body.productNames.map((s) => String(s).trim()).filter(Boolean)
        : [];

    if (products.length === 0 && productNames.length > 0) {
        for (const name of productNames) {
            products.push({ productId: null, productName: name });
        }
    }

    if (productNames.length === 0 && products.length > 0) {
        productNames = products.map((p) => p.productName);
    }

    const catalogIds = products
        .map((p) => p.productId)
        .filter((id) => id && id !== 'general');

    let productId = body.productId != null ? String(body.productId) : null;
    if (!productId || productId === '') {
        productId = catalogIds[0] || 'general';
    }

    let productName = body.productName != null ? String(body.productName).trim() : '';
    if (!productName && productNames.length > 0) {
        productName = productNames.join(', ');
    }

    const sizePurchased =
        body.sizePurchased != null && String(body.sizePurchased).trim() !== ''
            ? String(body.sizePurchased).trim().toUpperCase()
            : null;

    return {
        products,
        productNames,
        productId,
        productName,
        catalogIds,
        sizePurchased,
        hasCatalogProducts: catalogIds.length > 0
    };
}

module.exports = {
    parseProductsPayload,
    processMediaArray
};
