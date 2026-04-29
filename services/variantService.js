/**
 * VariantService
 * Backend source-of-truth utilities for premium variant UX.
 *
 * Goal: never make the frontend guess which images belong to which color.
 * Canonical mapping: inventory.colorMedia[] where each entry binds colorId -> media[].
 */

function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

function toStringId(v) {
    if (!isNonEmptyString(v)) return '';
    return v.trim();
}

function normalizeStringArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(isNonEmptyString).map((s) => s.trim());
}

function normalizeCloudinaryPairs(media, imagePublicIds) {
    const m = normalizeStringArray(media);
    const p = Array.isArray(imagePublicIds) ? imagePublicIds.map((x) => (typeof x === 'string' ? x : '')).slice(0, m.length) : [];
    while (p.length < m.length) p.push('');
    return { media: m, imagePublicIds: p };
}

/**
 * Normalize inventory.colorMedia.
 * Supports tolerant input shapes so admin can evolve:
 * - { colorId, media, imagePublicIds, sortOrder, active }
 * - { colorId, images } (alias for media)
 */
function normalizeInventoryColorMedia(inventory) {
    if (!inventory || typeof inventory !== 'object') return inventory;

    const colors = Array.isArray(inventory.colors) ? inventory.colors : [];
    const colorIdSet = new Set(colors.map((c) => toStringId(c && c.id)).filter(Boolean));

    const raw = Array.isArray(inventory.colorMedia) ? inventory.colorMedia : [];
    const normalized = raw
        .map((entry, index) => {
            const e = entry && typeof entry === 'object' ? entry : {};
            const colorId = toStringId(e.colorId);
            const { media, imagePublicIds } = normalizeCloudinaryPairs(e.media || e.images, e.imagePublicIds);
            const sortOrder = typeof e.sortOrder === 'number' && !Number.isNaN(e.sortOrder) ? e.sortOrder : index;
            const active = e.active !== undefined ? !!e.active : true;
            return { colorId, media, imagePublicIds, sortOrder, active };
        })
        // drop invalid
        .filter((e) => e.colorId && e.media.length > 0);

    // De-dupe by colorId; keep the highest sortOrder last so it wins
    const byColorId = new Map();
    for (const e of normalized.sort((a, b) => a.sortOrder - b.sortOrder)) {
        byColorId.set(e.colorId, e);
    }

    const deduped = Array.from(byColorId.values())
        // keep only colorIds that exist if colors array exists
        .filter((e) => (colorIdSet.size ? colorIdSet.has(e.colorId) : true))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    return {
        ...inventory,
        colorMedia: deduped
    };
}

/**
 * Validate that each selectable color has its own images.
 * Policy:
 * - If product is published OR enforceOnDraft=true: every available color must have a colorMedia entry with >=1 image.
 * - Otherwise (draft), allow missing (storefront may fallback to product.media).
 */
function validateColorMediaPolicy({ inventory, published, enforceOnDraft = false }) {
    const inv = inventory && typeof inventory === 'object' ? inventory : null;
    if (!inv) return { valid: true };

    const colors = Array.isArray(inv.colors) ? inv.colors : [];
    if (!colors.length) return { valid: true };

    const mustEnforce = !!published || enforceOnDraft === true;
    if (!mustEnforce) return { valid: true };

    const cm = Array.isArray(inv.colorMedia) ? inv.colorMedia : [];
    const hasByColor = new Map(cm.map((e) => [toStringId(e.colorId), Array.isArray(e.media) ? e.media.length : 0]));

    const missing = colors
        .filter((c) => c && c.available !== false)
        .map((c) => ({ id: toStringId(c.id), name: toStringId(c.name) }))
        .filter((c) => c.id)
        .filter((c) => (hasByColor.get(c.id) || 0) <= 0);

    if (missing.length) {
        return {
            valid: false,
            code: 'COLOR_MEDIA_REQUIRED',
            error: `Each color must have its own images. Missing images for: ${missing.map((m) => m.name || m.id).join(', ')}`,
            missingColorIds: missing.map((m) => m.id)
        };
    }

    return { valid: true };
}

/**
 * Optional helper for legacy products: build a minimal colorMedia mapping that points all colors to global media[].
 * This preserves behavior while admin backfills real per-color media.
 */
function buildLegacyFallbackColorMedia(inventory, globalMedia, globalPublicIds) {
    if (!inventory || typeof inventory !== 'object') return inventory;
    const colors = Array.isArray(inventory.colors) ? inventory.colors : [];
    if (!colors.length) return inventory;

    const { media, imagePublicIds } = normalizeCloudinaryPairs(globalMedia, globalPublicIds);
    if (!media.length) return inventory;

    const colorMedia = colors
        .map((c, idx) => ({
            colorId: toStringId(c.id),
            media,
            imagePublicIds,
            sortOrder: typeof c.sortOrder === 'number' ? c.sortOrder : idx,
            active: true,
            legacyFallback: true
        }))
        .filter((e) => e.colorId);

    return { ...inventory, colorMedia };
}

/**
 * Per-color size × stock matrix for admin + storefront convenience.
 *
 * Source of truth remains inventory.variants[]: one row per (colorId, sizeId) with quantity, sku, etc.
 * This view aggregates duplicates (same color+size) by summing quantity; last row wins for sku/price if duplicated.
 */
function buildColorSizeMatrix(inventory) {
    if (!inventory || typeof inventory !== 'object') return null;

    const colors = Array.isArray(inventory.colors) ? inventory.colors : [];
    const sizeCatalog = Array.isArray(inventory.sizes) ? inventory.sizes : [];
    const variants = Array.isArray(inventory.variants) ? inventory.variants : [];
    if (!colors.length || !sizeCatalog.length) return null;

    const sizeById = new Map(
        sizeCatalog
            .filter((s) => s && s.id)
            .map((s) => [String(s.id), s])
    );

    const colorMeta = (colorId) => {
        const c = colors.find((x) => x && x.id === colorId);
        return {
            id: colorId,
            name: c && c.name ? String(c.name) : '',
            hex: c && c.hex ? String(c.hex) : '#000000',
            colorAvailable: c ? c.available !== false : true
        };
    };

    const pairMap = new Map();
    for (const v of variants) {
        if (!v || typeof v !== 'object') continue;
        const colorId = toStringId(v.colorId);
        const sizeId = toStringId(v.sizeId);
        if (!colorId || !sizeId) continue;

        const key = `${colorId}::${sizeId}`;
        const rawQty = v.quantity !== undefined ? Number(v.quantity) : v.stock !== undefined ? Number(v.stock) : 0;
        const safeQty = Number.isFinite(rawQty) ? Math.max(0, Math.floor(rawQty)) : 0;
        const rowAvailable = v.available !== false;
        const sObj = sizeById.get(sizeId);

        const base = {
            sizeId,
            sizeName: (sObj && sObj.name) || sizeId,
            sizeDescription: (sObj && sObj.description) || '',
            sizeSortOrder: typeof (sObj && sObj.sortOrder) === 'number' ? sObj.sortOrder : 0,
            sizeOptionAvailable: sObj ? sObj.available !== false : true,
            quantity: 0,
            availableForSale: rowAvailable,
            sku: toStringId(v.sku) || null,
            price: v.price,
            variantId: v.id != null ? v.id : null
        };

        if (!pairMap.has(key)) {
            pairMap.set(key, { ...base, quantity: safeQty });
        } else {
            const cur = pairMap.get(key);
            cur.quantity += safeQty;
            cur.availableForSale = cur.availableForSale && rowAvailable;
            if (toStringId(v.sku)) cur.sku = toStringId(v.sku);
            if (v.price !== undefined) cur.price = v.price;
            if (v.id != null) cur.variantId = v.id;
        }
    }

    const byColor = colors
        .filter((c) => c && c.id)
        .map((c) => toStringId(c.id))
        .map((colorId) => {
            const meta = colorMeta(colorId);
            const sizesForColor = sizeCatalog
                .filter((s) => s && s.id)
                .map((s) => toStringId(s.id))
                .map((sizeId) => {
                    const key = `${colorId}::${sizeId}`;
                    const merged = pairMap.get(key);
                    const sRow = sizeById.get(sizeId) || {};
                    const hasVariantRow = !!merged;
                    const q = merged ? merged.quantity : 0;
                    const canSell =
                        meta.colorAvailable &&
                        sRow.available !== false &&
                        (merged ? merged.availableForSale : true) &&
                        q > 0;
                    let storefrontBadge = 'not_offered';
                    if (hasVariantRow && merged) {
                        if (!merged.availableForSale) {
                            storefrontBadge = q > 0 ? 'merchant_paused' : 'merchant_blocked';
                        } else if (q > 0) {
                            storefrontBadge = 'in_stock';
                        } else {
                            storefrontBadge = 'out_of_stock';
                        }
                    }
                    return {
                        sizeId,
                        name: sRow.name || sizeId,
                        description: sRow.description || '',
                        sortOrder: typeof sRow.sortOrder === 'number' ? sRow.sortOrder : 0,
                        hasVariant: hasVariantRow,
                        quantity: q,
                        inStock: q > 0,
                        canAddToCart: canSell,
                        storefrontBadge,
                        sku: merged ? merged.sku : null,
                        price: merged && merged.price !== undefined ? merged.price : undefined
                    };
                });

            const offeredSizes = sizesForColor.filter((r) => r.hasVariant);
            const inStockSizes = offeredSizes.filter((r) => r.inStock);
            const totalUnits = offeredSizes.reduce((acc, r) => acc + (r.quantity || 0), 0);

            return {
                ...meta,
                sizes: sizesForColor,
                offeredSizeCount: offeredSizes.length,
                inStockSizeCount: inStockSizes.length,
                totalUnits,
                hasAnyInventory: totalUnits > 0
            };
        });

    const lookup = {};
    for (const c of byColor) {
        const m = {};
        for (const s of c.sizes) {
            m[s.sizeId] = {
                quantity: s.quantity,
                inStock: s.inStock,
                canAddToCart: s.canAddToCart,
                hasVariant: s.hasVariant,
                storefrontBadge: s.storefrontBadge,
                sku: s.sku
            };
        }
        lookup[c.id] = m;
    }

    return {
        version: 2,
        storefront: inventory.storefront && typeof inventory.storefront === 'object'
            ? { showListingWhenFullySoldOut: !!(inventory.storefront.showListingWhenFullySoldOut === true) }
            : { showListingWhenFullySoldOut: false },
        byColor,
        lookupByColorId: lookup
    };
}

module.exports = {
    normalizeInventoryColorMedia,
    validateColorMediaPolicy,
    buildLegacyFallbackColorMedia,
    buildColorSizeMatrix
};
