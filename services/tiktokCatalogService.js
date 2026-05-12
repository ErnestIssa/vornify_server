/**
 * TikTok Product Catalog — feed builder
 * ---------------------------------------------------------------------------
 * TikTok Ads Manager links pixels to catalogs when:
 *   - A structured product feed exists (this module)
 *   - Catalog `id` matches Pixel `content_id` / `contents[].content_id`
 *   - Catalog `link` matches the real product page URL (same path the user lands on)
 *
 * Peak Mode storefront product URLs MUST use:
 *   {STOREFRONT_URL}/product/{catalogProductId}
 * where `catalogProductId` is the MongoDB ObjectId string (24-char hex) so it
 * matches `ViewContent` / `AddToCart` / `CompletePayment` payloads.
 *
 * Env:
 *   STOREFRONT_URL | FRONTEND_URL | PUBLIC_STORE_URL — catalog link base (no trailing slash)
 *   TIKTOK_CATALOG_PATH_PREFIX — default `/product` (singular; matches user spec)
 *   TIKTOK_CATALOG_FEED_KEY — optional; when set, `GET /api/tiktok/catalog?key=...` is required
 */

const seoHelper = require('../utils/seoHelper');
const { getStorefrontBaseUrl } = require('./storefrontCheckoutUrls');

function trimSlash(s) {
    return String(s || '').replace(/\/$/, '');
}

function getCatalogBaseUrl() {
    const base = getStorefrontBaseUrl();
    if (base) return trimSlash(base);
    return trimSlash(process.env.BASE_URL || 'https://peakmode.se');
}

function getProductPathPrefix() {
    const raw = process.env.TIKTOK_CATALOG_PATH_PREFIX || '/product';
    const p = raw.startsWith('/') ? raw : `/${raw}`;
    return p.replace(/\/$/, '') || '/product';
}

function toAbsoluteUrl(url, baseUrl) {
    if (!url) return '';
    const str = String(url).trim();
    if (!str) return '';
    if (str.startsWith('http://') || str.startsWith('https://')) return str;
    const b = trimSlash(baseUrl);
    if (str.startsWith('/')) return `${b}${str}`;
    return `${b}/${str}`;
}

function getPrimaryImage(product, baseUrl) {
    const candidate =
        (Array.isArray(product?.media) && product.media[0]) ||
        (Array.isArray(product?.images) && product.images[0]) ||
        product?.image ||
        product?.seo?.primaryImage ||
        (Array.isArray(product?.seo?.images) && product.seo.images[0]) ||
        '';
    return toAbsoluteUrl(candidate, baseUrl);
}

/**
 * Catalog product id — TikTok + Pixel must use this exact string everywhere.
 * Prefer MongoDB `_id` hex string; fall back to legacy `id` string.
 */
function getCatalogProductId(product) {
    if (!product) return '';
    const oid = product._id;
    if (oid != null) {
        if (typeof oid === 'object' && typeof oid.toString === 'function') {
            return String(oid.toString());
        }
        return String(oid);
    }
    if (product.id != null) return String(product.id);
    return '';
}

function getProductPageUrl(product) {
    const base = getCatalogBaseUrl();
    const prefix = getProductPathPrefix();
    const pid = getCatalogProductId(product);
    if (!base || !pid) return '';
    return `${base}${prefix}/${encodeURIComponent(pid)}`;
}

function stripHtmlDescription(text, maxLen = 5000) {
    if (!text) return '';
    const plain = String(text)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) : plain;
}

/**
 * TikTok catalog availability strings (Google Shopping–compatible subset).
 */
function getTikTokAvailability(product) {
    const avail = seoHelper.calculateAvailability(product);
    switch (avail) {
        case 'in_stock':
            return 'in stock';
        case 'preorder':
            return 'preorder';
        case 'out_of_stock':
        default:
            return 'out of stock';
    }
}

function isPublishedForCatalog(product) {
    return product && product.published === true && product.active !== false;
}

/**
 * Single row in the shape TikTok Catalog / Data Feed expects (JSON).
 */
function productToTikTokCatalogItem(product) {
    const base = getCatalogBaseUrl();
    const currency = (product.currency || product.baseCurrency || 'SEK').toUpperCase();
    const priceNum = Number(product.price);
    const price = Number.isFinite(priceNum) ? Math.round(priceNum * 100) / 100 : 0;

    return {
        id: getCatalogProductId(product),
        title: product.name || product.title || '',
        description: stripHtmlDescription(product.description || ''),
        price,
        currency,
        image_link: getPrimaryImage(product, base),
        link: getProductPageUrl(product),
        availability: getTikTokAvailability(product),
        // Optional but useful for TikTok / Google-style feeds
        brand: product.brand || 'Peak Mode',
        condition: 'new',
        gtin: product.gtin || '',
        mpn: product.mpn || product.sku || ''
    };
}

function validateCatalogFeedKey(req) {
    const expected = process.env.TIKTOK_CATALOG_FEED_KEY;
    if (!expected) return true;
    const got = req.query.key || req.headers['x-tiktok-catalog-key'];
    return String(got || '') === String(expected);
}

module.exports = {
    getCatalogBaseUrl,
    getProductPathPrefix,
    getCatalogProductId,
    getProductPageUrl,
    productToTikTokCatalogItem,
    isPublishedForCatalog,
    validateCatalogFeedKey,
    getPrimaryImage,
    toAbsoluteUrl
};
