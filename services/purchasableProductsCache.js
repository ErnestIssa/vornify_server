/**
 * Products that have ever appeared on a paid/fulfilled order (for write-review picker).
 */

const TTL_MS = Number(process.env.PURCHASABLE_PRODUCTS_CACHE_TTL_MS) || 60_000;

const reviewFilterService = require('./reviewFilterService');
const { collectProductSizeEntries } = require('./productFilterService');

const NOT_DELETED = { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] };

let bucket = { statsByProductId: null, buyerProductIds: null, expiresAt: 0 };

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isPurchasableOrder(order) {
    if (!order || order.deletedAt != null || order.deleted === true) return false;
    const pay = String(order.paymentStatus || '').toLowerCase();
    if (pay === 'succeeded' || pay === 'paid') return true;
    const status = String(order.status || '').toLowerCase();
    return ['delivered', 'completed'].includes(status);
}

function orderItemProductId(item) {
    return item?.productId || item?.id || null;
}

async function loadOrderStats(db) {
    const result = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'orders',
        command: '--read',
        data: NOT_DELETED
    });
    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load orders' };
    }

    let orders = result.data || [];
    if (!Array.isArray(orders)) orders = orders ? [orders] : [];

    const statsByProductId = new Map();
    const buyerProductIds = new Map();

    for (const order of orders) {
        if (!isPurchasableOrder(order)) continue;
        const email = normalizeEmail(order.customer?.email || order.customerEmail);
        const items = Array.isArray(order.items) ? order.items : [];

        for (const item of items) {
            const pid = orderItemProductId(item);
            if (!pid) continue;
            const id = String(pid);

            if (!statsByProductId.has(id)) {
                statsByProductId.set(id, { purchaseCount: 0, buyerEmails: new Set() });
            }
            const row = statsByProductId.get(id);
            row.purchaseCount += Math.max(1, Number(item.quantity) || 1);
            if (email) row.buyerEmails.add(email);

            if (email) {
                if (!buyerProductIds.has(email)) buyerProductIds.set(email, new Set());
                buyerProductIds.get(email).add(id);
            }
        }
    }

    return { ok: true, statsByProductId, buyerProductIds };
}

async function getOrderStats(db, { forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && bucket.statsByProductId && now < bucket.expiresAt) {
        return {
            ok: true,
            statsByProductId: bucket.statsByProductId,
            buyerProductIds: bucket.buyerProductIds,
            fromCache: true
        };
    }
    const loaded = await loadOrderStats(db);
    if (!loaded.ok) return loaded;
    bucket.statsByProductId = loaded.statsByProductId;
    bucket.buyerProductIds = loaded.buyerProductIds;
    bucket.expiresAt = now + TTL_MS;
    return {
        ok: true,
        statsByProductId: loaded.statsByProductId,
        buyerProductIds: loaded.buyerProductIds,
        fromCache: false
    };
}

function extractSizeLabels(product) {
    const map = collectProductSizeEntries(product);
    return [...map.values()].map((f) => f.name || f.id).filter(Boolean);
}

async function loadAllProducts(db) {
    const result = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'products',
        command: '--read',
        data: {}
    });
    if (!result.success) return [];
    let products = result.data || [];
    if (!Array.isArray(products)) products = products ? [products] : [];
    return products;
}

/**
 * @param {object} db
 * @param {{ email?: string, q?: string }} opts
 */
async function listPurchasableProducts(db, { email = '', q = '' } = {}) {
    const statsLoaded = await getOrderStats(db);
    if (!statsLoaded.ok) return statsLoaded;

    const emailNorm = normalizeEmail(email);
    const buyerSet =
        emailNorm && statsLoaded.buyerProductIds.has(emailNorm)
            ? statsLoaded.buyerProductIds.get(emailNorm)
            : new Set();

    const qLower = String(q || '').trim().toLowerCase();
    const products = await loadAllProducts(db);
    const byId = new Map();
    for (const product of products) {
        const id = String(product.id || product._id || '');
        if (!id) continue;
        byId.set(id, product);
    }

    const rows = [];
    for (const [productId, stats] of statsLoaded.statsByProductId.entries()) {
        if (stats.purchaseCount < 1) continue;
        const product = byId.get(productId);
        const name = product?.name || productId;
        if (qLower && !name.toLowerCase().includes(qLower)) continue;

        rows.push({
            id: productId,
            name,
            imageUrl: product ? reviewFilterService.productImageUrl(product) : null,
            slug: product?.slug || null,
            sizes: product ? extractSizeLabels(product) : [],
            purchaseCount: stats.purchaseCount,
            purchasedByEmail: emailNorm ? buyerSet.has(productId) : false,
            _rankName: reviewFilterService.rankProductNameMatch({ name }, qLower)
        });
    }

    rows.sort((a, b) => {
        if (a.purchasedByEmail !== b.purchasedByEmail) return a.purchasedByEmail ? -1 : 1;
        if (b.purchaseCount !== a.purchaseCount) return b.purchaseCount - a.purchaseCount;
        return a.name.localeCompare(b.name);
    });

    return {
        ok: true,
        products: rows.map(({ _rankName, ...row }) => row)
    };
}

function invalidatePurchasableProductsCache() {
    bucket = { statsByProductId: null, buyerProductIds: null, expiresAt: 0 };
}

module.exports = {
    listPurchasableProducts,
    invalidatePurchasableProductsCache,
    isPurchasableOrder,
    getOrderStats
};
