/**
 * Advanced storefront product search (text, SKU, facets, intents, price words).
 * Used by productFilterService for modal, /shop, and /all-products.
 */

const featuredProduct = require('../utils/featuredProduct');

const NUMBER_WORDS = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
    hundred: 100,
    noll: 0,
    en: 1,
    ett: 1,
    två: 2,
    tva: 2,
    tre: 3,
    fyra: 4,
    fem: 5,
    sex: 6,
    sju: 7,
    åtta: 8,
    atta: 8,
    nio: 9,
    tio: 10
};

const DISCOUNT_TAG_HINTS = new Set([
    'sale',
    'discount',
    'clearance',
    'reduced',
    'on-sale',
    'onsale',
    'deal',
    'promo',
    'rebate'
]);

const NEW_TAG_HINTS = new Set(['new', 'new-arrival', 'new-arrivals', 'newest', 'just-in']);

const DROPPED_TAG_HINTS = new Set(['dropped', 'drop', 'latest-drop', 'latest-drops', 'drops']);

/**
 * @typedef {object} ParsedProductSearch
 * @property {string} raw
 * @property {string} text — remaining free-text after intents/price extraction
 * @property {string[]} tokens — AND-matched against haystack when length > 1
 * @property {{ discount?: boolean, newest?: boolean, dropped?: boolean, featured?: boolean }} intents
 * @property {number|null} priceMin
 * @property {number|null} priceMax
 * @property {string|null} impliedSort
 * @property {string[]} impliedTags
 */

function normalizeNumberWords(input) {
    let s = String(input || '').toLowerCase();
    for (const [word, num] of Object.entries(NUMBER_WORDS)) {
        const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        s = s.replace(re, String(num));
    }
    return s;
}

function parsePriceBounds(text) {
    let t = text;
    let priceMin = null;
    let priceMax = null;

    const under = t.match(/\b(?:under|below|less\s+than|max|upto|up\s+to)\s+(\d+(?:[.,]\d+)?)\b/i);
    if (under) {
        priceMax = Number(String(under[1]).replace(',', '.'));
        t = t.replace(under[0], ' ');
    }

    const over = t.match(/\b(?:over|above|more\s+than|min|from)\s+(\d+(?:[.,]\d+)?)\b/i);
    if (over) {
        priceMin = Number(String(over[1]).replace(',', '.'));
        t = t.replace(over[0], ' ');
    }

    const between = t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:-|to)\s*(\d+(?:[.,]\d+)?)\b/i);
    if (between) {
        priceMin = Number(String(between[1]).replace(',', '.'));
        priceMax = Number(String(between[2]).replace(',', '.'));
        t = t.replace(between[0], ' ');
    }

    const currencyAmount = t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:kr|sek|eur|usd|€|\$)\b/i);
    if (currencyAmount && priceMin == null && priceMax == null) {
        const n = Number(String(currencyAmount[1]).replace(',', '.'));
        priceMin = Math.max(0, n - 1);
        priceMax = n + 1;
        t = t.replace(currencyAmount[0], ' ');
    }

    return {
        text: t.replace(/\s+/g, ' ').trim(),
        priceMin: Number.isFinite(priceMin) ? priceMin : null,
        priceMax: Number.isFinite(priceMax) ? priceMax : null
    };
}

function extractIntents(text) {
    let t = ` ${text} `;
    const intents = {};
    const impliedTags = [];
    let impliedSort = null;

    const rules = [
        {
            key: 'discount',
            re: /\b(on\s+sale|sale|discount|discounted|clearance|reduced\s+price|rebate|promo\s+deal)\b/gi,
            tag: 'sale',
            filter: 'discount'
        },
        {
            key: 'newest',
            re: /\b(newest|new\s+arrivals?|just\s+in)\b/gi,
            sort: 'newest',
            filter: 'newest'
        },
        {
            key: 'new',
            re: /\b(new\s+products?)\b/gi,
            filter: 'newest'
        },
        {
            key: 'dropped',
            re: /\b(drops?|dropped|latest\s+drop)\b/gi,
            tag: 'dropped',
            filter: 'dropped'
        },
        {
            key: 'featured',
            re: /\b(featured|highlighted|staff\s+picks?)\b/gi,
            tag: 'featured',
            filter: 'featured'
        }
    ];

    for (const rule of rules) {
        if (rule.re.test(t)) {
            intents[rule.key] = true;
            if (rule.tag) impliedTags.push(rule.tag);
            if (rule.sort) impliedSort = rule.sort;
            t = t.replace(rule.re, ' ');
        }
        rule.re.lastIndex = 0;
    }

    return {
        text: t.replace(/\s+/g, ' ').trim(),
        intents,
        impliedTags,
        impliedSort
    };
}

/**
 * @param {string} raw
 * @returns {ParsedProductSearch}
 */
function parseProductSearchQuery(raw) {
    const original = String(raw || '').trim();
    if (!original) {
        return {
            raw: '',
            text: '',
            tokens: [],
            intents: {},
            priceMin: null,
            priceMax: null,
            impliedSort: null,
            impliedTags: []
        };
    }

    let working = normalizeNumberWords(original.toLowerCase());
    const pricePart = parsePriceBounds(working);
    working = pricePart.text;

    const intentPart = extractIntents(working);
    const text = intentPart.text;
    const tokens = text.split(/\s+/).filter((tok) => tok.length >= 2 || /^\d+$/.test(tok));

    return {
        raw: original,
        text,
        tokens,
        intents: intentPart.intents,
        priceMin: pricePart.priceMin,
        priceMax: pricePart.priceMax,
        impliedSort: intentPart.impliedSort,
        impliedTags: intentPart.impliedTags
    };
}

function appendHaystack(parts, value) {
    if (value == null || value === '') return;
    if (Array.isArray(value)) {
        value.forEach((v) => appendHaystack(parts, v));
        return;
    }
    parts.push(String(value).toLowerCase());
}

function productHasDiscount(product) {
    const compareAt = product.compareAtPrice ?? product.compare_at_price;
    const price = Number(product.price) || 0;
    if (typeof compareAt === 'number' && !isNaN(compareAt) && compareAt > price && compareAt > 0) {
        return true;
    }
    return featuredProduct.normalizeTags(product.tags).some((t) => {
        const key = t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return DISCOUNT_TAG_HINTS.has(key) || key.includes('sale') || key.includes('discount');
    });
}

function productIsNewest(product) {
    if (product.isNew === true || product.new === true) return true;
    return featuredProduct.normalizeTags(product.tags).some((t) => {
        const key = t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return NEW_TAG_HINTS.has(key);
    });
}

function productIsDropped(product) {
    if (product.dropped === true || product.isDropped === true || product.drop === true) return true;
    const status = String(product.status || product.lifecycle || '').toLowerCase();
    if (status === 'dropped' || status === 'drop') return true;
    return featuredProduct.normalizeTags(product.tags).some((t) => {
        const key = t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return DROPPED_TAG_HINTS.has(key);
    });
}

/**
 * Build searchable text for a product (all catalog dimensions).
 * @param {object} product
 * @param {object} [ctx] — { display price helpers from filter service }
 * @param {object} [facetHelpers] — { colorEntries, sizeEntries, skuTokens }
 */
function buildProductSearchHaystack(product, ctx, facetHelpers = {}) {
    const parts = [];

    appendHaystack(parts, product.name);
    appendHaystack(parts, product.title);
    appendHaystack(parts, product.description);
    appendHaystack(parts, product.shortDescription);
    appendHaystack(parts, product.category);
    appendHaystack(parts, product.subcategory);
    appendHaystack(parts, product.collection);
    appendHaystack(parts, product.section);
    appendHaystack(parts, product.department);
    appendHaystack(parts, product.productType);
    appendHaystack(parts, product.type);
    appendHaystack(parts, product.brand);
    appendHaystack(parts, product.material);
    appendHaystack(parts, product.fit);
    appendHaystack(parts, product.gender);
    appendHaystack(parts, product.room);
    appendHaystack(parts, product.line);
    appendHaystack(parts, product.slug);
    appendHaystack(parts, product.id);
    appendHaystack(parts, product._id);
    appendHaystack(parts, product.sku);
    appendHaystack(parts, product.mpn);
    appendHaystack(parts, product.navigationLabel);
    appendHaystack(parts, product.quickNavLabel);
    appendHaystack(parts, product.storefrontLabel);

    appendHaystack(parts, product.productClasses);
    appendHaystack(parts, product.tags);
    appendHaystack(parts, product.keywords);
    appendHaystack(parts, product.searchKeywords);
    appendHaystack(parts, product.navigation);
    appendHaystack(parts, product.quickNavigation);

    if (Array.isArray(product.navigationLinks)) {
        for (const link of product.navigationLinks) {
            appendHaystack(parts, link?.label);
            appendHaystack(parts, link?.title);
            appendHaystack(parts, link?.path);
        }
    }

    const inv = product.inventory || {};
    appendHaystack(parts, inv.colors);
    appendHaystack(parts, inv.sizes);

    if (facetHelpers.colorEntries) {
        for (const entry of facetHelpers.colorEntries.values()) {
            appendHaystack(parts, entry.id);
            appendHaystack(parts, entry.name);
        }
    }
    if (facetHelpers.sizeEntries) {
        for (const entry of facetHelpers.sizeEntries.values()) {
            appendHaystack(parts, entry.id);
            appendHaystack(parts, entry.name);
        }
    }
    if (facetHelpers.skuTokens) {
        appendHaystack(parts, [...facetHelpers.skuTokens]);
    }

    const displayPrice =
        product.price_including_vat != null
            ? Number(product.price_including_vat)
            : ctx && typeof ctx.computeDisplayPrice === 'function'
              ? ctx.computeDisplayPrice(product, ctx)
              : Number(product.price) || 0;
    appendHaystack(parts, String(Math.round(displayPrice)));
    appendHaystack(parts, String(displayPrice));

    const compareAt =
        product.compare_at_price_including_vat ??
        product.compareAtPrice ??
        product.compare_at_price;
    if (compareAt != null) appendHaystack(parts, String(compareAt));

    return parts.join(' ');
}

function tokensMatchHaystack(tokens, haystack) {
    return tokens.every((tok) => haystack.includes(tok));
}

function textMatchesHaystack(text, haystack) {
    if (!text) return true;
    const q = text.toLowerCase().trim();
    if (!q) return true;
    return haystack.includes(q);
}

/**
 * Advanced match (intents + price bounds + token haystack).
 * SKU-specific logic stays in productFilterService.
 */
function productMatchesParsedSearch(product, parsed, ctx, facetHelpers) {
    if (!parsed || !parsed.raw) return true;

    if (parsed.intents.discount && !productHasDiscount(product)) return false;
    if (parsed.intents.dropped && !productIsDropped(product)) return false;
    if (parsed.intents.featured && !featuredProduct.isFeaturedProduct(product)) return false;

    const hasNewestIntent = parsed.intents.newest || parsed.intents.new;
    const intentOnlyQuery =
        !parsed.text &&
        parsed.tokens.length === 0 &&
        !parsed.intents.discount &&
        !parsed.intents.dropped &&
        !parsed.intents.featured;
    if (hasNewestIntent && !intentOnlyQuery && !productIsNewest(product)) return false;

    if (parsed.impliedTags.length > 0) {
        const tagIds = featuredProduct.normalizeTags(product.tags).map((t) =>
            t.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        );
        if (!parsed.impliedTags.some((t) => tagIds.includes(t))) {
            if (parsed.impliedTags.includes('sale') && !productHasDiscount(product)) return false;
            if (parsed.impliedTags.includes('dropped') && !productIsDropped(product)) return false;
            if (parsed.impliedTags.includes('featured') && !featuredProduct.isFeaturedProduct(product)) {
                return false;
            }
        }
    }

    const displayPrice =
        product.price_including_vat != null
            ? Number(product.price_including_vat)
            : ctx && typeof ctx.computeDisplayPrice === 'function'
              ? ctx.computeDisplayPrice(product, ctx)
              : Number(product.price) || 0;

    if (parsed.priceMin != null && displayPrice < parsed.priceMin) return false;
    if (parsed.priceMax != null && displayPrice > parsed.priceMax) return false;

    const haystack = buildProductSearchHaystack(product, ctx, facetHelpers);
    if (parsed.tokens.length > 1) {
        return tokensMatchHaystack(parsed.tokens, haystack);
    }
    if (parsed.text) {
        return textMatchesHaystack(parsed.text, haystack);
    }

    return (
        Object.keys(parsed.intents).length > 0 ||
        parsed.priceMin != null ||
        parsed.priceMax != null ||
        parsed.impliedSort != null
    );
}

module.exports = {
    parseProductSearchQuery,
    buildProductSearchHaystack,
    productMatchesParsedSearch,
    productHasDiscount,
    productIsNewest,
    productIsDropped,
    normalizeNumberWords
};
