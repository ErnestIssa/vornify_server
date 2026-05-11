/**
 * Admin-controlled shipping configuration (database-driven).
 * All shipping zones, methods, prices, and free-delivery areas are read from MongoDB.
 */

const { ObjectId } = require('mongodb');
const getDBInstance = require('../vornifydb/dbInstance');
const { buildShippingVersionSource, computeShippingVersion } = require('../core/guards/shippingVersion');

const DATABASE_NAME = 'peakmode';
const COLLECTIONS = {
    ZONES: 'shipping_zones',
    METHODS: 'shipping_methods',
    PRICES: 'shipping_prices',
    FREE_AREAS: 'shipping_free_areas'
};

/**
 * Get all active shipping zones from DB.
 * @returns {Promise<Array<{ _id, name, countries, currency, active }>>}
 */
async function getZones() {
    const db = getDBInstance();
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTIONS.ZONES,
        command: '--read',
        data: { active: { $ne: false } }
    });
    if (!result || !result.success || !Array.isArray(result.data)) return [];
    return result.data;
}

/**
 * Find zone whose countries array contains the given country code.
 * @param {string} countryCode - ISO 2-letter (e.g. 'SE', 'DE')
 * @returns {Promise<{ _id, name, countries, currency, active } | null>}
 */
async function getZoneByCountry(countryCode) {
    if (!countryCode || typeof countryCode !== 'string') return null;
    const normalized = countryCode.toUpperCase().trim();
    const zones = await getZones();
    return zones.find(z => Array.isArray(z.countries) && z.countries.includes(normalized)) || null;
}

/**
 * Get all active shipping methods from DB.
 * @returns {Promise<Array<{ _id, id, name, type, carrier, active, estimatedDays, description, supportsServicePoints, supportsHomeDelivery }>>}
 */
async function getMethods() {
    const db = getDBInstance();
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTIONS.METHODS,
        command: '--read',
        data: { active: { $ne: false } }
    });
    if (!result || !result.success || !Array.isArray(result.data)) return [];
    return result.data;
}

/**
 * Get method by string id (e.g. 'parcel_locker') or by _id.
 * @param {string} id - method id or _id string
 * @returns {Promise<object | null>}
 */
async function getMethodById(id) {
    if (!id) return null;
    const methods = await getMethods();
    const byId = methods.find(m => (m.id && m.id === id) || (m._id && String(m._id) === String(id)));
    if (byId) return byId;
    if (ObjectId.isValid(id)) {
        const byMongoId = methods.find(m => m._id && String(m._id) === String(id));
        return byMongoId || null;
    }
    return null;
}

/**
 * Get all active shipping prices from DB.
 * @returns {Promise<Array<{ _id, zoneId, methodId, basePrice, currency, active }>>}
 */
async function getPrices() {
    const db = getDBInstance();
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTIONS.PRICES,
        command: '--read',
        data: { active: { $ne: false } }
    });
    if (!result || !result.success || !Array.isArray(result.data)) return [];
    return result.data;
}

/**
 * Get price for a zone + method. zoneId and methodId can be _id (ObjectId/string) or method id string (e.g. 'home_delivery').
 * @param {string} zoneId - zone _id or zone name/code
 * @param {string} methodId - method _id or method id (e.g. 'home_delivery', 'parcel_locker')
 * @returns {Promise<number | null>} basePrice or null
 */
async function getPriceForZoneAndMethod(zoneId, methodId) {
    if (!zoneId || !methodId) return null;
    const prices = await getPrices();
    const zoneIdStr = String(zoneId);
    const methodIdStr = String(methodId);
    const priceRow = prices.find(p => {
        const pZone = p.zoneId ? String(p.zoneId) : '';
        const pMethod = p.methodId ? String(p.methodId) : '';
        return (pZone === zoneIdStr || pZone === zoneId) &&
               (pMethod === methodIdStr || pMethod === methodId);
    });
    if (!priceRow || typeof priceRow.basePrice !== 'number') return null;
    return priceRow.basePrice;
}

/**
 * Get all active free delivery areas from DB.
 * @returns {Promise<Array<{ _id, country, municipality, active }>>}
 */
async function getFreeAreas() {
    const db = getDBInstance();
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTIONS.FREE_AREAS,
        command: '--read',
        data: { active: { $ne: false } }
    });
    if (!result || !result.success || !Array.isArray(result.data)) return [];
    return result.data;
}

/**
 * Check if delivery to (country, municipality) is free. Municipality can be address.municipality or address.city.
 * @param {string} country - ISO country code (e.g. 'SE')
 * @param {string} [municipality] - municipality or city name
 * @returns {Promise<boolean>}
 */
async function isFreeDelivery(country, municipality) {
    if (!country || country.toUpperCase() !== 'SE') return false;
    if (!municipality || typeof municipality !== 'string') return false;
    const areas = await getFreeAreas();
    const normalized = municipality.trim();
    return areas.some(a => a.country && a.country.toUpperCase() === 'SE' && a.municipality && a.municipality.trim().toLowerCase() === normalized.toLowerCase());
}

/**
 * Whether we have any zone config in DB (so we can prefer DB over legacy).
 * @returns {Promise<boolean>}
 */
async function hasZoneConfig() {
    const zones = await getZones();
    return Array.isArray(zones) && zones.length > 0;
}

/**
 * Build delivery options from DB: zones + methods + prices, with free delivery applied.
 * @param {string} countryCode - ISO 2-letter
 * @param {string} [municipality] - for free delivery check
 * @param {string} [currency] - response currency (default SEK)
 * @returns {Promise<{ zone: object | null, options: Array<{ id, type, name, carrier, cost, currency, estimatedDays, servicePoints? }>, fromDb: boolean }>}
 */
async function getDeliveryOptionsFromDb(countryCode, municipality, currency = 'SEK') {
    const zone = await getZoneByCountry(countryCode);
    if (!zone) return { zone: null, options: [], fromDb: false };

    const methods = await getMethods();
    if (methods.length === 0) return { zone, options: [], fromDb: true };

    const freeDelivery = await isFreeDelivery(countryCode, municipality);
    const prices = await getPrices();

    const options = [];
    const zoneIdStr = zone._id ? String(zone._id) : (zone.id || '');
    for (const method of methods) {
        const methodId = method.id || method._id?.toString();
        const priceRow = prices.find(p => {
            const pz = p.zoneId ? String(p.zoneId) : '';
            const pm = p.methodId ? String(p.methodId) : '';
            return pz === zoneIdStr && (pm === methodId || pm === String(method._id));
        });
        let cost = (priceRow && typeof priceRow.basePrice === 'number') ? priceRow.basePrice : 0;
        if (freeDelivery) cost = 0;

        options.push({
            id: methodId || method._id?.toString(),
            type: method.type || 'home',
            name: method.name || 'Delivery',
            carrier: method.carrier || null,
            cost: Math.round(cost * 100) / 100,
            currency: (priceRow && priceRow.currency) || zone.currency || currency,
            estimatedDays: method.estimatedDays || null,
            description: method.description || null,
            supportsServicePoints: method.supportsServicePoints === true,
            supportsHomeDelivery: method.supportsHomeDelivery !== false,
            servicePoints: []
        });
    }

    options.sort((a, b) => (a.cost || 0) - (b.cost || 0));
    return { zone, options, fromDb: true };
}

/**
 * Get shipping cost for payment/order: resolve zone, method, apply free delivery.
 * @param {string} countryCode - ISO 2-letter
 * @param {string} methodId - method id (e.g. 'home_delivery') or method _id
 * @param {string} [municipality] - for free delivery
 * @returns {Promise<number>} cost (0 if free or not found)
 */
async function getShippingCostFromDb(countryCode, methodId, municipality) {
    if (await isFreeDelivery(countryCode, municipality)) return 0;
    const zone = await getZoneByCountry(countryCode);
    if (!zone) return 0;
    const cost = await getPriceForZoneAndMethod(zone._id?.toString() || zone.id, methodId);
    return typeof cost === 'number' && !isNaN(cost) ? cost : 0;
}

/**
 * Validate selected shipping method for a given address and return a versioned quote.
 * Throws no errors; returns { ok: boolean, errorCode?, userMessage?, quote? }.
 */
async function validateAndQuoteShipping(countryCode, methodId, municipality, currency = 'SEK') {
    const country = (countryCode || '').toUpperCase().trim();
    const method = await getMethodById(methodId);
    if (!method) {
        return { ok: false, errorCode: 'SHIPPING_METHOD_INVALID', userMessage: 'Selected shipping method is no longer available. Please choose another.' };
    }
    const zone = await getZoneByCountry(country);
    if (!zone) {
        return { ok: false, errorCode: 'SHIPPING_UNAVAILABLE', userMessage: `Shipping is not available to ${country}. Please change your address.` };
    }
    // Ensure method has a configured price row for this zone (unless free delivery applies)
    const freeDelivery = await isFreeDelivery(country, municipality);
    const zoneIdStr = zone._id?.toString() || zone.id || zone.name;
    const methodIdStr = method.id || method._id?.toString() || String(methodId);
    const cost = freeDelivery ? 0 : await getPriceForZoneAndMethod(zone._id?.toString() || zone.id, methodIdStr);
    if (!freeDelivery && (cost == null || typeof cost !== 'number' || isNaN(cost))) {
        return { ok: false, errorCode: 'SHIPPING_METHOD_INVALID', userMessage: 'Selected shipping method is not available for your address. Please choose another.' };
    }
    const normalizedCost = typeof cost === 'number' && !isNaN(cost) ? Math.round(cost * 100) / 100 : 0;
    const shippingVersion = computeShippingVersion(buildShippingVersionSource({
        country,
        municipality,
        zoneId: zoneIdStr,
        methodId: methodIdStr,
        cost: normalizedCost,
        freeDelivery,
        currency
    }));
    return {
        ok: true,
        quote: {
            country,
            municipality: municipality || '',
            zoneId: zoneIdStr,
            methodId: methodIdStr,
            cost: normalizedCost,
            currency: currency || 'SEK',
            freeDelivery,
            shippingVersion
        }
    };
}

module.exports = {
    DATABASE_NAME,
    COLLECTIONS,
    getZones,
    getZoneByCountry,
    getMethods,
    getMethodById,
    getPrices,
    getFreeAreas,
    isFreeDelivery,
    hasZoneConfig,
    getDeliveryOptionsFromDb,
    getShippingCostFromDb,
    validateAndQuoteShipping
};
