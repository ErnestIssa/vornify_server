/**
 * Carrier integration service.
 * Loads credentials from DB (carrier_integrations) and delegates to adapter.
 * Admins configure via Admin panel; no code changes needed.
 * Each adapter supports: getRates(), createLabel(), trackShipment(), cancelShipment().
 */

const getDBInstance = require('../vornifydb/dbInstance');

const DATABASE_NAME = 'peakmode';
const CARRIER_INTEGRATIONS_COLL = 'carrier_integrations';

const MASK = '********';

/**
 * Get credentials for a carrier (from DB). Never expose to client.
 * @param {string} carrierName - DHL, UPS, FedEx, PostNord
 * @returns {Promise<object | null>}
 */
async function getCarrierCredentials(carrierName) {
    if (!carrierName) return null;
    const db = getDBInstance();
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: CARRIER_INTEGRATIONS_COLL,
        command: '--read',
        data: { carrier_name: new RegExp(`^${String(carrierName).trim()}$`, 'i'), active: { $ne: false } }
    });
    const list = (result && result.success && result.data) ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
    return list[0] || null;
}

/**
 * Get rates (stub until adapter implemented).
 * @param {string} carrierName
 * @param {object} origin - { country, postalCode, city?, street? }
 * @param {object} destination - same shape
 * @param {object} parcel - { weightKg, lengthCm, widthCm, heightCm? }
 * @returns {Promise<{ success: boolean, rates?: array, error?: string }>}
 */
async function getRates(carrierName, origin, destination, parcel) {
    const creds = await getCarrierCredentials(carrierName);
    if (!creds) return { success: false, error: 'Carrier not configured or inactive' };
    try {
        const adapter = getAdapter(carrierName);
        if (adapter && typeof adapter.getRates === 'function') return await adapter.getRates(creds, origin, destination, parcel);
        return { success: false, error: 'Rate fetching not integrated for this carrier' };
    } catch (e) {
        return { success: false, error: e.message || 'getRates failed' };
    }
}

/**
 * Create shipping label (stub until adapter implemented).
 * @param {string} carrierName
 * @param {object} shipmentData - { orderId, origin, destination, parcel, serviceCode? }
 * @returns {Promise<{ success: boolean, trackingNumber?: string, labelUrl?: string, error?: string }>}
 */
async function createLabel(carrierName, shipmentData) {
    const creds = await getCarrierCredentials(carrierName);
    if (!creds) return { success: false, error: 'Carrier not configured or inactive' };
    try {
        const adapter = getAdapter(carrierName);
        if (adapter && typeof adapter.createLabel === 'function') return await adapter.createLabel(creds, shipmentData);
        return { success: false, error: 'Label creation not integrated for this carrier' };
    } catch (e) {
        return { success: false, error: e.message || 'createLabel failed' };
    }
}

/**
 * Track shipment (stub until adapter implemented).
 * @param {string} carrierName
 * @param {string} trackingNumber
 * @returns {Promise<{ success: boolean, status?: string, events?: array, error?: string }>}
 */
async function trackShipment(carrierName, trackingNumber) {
    const creds = await getCarrierCredentials(carrierName);
    if (!creds) return { success: false, error: 'Carrier not configured or inactive' };
    try {
        const adapter = getAdapter(carrierName);
        if (adapter && typeof adapter.trackShipment === 'function') return await adapter.trackShipment(creds, trackingNumber);
        return { success: false, error: 'Tracking not integrated for this carrier' };
    } catch (e) {
        return { success: false, error: e.message || 'trackShipment failed' };
    }
}

/**
 * Cancel shipment (stub until adapter implemented).
 * @param {string} carrierName
 * @param {string} shipmentIdOrTrackingNumber
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function cancelShipment(carrierName, shipmentIdOrTrackingNumber) {
    const creds = await getCarrierCredentials(carrierName);
    if (!creds) return { success: false, error: 'Carrier not configured or inactive' };
    try {
        const adapter = getAdapter(carrierName);
        if (adapter && typeof adapter.cancelShipment === 'function') return await adapter.cancelShipment(creds, shipmentIdOrTrackingNumber);
        return { success: false, error: 'Cancel not integrated for this carrier' };
    } catch (e) {
        return { success: false, error: e.message || 'cancelShipment failed' };
    }
}

/**
 * Lazy-load adapter (stub implementations).
 */
function getAdapter(carrierName) {
    const name = (carrierName || '').toLowerCase();
    if (name === 'postnord') return require('./carriers/postnordAdapter');
    if (name === 'dhl') return require('./carriers/dhlAdapter');
    if (name === 'ups') return require('./carriers/upsAdapter');
    if (name === 'fedex') return require('./carriers/fedexAdapter');
    return null;
}

module.exports = {
    getCarrierCredentials,
    getRates,
    createLabel,
    trackShipment,
    cancelShipment,
    CARRIER_INTEGRATIONS_COLL,
    DATABASE_NAME,
    MASK
};
