/**
 * Product catalog filter, sort, and facet extraction for storefront listing (/shop, /all-products).
 */

const featuredProduct = require('../utils/featuredProduct');

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
    const sort = query.sort ? String(query.sort).trim().toLowerCase() : null;
    const search = query.search ? String(query.search).trim() : '';

    return {
        categories: categories.map((c) => toFacetId(c)),
        types: types.map((t) => toFacetId(t)),
        sizes: sizes.map((s) => toFacetId(normalizeFilterParamToken(s))),
        colors: colors.map((c) => toFacetId(normalizeFilterParamToken(c))),
        tags: tags.map((t) => toFacetId(t)),
        priceMin: Number.isFinite(priceMin) ? priceMin : null,
        priceMax: Number.isFinite(priceMax) ? priceMax : null,
        sort: sort && SORT_KEYS.has(sort) ? sort : null,
        search
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

function productMatchesFilters(product, filters, ctx) {
    if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const name = (product.name || '').toLowerCase();
        const description = (product.description || '').toLowerCase();
        const productCategory = (product.category || '').toLowerCase();
        const productClasses = Array.isArray(product.productClasses)
            ? product.productClasses.map((c) => String(c).toLowerCase()).join(' ')
            : '';
        if (
            !name.includes(searchLower) &&
            !description.includes(searchLower) &&
            !productCategory.includes(searchLower) &&
            !productClasses.includes(searchLower)
        ) {
            return false;
        }
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

function filterAndSortProducts(products, filters, ctx) {
    const scoped = products.filter(isListableOnStorefront);
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
