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

module.exports = {
    normalizeInventoryColorMedia,
    validateColorMediaPolicy,
    buildLegacyFallbackColorMedia
};
