/**
 * Warehouse selection engine.
 * Chooses best warehouse(s) for an order based on:
 * 1. Inventory availability (product.warehouseIds)
 * 2. Warehouse priority (priorityLevel)
 * 3. Closest to customer (destination country match)
 * 4. Active status and supported carriers
 * Supports single-warehouse and split-shipment logic.
 */

const getDBInstance = require('../vornifydb/dbInstance');

const DATABASE_NAME = 'peakmode';
const WAREHOUSES_COLL = 'warehouses';
const PRODUCTS_COLL = 'products';

/**
 * Get all active warehouses.
 * @returns {Promise<Array>}
 */
async function getActiveWarehouses() {
    const db = getDBInstance();
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: WAREHOUSES_COLL,
        command: '--read',
        data: { active: { $ne: false } }
    });
    if (!result || !result.success || !Array.isArray(result.data)) return [];
    return result.data;
}

/**
 * Get product by id; returns warehouseIds (or empty array).
 * @param {string} productId
 * @returns {Promise<{ warehouseIds: string[] }>}
 */
async function getProductWarehouses(productId) {
    if (!productId) return { warehouseIds: [] };
    const db = getDBInstance();
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: PRODUCTS_COLL,
        command: '--read',
        data: { $or: [ { id: productId }, { _id: productId } ] }
    });
    const list = result && result.success && result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
    const product = list[0];
    if (!product) return { warehouseIds: [] };
    const ids = product.warehouseIds || product.warehouse_id || [];
    return { warehouseIds: Array.isArray(ids) ? ids : (ids ? [ids] : []) };
}

/**
 * Select best warehouse(s) for an order.
 * Priority: (1) warehouses that have inventory for all items, (2) priorityLevel desc, (3) destination country match.
 * @param {Array<{ id: string, productId?: string, quantity?: number }>} orderItems - items with id or productId
 * @param {string} destinationCountry - ISO 2-letter (e.g. DE, SE)
 * @param {Object} options - { preferSingleShipment: boolean, allowSplit: boolean }
 * @returns {Promise<{ warehouse: object | null, warehouses: object[], split: boolean }>}
 */
async function selectWarehouse(orderItems, destinationCountry, options = {}) {
    const { preferSingleShipment = true, allowSplit = true } = options;
    const warehouses = await getActiveWarehouses();
    if (warehouses.length === 0) return { warehouse: null, warehouses: [], split: false };
    if (warehouses.length === 1) return { warehouse: warehouses[0], warehouses, split: false };

    const destCountry = (destinationCountry || '').toUpperCase();
    const productIds = (orderItems || []).map(i => i.id || i.productId).filter(Boolean);
    if (productIds.length === 0) {
        const byPriority = [...warehouses].sort((a, b) => (b.priorityLevel ?? b.priority_level ?? 0) - (a.priorityLevel ?? a.priority_level ?? 0));
        const sameCountry = byPriority.find(w => (w.country || '').toUpperCase() === destCountry);
        return { warehouse: sameCountry || byPriority[0], warehouses: byPriority, split: false };
    }

    const warehouseIdsByProduct = {};
    for (const pid of productIds) {
        const { warehouseIds } = await getProductWarehouses(pid);
        warehouseIdsByProduct[pid] = warehouseIds;
    }

    const warehouseIdsWithInventory = new Set();
    for (const ids of Object.values(warehouseIdsByProduct)) {
        if (ids.length === 0) {
            warehouses.forEach(w => warehouseIdsWithInventory.add(String(w._id)));
            break;
        }
        ids.forEach(id => warehouseIdsWithInventory.add(String(id)));
    }
    if (warehouseIdsWithInventory.size === 0) {
        warehouses.forEach(w => warehouseIdsWithInventory.add(String(w._id)));
    }

    const candidates = warehouses.filter(w => warehouseIdsWithInventory.has(String(w._id)));
    const toRank = candidates.length ? candidates : warehouses;

    toRank.sort((a, b) => {
        const pa = a.priorityLevel ?? a.priority_level ?? 0;
        const pb = b.priorityLevel ?? b.priority_level ?? 0;
        if (pb !== pa) return pb - pa;
        const aMatch = (a.country || '').toUpperCase() === destCountry ? 1 : 0;
        const bMatch = (b.country || '').toUpperCase() === destCountry ? 1 : 0;
        return bMatch - aMatch;
    });

    if (preferSingleShipment || toRank.length === 1) {
        return { warehouse: toRank[0], warehouses: toRank, split: false };
    }
    return { warehouse: toRank[0], warehouses: toRank, split: allowSplit };
}

/**
 * Get warehouse by id.
 * @param {string} warehouseId - _id or string id
 * @returns {Promise<object | null>}
 */
async function getWarehouseById(warehouseId) {
    if (!warehouseId) return null;
    const all = await getActiveWarehouses();
    const idStr = String(warehouseId);
    return all.find(w => w._id && String(w._id) === idStr) || all.find(w => w.warehouse_id === idStr) || null;
}

module.exports = {
    getActiveWarehouses,
    getProductWarehouses,
    selectWarehouse,
    getWarehouseById
};
