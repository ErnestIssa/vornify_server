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

function toFacetId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function toDisplayLabel(value) {
    const s = String(value || '').trim();
    if (!s) return '';
    return s
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
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
        sizes: sizes.map((s) => toFacetId(s)),
        colors: colors.map((c) => toFacetId(c)),
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

function getProductSizeIds(product) {
    const map = new Map();
    const inv = product.inventory || {};

    const addSize = (sizeLike) => {
        if (!sizeLike) return;
        const rawId = sizeLike.id || sizeLike.sizeId || sizeLike.name;
        if (!rawId) return;
        const id = toFacetId(rawId);
        map.set(id, {
            id,
            name: sizeLike.name || String(rawId)
        });
    };

    if (inv.colorSizeMatrix?.byColor && Array.isArray(inv.colorSizeMatrix.byColor)) {
        for (const row of inv.colorSizeMatrix.byColor) {
            for (const s of row.sizes || []) addSize(s);
        }
    }
    for (const s of inv.sizes || product.sizes || []) addSize(s);

    for (const v of inv.variants || product.variants || []) {
        if (!v.sizeId) continue;
        const def = (inv.sizes || []).find((sz) => sz.id === v.sizeId);
        addSize(def || { id: v.sizeId, name: v.sizeId });
    }

    return new Set(map.keys());
}

function getProductColorIds(product) {
    const map = new Map();
    const inv = product.inventory || {};

    const addColor = (colorLike) => {
        if (!colorLike) return;
        const rawId = colorLike.id || colorLike.colorId || colorLike.name;
        if (!rawId) return;
        const id = toFacetId(rawId);
        map.set(id, {
            id,
            hex: colorLike.hex || '#000000',
            name: colorLike.name || String(rawId)
        });
    };

    if (inv.colorSizeMatrix?.byColor && Array.isArray(inv.colorSizeMatrix.byColor)) {
        for (const row of inv.colorSizeMatrix.byColor) {
            addColor({
                id: row.colorId || row.id,
                name: row.name || row.colorName,
                hex: row.hex
            });
        }
    }
    for (const c of inv.colors || product.colors || []) addColor(c);

    for (const v of inv.variants || product.variants || []) {
        if (!v.colorId) continue;
        const def = (inv.colors || []).find((c) => c.id === v.colorId);
        addColor(def || { id: v.colorId, name: v.colorId, hex: '#000000' });
    }

    return new Set(map.keys());
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

    if (filters.sizes.length > 0) {
        const sizeIds = getProductSizeIds(product);
        if (!filters.sizes.some((s) => sizeIds.has(s))) return false;
    }

    if (filters.colors.length > 0) {
        const colorIds = getProductColorIds(product);
        if (!filters.colors.some((c) => colorIds.has(c))) return false;
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

        const inv = product.inventory || {};
        const addSizeToFacet = (sizeLike) => {
            const rawId = sizeLike?.id || sizeLike?.sizeId || sizeLike?.name;
            if (!rawId) return;
            const id = toFacetId(rawId);
            sizes.set(id, { id, name: sizeLike.name || String(rawId) });
        };
        if (inv.colorSizeMatrix?.byColor) {
            for (const row of inv.colorSizeMatrix.byColor) {
                for (const s of row.sizes || []) addSizeToFacet(s);
            }
        }
        for (const s of inv.sizes || product.sizes || []) addSizeToFacet(s);

        const addColorToFacet = (colorLike) => {
            const rawId = colorLike?.id || colorLike?.colorId || colorLike?.name;
            if (!rawId) return;
            const id = toFacetId(rawId);
            colors.set(id, {
                id,
                name: colorLike.name || String(rawId),
                hex: colorLike.hex || '#000000'
            });
        };
        if (inv.colorSizeMatrix?.byColor) {
            for (const row of inv.colorSizeMatrix.byColor) {
                addColorToFacet({
                    id: row.colorId || row.id,
                    name: row.name || row.colorName,
                    hex: row.hex
                });
            }
        }
        for (const c of inv.colors || product.colors || []) addColorToFacet(c);

        for (const tagId of getProductTagIds(product)) {
            tags.set(tagId, { id: tagId, label: toDisplayLabel(tagId) });
        }

        const price = attachDisplayPrice({ ...product }, ctx);
        if (priceMin == null || price < priceMin) priceMin = price;
        if (priceMax == null || price > priceMax) priceMax = price;
    }

    const sortByLabel = (a, b) => (a.label || a.name || '').localeCompare(b.label || b.name || '');

    return {
        categories: [...categories.values()].sort(sortByLabel),
        types: [...types.values()].sort(sortByLabel),
        sizes: [...sizes.values()].sort(sortByLabel),
        colors: [...colors.values()].sort(sortByLabel),
        tags: [...tags.values()].sort(sortByLabel),
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
    sortProducts,
    extractFacets,
    filterAndSortProducts,
    buildAppliedFiltersResponse,
    toFacetId
};
