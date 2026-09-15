/**
 * Product catalog filter, sort, and facet extraction for storefront listing (/shop, /all-products).
 */

const featuredProduct = require('../utils/featuredProduct');
const productSearchService = require('./productSearchService');

const SORT_KEYS = new Set([
    'featured',
    'newest',
    'price-low',
    'price-high',
    'name-asc',
    'name-desc'
]);

const FACET_TAG_EXCLUDE = new Set(['featured']);

function parseCommaList(value) {
    if (value == null || value === '') return [];
    return String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Strip legacy storefront prefix `name:` (old dedupeColorOptions / dedupeSizeOptions). */
function normalizeFilterParamToken(value) {
    const s = String(value || '').trim();
    if (/^name:/i.test(s)) return s.slice(5).trim();
    return s;
}

function toFacetId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeRawId(value) {
    if (value == null || value === '') return '';
    return String(value).trim();
}

/** All facet ids that should match this color/size value (canonical id + display name slug). */
function facetAliasKeys(rawId, displayName) {
    const keys = new Set();
    const id = normalizeRawId(rawId);
    const name = normalizeRawId(displayName);
    if (id) keys.add(toFacetId(id));
    if (name) keys.add(toFacetId(name));
    if (id && name && toFacetId(id) !== toFacetId(name)) {
        keys.add(toFacetId(name));
    }
    return keys;
}

function findColorDef(colors, colorId) {
    const want = normalizeRawId(colorId);
    if (!want) return null;
    return (colors || []).find((c) => c && normalizeRawId(c.id) === want) || null;
}

function findSizeDef(sizes, sizeId) {
    const want = normalizeRawId(sizeId);
    if (!want) return null;
    return (sizes || []).find((s) => s && normalizeRawId(s.id) === want) || null;
}

function toDisplayLabel(value) {
    const s = String(value || '').trim();
    if (!s) return '';
    return s
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * One filter chip per logical size/color across the catalog.
 * Merges by normalized display name (e.g. id "Medium" + id "M" + name "M" → one "m").
 */
function catalogFacetMergeKey(entry) {
    const nameKey = toFacetId(entry.name);
    if (nameKey) return nameKey;
    return toFacetId(entry.id) || entry.id;
}

function mergeSizeFacet(map, entry) {
    const key = catalogFacetMergeKey(entry);
    if (!key) return;
    const name = String(entry.name || entry.id || key).trim();
    if (!map.has(key)) {
        map.set(key, { id: key, name });
        return;
    }
    const cur = map.get(key);
    if (name.length > (cur.name || '').length) cur.name = name;
}

function mergeColorFacet(map, entry) {
    const key = catalogFacetMergeKey(entry);
    if (!key) return;
    const name = String(entry.name || entry.id || key).trim();
    const hex = entry.hex || '#000000';
    if (!map.has(key)) {
        map.set(key, { id: key, name, hex });
        return;
    }
    const cur = map.get(key);
    if (name.length > (cur.name || '').length) cur.name = name;
    if (cur.hex === '#000000' && hex !== '#000000') cur.hex = hex;
}

/** Dedupe facet arrays by id (safety net for client-side merges). */
function dedupeFacetList(items) {
    const map = new Map();
    for (const item of items || []) {
        if (!item || item.id == null || item.id === '') continue;
        const key = toFacetId(item.id);
        if (!map.has(key)) map.set(key, item);
    }
    return [...map.values()];
}

/**
 * @param {object} query — req.query
 */
function parseFilterQuery(query = {}) {
    const categories = parseCommaList(query.category);
    const types = parseCommaList(query.type || query.types);
    const sizes = parseCommaList(query.size || query.sizes);
    const colors = parseCommaList(query.color || query.colors);
    const tags = parseCommaList(query.tag || query.tags);
    const priceMin =
        query.priceMin != null && query.priceMin !== ''
            ? Number(query.priceMin)
            : null;
    const priceMax =
        query.priceMax != null && query.priceMax !== ''
            ? Number(query.priceMax)
            : null;
    let sort = query.sort ? String(query.sort).trim().toLowerCase() : null;
    const skuOnly = query.sku != null && String(query.sku).trim() !== '';
    const searchRaw =
        query.search != null && String(query.search).trim() !== ''
            ? String(query.search).trim()
            : skuOnly
              ? String(query.sku).trim()
              : query.q != null && String(query.q).trim() !== ''
                ? String(query.q).trim()
                : query.query != null && String(query.query).trim() !== ''
                  ? String(query.query).trim()
                  : '';

    const searchParsed = searchRaw ? productSearchService.parseProductSearchQuery(searchRaw) : null;
    if (searchParsed) {
        if (!Number.isFinite(priceMin) && searchParsed.priceMin != null) {
            priceMin = searchParsed.priceMin;
        }
        if (!Number.isFinite(priceMax) && searchParsed.priceMax != null) {
            priceMax = searchParsed.priceMax;
        }
        if (!sort && searchParsed.impliedSort && SORT_KEYS.has(searchParsed.impliedSort)) {
            sort = searchParsed.impliedSort;
        }
    }

    return {
        categories: categories.map((c) => toFacetId(c)),
        types: types.map((t) => toFacetId(t)),
        sizes: sizes.map((s) => toFacetId(normalizeFilterParamToken(s))),
        colors: colors.map((c) => toFacetId(normalizeFilterParamToken(c))),
        tags: tags.map((t) => toFacetId(t)),
        priceMin: Number.isFinite(priceMin) ? priceMin : null,
        priceMax: Number.isFinite(priceMax) ? priceMax : null,
        sort: sort && SORT_KEYS.has(sort) ? sort : null,
        search: searchRaw,
        searchParsed,
        /** When true, match only SKU/MPN fields (from `?sku=`). */
        searchSkuOnly: skuOnly && !query.search
    };
}

function isPublished(product) {
    return product && product.published === true;
}

/** Published + active + has sellable stock or merchant allows sold-out listing */
function isListableOnStorefront(product) {
    if (!isPublished(product)) return false;
    if (product.active === false) return false;

    const inv = product.inventory;
    if (inv?.storefront?.showListingWhenFullySoldOut === true) return true;

    const variants = inv?.variants || product.variants;
    if (Array.isArray(variants) && variants.length > 0) {
        return variants.some((v) => {
            const qty = v.quantity !== undefined ? v.quantity : v.stock;
            const n = Number(qty);
            return (Number.isFinite(n) ? n : 0) > 0 && v.available !== false;
        });
    }

    return true;
}

function computeDisplayPrice(product, { vatRate = 0, sekToDisplayRate = 1, displayCurrency = 'SEK' } = {}) {
    const basePrice = product.price || 0;
    const priceInclVatSEK = Math.round(basePrice * (1 + vatRate) * 100) / 100;
    if (!displayCurrency || displayCurrency === 'SEK') return priceInclVatSEK;
    return Math.round(priceInclVatSEK * sekToDisplayRate * 100) / 100;
}

function attachDisplayPrice(product, ctx) {
    const price = computeDisplayPrice(product, ctx);
    product.price_including_vat = price;
    return price;
}

function getProductCategoryId(product) {
    return toFacetId(product.category || '');
}

function getProductTypeIds(product) {
    const ids = new Set();
    const add = (val) => {
        if (val == null || val === '') return;
        if (Array.isArray(val)) {
            val.forEach((v) => add(v));
            return;
        }
        ids.add(toFacetId(val));
    };
    add(product.subcategory);
    add(product.productType);
    add(product.type);
    add(product.productClasses);
    return ids;
}

/**
 * Canonical facet entries for sizes on a product.
 * @returns {Map<string, { id: string, name: string, matchKeys: Set<string> }>}
 */
function collectProductSizeEntries(product) {
    const map = new Map();
    const inv = product.inventory || {};
    const sizeCatalog = inv.sizes || product.sizes || [];

    const register = (rawId, name) => {
        const idNorm = normalizeRawId(rawId);
        if (!idNorm) return;
        const canonical = toFacetId(idNorm);
        const displayName = name || idNorm;
        const matchKeys = facetAliasKeys(idNorm, displayName);
        const existing = map.get(canonical);
        if (existing) {
            matchKeys.forEach((k) => existing.matchKeys.add(k));
            if (!existing.name && displayName) existing.name = String(displayName);
        } else {
            map.set(canonical, {
                id: canonical,
                name: String(displayName),
                matchKeys
            });
        }
    };

    if (Array.isArray(inv.colorSizeMatrix?.byColor)) {
        for (const row of inv.colorSizeMatrix.byColor) {
            for (const s of row.sizes || []) {
                if (s && s.hasVariant === false) continue;
                register(s.sizeId || s.id, s.name);
            }
        }
    }
    for (const v of inv.variants || product.variants || []) {
        if (!v || !v.sizeId) continue;
        const def = findSizeDef(sizeCatalog, v.sizeId);
        register(v.sizeId, def ? def.name : v.sizeId);
    }

    return map;
}

/**
 * Canonical facet entries for colors on a product.
 * @returns {Map<string, { id: string, name: string, hex: string, matchKeys: Set<string> }>}
 */
function collectProductColorEntries(product) {
    const map = new Map();
    const inv = product.inventory || {};
    const colorCatalog = inv.colors || product.colors || [];

    const register = (rawId, name, hex) => {
        const idNorm = normalizeRawId(rawId);
        if (!idNorm) return;
        const canonical = toFacetId(idNorm);
        const displayName = name || idNorm;
        const matchKeys = facetAliasKeys(idNorm, displayName);
        const existing = map.get(canonical);
        if (existing) {
            matchKeys.forEach((k) => existing.matchKeys.add(k));
            if (hex && existing.hex === '#000000') existing.hex = hex;
            if (!existing.name && displayName) existing.name = String(displayName);
        } else {
            map.set(canonical, {
                id: canonical,
                name: String(displayName),
                hex: hex || '#000000',
                matchKeys
            });
        }
    };

    if (Array.isArray(inv.colorSizeMatrix?.byColor)) {
        for (const row of inv.colorSizeMatrix.byColor) {
            register(row.id || row.colorId, row.name || row.colorName, row.hex);
        }
    }
    for (const c of colorCatalog) {
        register(c.id || c.colorId, c.name, c.hex);
    }
    for (const v of inv.variants || product.variants || []) {
        if (!v || !v.colorId) continue;
        const def = findColorDef(colorCatalog, v.colorId);
        register(v.colorId, def ? def.name : v.colorId, def ? def.hex : '#000000');
    }

    return map;
}

function getProductSizeMatchKeys(product) {
    const keys = new Set();
    for (const entry of collectProductSizeEntries(product).values()) {
        entry.matchKeys.forEach((k) => keys.add(k));
    }
    return keys;
}

function getProductColorMatchKeys(product) {
    const keys = new Set();
    for (const entry of collectProductColorEntries(product).values()) {
        entry.matchKeys.forEach((k) => keys.add(k));
    }
    return keys;
}

function productMatchesSizeFilter(product, filterSizeIds) {
    const keys = getProductSizeMatchKeys(product);
    return filterSizeIds.some((s) => keys.has(s));
}

function productMatchesColorFilter(product, filterColorIds) {
    const keys = getProductColorMatchKeys(product);
    return filterColorIds.some((c) => keys.has(c));
}

function getProductTagIds(product) {
    return featuredProduct
        .normalizeTags(product.tags)
        .map((t) => toFacetId(t))
        .filter((t) => t && !FACET_TAG_EXCLUDE.has(t));
}

/** All SKUs / MPNs on a product (root + every variant + matrix rows). Lowercase for matching. */
function collectProductSkuTokens(product) {
    const tokens = new Set();
    const add = (value) => {
        const s = String(value || '').trim();
        if (s) tokens.add(s.toLowerCase());
    };

    add(product.sku);
    add(product.mpn);
    add(product.gtin);
    add(product.barcode);

    const inv = product.inventory || {};
    for (const v of inv.variants || product.variants || []) {
        add(v.sku);
        add(v.mpn);
        add(v.barcode);
    }
    if (Array.isArray(inv.colorSizeMatrix?.byColor)) {
        for (const row of inv.colorSizeMatrix.byColor) {
            for (const s of row.sizes || []) {
                add(s.sku);
            }
        }
    }

    return tokens;
}

/** Raw SKU strings (original casing) for annotations. */
function collectProductSkuValues(product) {
    const values = [];
    const seen = new Set();
    const add = (value) => {
        const s = String(value || '').trim();
        if (!s) return;
        const key = s.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        values.push(s);
    };
    add(product.sku);
    add(product.mpn);
    const inv = product.inventory || {};
    for (const v of inv.variants || product.variants || []) {
        add(v.sku);
        add(v.mpn);
    }
    if (Array.isArray(inv.colorSizeMatrix?.byColor)) {
        for (const row of inv.colorSizeMatrix.byColor) {
            for (const s of row.sizes || []) add(s.sku);
        }
    }
    return values;
}

/** Style / “product room” prefix from variant SKU (PM-HOODIE-BLK-M → pm-hoodie). */
function deriveSkuStylePrefix(sku) {
    const parts = String(sku || '')
        .trim()
        .toLowerCase()
        .split(/[-_]/)
        .filter(Boolean);
    if (parts.length >= 3) return parts.slice(0, -2).join('-');
    if (parts.length === 2) return parts[0];
    return parts.join('-');
}

function looksLikeSkuQuery(q) {
    return /^[a-z0-9][a-z0-9_-]*$/i.test(q) && q.length >= 3 && (q.includes('-') || q.includes('_'));
}

function productSkuStylePrefixes(product) {
    const prefixes = new Set();
    for (const sku of collectProductSkuTokens(product)) {
        const p = deriveSkuStylePrefix(sku);
        if (p) prefixes.add(p);
    }
    return prefixes;
}

function productMatchesSkuStyleFamily(product, queryLower) {
    if (!looksLikeSkuQuery(queryLower)) return false;
    const queryPrefix = deriveSkuStylePrefix(queryLower);
    if (!queryPrefix) return false;

    for (const prefix of productSkuStylePrefixes(product)) {
        if (prefix === queryPrefix) return true;
    }
    for (const sku of collectProductSkuTokens(product)) {
        if (sku === queryPrefix || sku.startsWith(`${queryPrefix}-`) || sku.startsWith(`${queryPrefix}_`)) {
            return true;
        }
    }
    return false;
}

/**
 * Text + SKU search for storefront (search modal, /shop, /all-products).
 * SKU hit = whole parent product (all colors/sizes), never a single variant row.
 */
function productMatchesSearch(product, searchTerm, options = {}) {
    const q = String(searchTerm || '').trim().toLowerCase();
    if (!q) return true;

    const skuTokens = collectProductSkuTokens(product);
    const skuHaystack = [...skuTokens].join(' ');

    if (options.searchSkuOnly) {
        if (skuTokens.has(q)) return true;
        if (skuHaystack.includes(q)) return true;
        return productMatchesSkuStyleFamily(product, q);
    }

    if (skuTokens.has(q)) return true;
    if (skuHaystack.includes(q)) return true;
    if (productMatchesSkuStyleFamily(product, q)) return true;

    const parsed =
        options.searchParsed || productSearchService.parseProductSearchQuery(searchTerm);
    const facetHelpers = {
        colorEntries: collectProductColorEntries(product),
        sizeEntries: collectProductSizeEntries(product),
        skuTokens
    };
    return productSearchService.productMatchesParsedSearch(
        product,
        parsed,
        options.ctx || {},
        facetHelpers
    );
}

/**
 * Storefront hint when `search` is active — API always returns the full product document.
 */
function buildSearchMatchAnnotation(product, searchTerm) {
    const q = String(searchTerm || '').trim();
    if (!q) return null;

    const qLower = q.toLowerCase();
    const matchedSkus = collectProductSkuValues(product).filter((sku) => {
        const s = sku.toLowerCase();
        return s === qLower || s.includes(qLower);
    });

    const parsed = productSearchService.parseProductSearchQuery(q);

    function intentSearchHint() {
        if (parsed.intents.discount) return 'Showing sale and discounted items';
        if (parsed.intents.dropped) return 'Showing dropped / latest drop items';
        if (parsed.intents.featured) return 'Showing featured items';
        if (parsed.intents.newest || parsed.intents.new) return 'Showing newest arrivals';
        if (parsed.priceMin != null || parsed.priceMax != null) return 'Filtered by price in your search';
        return 'Full product — all variants. Optional PDP pre-select from matchedSkus only.';
    }

    if (matchedSkus.length > 0) {
        return {
            scope: 'fullProduct',
            matchedBy: 'sku',
            matchedSkus,
            skuStylePrefix: deriveSkuStylePrefix(q),
            includeAllVariants: true,
            intents: parsed.intents,
            hint: 'Show the full product (all colors/sizes). Do not narrow the card or PDP to matchedSkus only.'
        };
    }

    if (productMatchesSearch(product, q, { searchSkuOnly: false, searchParsed: parsed })) {
        const matchedBy =
            Object.keys(parsed.intents).length > 0
                ? 'intent'
                : parsed.priceMin != null || parsed.priceMax != null
                  ? 'price'
                  : 'text';
        return {
            scope: 'fullProduct',
            matchedBy,
            matchedSkus: [],
            includeAllVariants: true,
            intents: parsed.intents,
            priceHint:
                parsed.priceMin != null || parsed.priceMax != null
                    ? { min: parsed.priceMin, max: parsed.priceMax }
                    : undefined,
            hint: intentSearchHint()
        };
    }

    return null;
}

function productMatchesFilters(product, filters, ctx) {
    if (
        filters.search &&
        !productMatchesSearch(product, filters.search, {
            searchSkuOnly: filters.searchSkuOnly,
            searchParsed: filters.searchParsed,
            ctx
        })
    ) {
        return false;
    }

    if (filters.categories.length > 0) {
        const catId = getProductCategoryId(product);
        if (!filters.categories.some((c) => c === catId)) return false;
    }

    if (filters.types.length > 0) {
        const typeIds = getProductTypeIds(product);
        if (!filters.types.some((t) => typeIds.has(t))) return false;
    }

    if (filters.sizes.length > 0 && !productMatchesSizeFilter(product, filters.sizes)) {
        return false;
    }

    if (filters.colors.length > 0 && !productMatchesColorFilter(product, filters.colors)) {
        return false;
    }

    if (filters.tags.length > 0) {
        const tagIds = getProductTagIds(product);
        if (!filters.tags.some((t) => tagIds.includes(t))) return false;
    }

    if (filters.priceMin != null || filters.priceMax != null) {
        const price =
            product.price_including_vat != null
                ? Number(product.price_including_vat)
                : computeDisplayPrice(product, ctx);
        if (filters.priceMin != null && price < filters.priceMin) return false;
        if (filters.priceMax != null && price > filters.priceMax) return false;
    }

    return true;
}

function sortProducts(products, sortKey) {
    const list = [...products];
    const key = sortKey && SORT_KEYS.has(sortKey) ? sortKey : 'featured';

    const byName = (a, b, dir) => {
        const an = (a.name || '').toLowerCase();
        const bn = (b.name || '').toLowerCase();
        if (an < bn) return dir === 'asc' ? -1 : 1;
        if (an > bn) return dir === 'asc' ? 1 : -1;
        return 0;
    };

    const byDate = (a, b) => {
        const at = new Date(a.createdAt || a.created_at || 0).getTime();
        const bt = new Date(b.createdAt || b.created_at || 0).getTime();
        return bt - at;
    };

    const byPrice = (a, b, dir) => {
        const ap = Number(a.price_including_vat) || 0;
        const bp = Number(b.price_including_vat) || 0;
        return dir === 'low' ? ap - bp : bp - ap;
    };

    switch (key) {
        case 'newest':
            list.sort((a, b) => {
                const aNew = a.isNew === true || a.new === true ? 1 : 0;
                const bNew = b.isNew === true || b.new === true ? 1 : 0;
                if (bNew !== aNew) return bNew - aNew;
                return byDate(a, b);
            });
            break;
        case 'price-low':
            list.sort((a, b) => byPrice(a, b, 'low'));
            break;
        case 'price-high':
            list.sort((a, b) => byPrice(a, b, 'high'));
            break;
        case 'name-asc':
            list.sort((a, b) => byName(a, b, 'asc'));
            break;
        case 'name-desc':
            list.sort((a, b) => byName(a, b, 'desc'));
            break;
        case 'featured':
        default:
            list.sort((a, b) => {
                const ap = typeof a.priority === 'number' ? a.priority : 0;
                const bp = typeof b.priority === 'number' ? b.priority : 0;
                if (bp !== ap) return bp - ap;
                const aNew = a.isNew === true || a.new === true ? 1 : 0;
                const bNew = b.isNew === true || b.new === true ? 1 : 0;
                if (bNew !== aNew) return bNew - aNew;
                return byDate(a, b);
            });
            break;
    }
    return list;
}

function extractFacets(products, ctx) {
    const categories = new Map();
    const types = new Map();
    const sizes = new Map();
    const colors = new Map();
    const tags = new Map();
    let priceMin = null;
    let priceMax = null;

    for (const product of products) {
        if (!isListableOnStorefront(product)) continue;

        const catId = getProductCategoryId(product);
        if (catId) {
            categories.set(catId, {
                id: catId,
                label: toDisplayLabel(product.category)
            });
        }

        for (const typeId of getProductTypeIds(product)) {
            if (!types.has(typeId)) {
                const raw =
                    product.subcategory ||
                    product.productType ||
                    product.type ||
                    typeId;
                types.set(typeId, { id: typeId, label: toDisplayLabel(raw) });
            }
        }

        for (const entry of collectProductSizeEntries(product).values()) {
            mergeSizeFacet(sizes, entry);
        }
        for (const entry of collectProductColorEntries(product).values()) {
            mergeColorFacet(colors, entry);
        }

        for (const tagId of getProductTagIds(product)) {
            tags.set(tagId, { id: tagId, label: toDisplayLabel(tagId) });
        }

        const price = attachDisplayPrice({ ...product }, ctx);
        if (priceMin == null || price < priceMin) priceMin = price;
        if (priceMax == null || price > priceMax) priceMax = price;
    }

    const sortByLabel = (a, b) => (a.label || a.name || '').localeCompare(b.label || b.name || '');

    return {
        categories: dedupeFacetList([...categories.values()]).sort(sortByLabel),
        types: dedupeFacetList([...types.values()]).sort(sortByLabel),
        sizes: dedupeFacetList([...sizes.values()]).sort(sortByLabel),
        colors: dedupeFacetList([...colors.values()]).sort(sortByLabel),
        tags: dedupeFacetList([...tags.values()]).sort(sortByLabel),
        priceRange: {
            min: priceMin != null ? Math.floor(priceMin) : 0,
            max: priceMax != null ? Math.ceil(priceMax) : 0,
            currency: ctx.displayCurrency || 'SEK'
        }
    };
}

function filterAndSortProducts(products, filters, ctx, options = {}) {
    const list = Array.isArray(products) ? products : [];
    const scoped = options.includeUnlisted
        ? list.filter((p) => p && p.active !== false)
        : list.filter(isListableOnStorefront);
    const withPrices = scoped.map((p) => {
        const copy = p;
        attachDisplayPrice(copy, ctx);
        return copy;
    });
    const filtered = withPrices.filter((p) => productMatchesFilters(p, filters, ctx));
    const sorted = sortProducts(filtered, filters.sort);
    return sorted;
}

function buildAppliedFiltersResponse(filters) {
    const out = {};
    if (filters.categories.length) out.category = filters.categories.join(',');
    if (filters.types.length) out.type = filters.types.join(',');
    if (filters.sizes.length) out.size = filters.sizes.join(',');
    if (filters.colors.length) out.color = filters.colors.join(',');
    if (filters.tags.length) out.tag = filters.tags.join(',');
    if (filters.priceMin != null) out.priceMin = filters.priceMin;
    if (filters.priceMax != null) out.priceMax = filters.priceMax;
    if (filters.sort) out.sort = filters.sort;
    if (filters.search) out.search = filters.search;
    if (filters.searchSkuOnly) out.sku = filters.search;
    if (filters.searchParsed?.impliedSort && !out.sort) out.sort = filters.searchParsed.impliedSort;
    return out;
}

module.exports = {
    SORT_KEYS,
    parseCommaList,
    parseFilterQuery,
    isListableOnStorefront,
    computeDisplayPrice,
    attachDisplayPrice,
    productMatchesFilters,
    productMatchesColorFilter,
    productMatchesSizeFilter,
    productMatchesSearch,
    buildSearchMatchAnnotation,
    collectProductSkuTokens,
    collectProductSkuValues,
    deriveSkuStylePrefix,
    collectProductColorEntries,
    collectProductSizeEntries,
    catalogFacetMergeKey,
    dedupeFacetList,
    sortProducts,
    extractFacets,
    filterAndSortProducts,
    buildAppliedFiltersResponse,
    toFacetId
};
