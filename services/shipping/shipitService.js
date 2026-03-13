/**
 * SHIPIT integration – logistics automation only.
 * Not used for shipping price calculations; those come from DB (POST /api/shipping/options).
 * SHIPIT is used for: shipment creation, label generation, tracking updates, pickup point lookup.
 */

const getDBInstance = require('../../vornifydb/dbInstance');

const SHIPIT_BASE_URL = (process.env.SHIPIT_BASE_URL || 'https://api.shipit.ax/v1').replace(/\/$/, '');
const SHIPIT_API_KEY = process.env.SHIPIT_API_KEY || '';
const SHIPMENTS_COLL = 'shipments';
const DATABASE_NAME = 'peakmode';

function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SHIPIT_API_KEY}`,
        'Accept': 'application/json'
    };
}

function isConfigured() {
    return Boolean(SHIPIT_API_KEY);
}

/**
 * Build sender object for SHIPIT from env (SHIPIT_SENDER_*).
 * Required for PUT /v1/shipment. Set in .env for production.
 */
function getSenderFromEnv() {
    return {
        name: process.env.SHIPIT_SENDER_NAME || 'PeakMode',
        email: process.env.SHIPIT_SENDER_EMAIL || '',
        phone: process.env.SHIPIT_SENDER_PHONE || '',
        address: process.env.SHIPIT_SENDER_ADDRESS || '',
        city: process.env.SHIPIT_SENDER_CITY || '',
        postcode: process.env.SHIPIT_SENDER_POSTCODE || '',
        country: (process.env.SHIPIT_SENDER_COUNTRY || 'SE').toUpperCase().substring(0, 2),
        state: process.env.SHIPIT_SENDER_STATE || '',
        isCompany: process.env.SHIPIT_SENDER_IS_COMPANY === 'true',
        contactPerson: process.env.SHIPIT_SENDER_CONTACT_PERSON || '',
        vatNumber: process.env.SHIPIT_SENDER_VAT_NUMBER || ''
    };
}

/**
 * Create shipment in SHIPIT and store result in DB.
 * Uses PUT https://apitest.shipit.ax/v1/shipment with real payload/response.
 * @param {string} orderId - Order ID
 * @returns {Promise<{ success: boolean, shipment?: object, error?: string }>}
 */
async function createShipment(orderId) {
    if (!isConfigured()) {
        return { success: false, error: 'SHIPIT_API_KEY not configured' };
    }
    const db = getDBInstance();
    const orderResult = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: 'orders',
        command: '--read',
        data: { orderId }
    });
    const order = orderResult?.success && orderResult?.data ? (Array.isArray(orderResult.data) ? orderResult.data[0] : orderResult.data) : null;
    if (!order) {
        return { success: false, error: 'Order not found' };
    }

    const addr = order.shippingAddress || order.customer || {};
    const receiverName = [addr.firstName, addr.lastName].filter(Boolean).join(' ') || addr.name || 'Customer';
    const receiver = {
        name: receiverName,
        email: addr.email || order.customer?.email || order.customerEmail || '',
        phone: addr.phone || order.customer?.phone || '',
        address: addr.street || addr.address || '',
        city: addr.city || '',
        postcode: String(addr.postalCode || addr.postal_code || '').trim(),
        country: (addr.country || addr.countryCode || 'SE').toString().toUpperCase().substring(0, 2),
        state: addr.state || '',
        isCompany: false,
        contactPerson: '',
        vatNumber: addr.vatNumber || ''
    };

    const weightKg = order.parcel?.weightKg ?? order.totalWeight ?? 1;
    const lengthCm = order.parcel?.lengthCm ?? 30;
    const widthCm = order.parcel?.widthCm ?? 20;
    const heightCm = order.parcel?.heightCm ?? 10;

    const payload = {
        sender: getSenderFromEnv(),
        receiver,
        parcels: [{
            type: 'PACKAGE',
            length: Math.round(lengthCm),
            width: Math.round(widthCm),
            height: Math.round(heightCm),
            weight: Math.max(0.1, Number(weightKg)),
            copies: 1
        }],
        serviceId: order.shippingMethod?.serviceId || order.shippingMethod?.id || process.env.SHIPIT_DEFAULT_SERVICE_ID || null,
        contents: order.parcel?.contents || '',
        freeText: order.parcel?.freeText || '',
        reference: orderId,
        externalId: orderId,
        inventory: order.pickupPointId || order.pickupPoint_id || '',
        sendOrderConfirmationEmail: false
    };

    try {
        const url = `${SHIPIT_BASE_URL}/shipment`;
        const res = await fetch(url, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return { success: false, error: data.message || data.error || res.statusText || `HTTP ${res.status}` };
        }

        const trackingNumber = data.trackingNumber;
        const labelUrl = Array.isArray(data.freightDoc) && data.freightDoc[0] ? data.freightDoc[0] : null;
        const shipitId = data.shipmentNumber;

        const shipmentDoc = {
            order_id: orderId,
            orderId,
            shipit_shipment_id: shipitId,
            carrier: order.shippingMethod?.carrier || 'SHIPIT',
            tracking_number: trackingNumber,
            trackingNumber,
            service_id: payload.serviceId,
            serviceId: payload.serviceId,
            label_url: labelUrl,
            labelUrl,
            status: data.status != null ? String(data.status) : 'created',
            pickup_point_id: order.pickupPointId || order.pickupPoint_id || null,
            pickupPointId: order.pickupPointId || order.pickupPoint_id || null,
            tracking_urls: data.trackingUrls || [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const coll = await db.getCollection(DATABASE_NAME, SHIPMENTS_COLL);
        const insertResult = await coll.insertOne(shipmentDoc);
        const shipment_id = insertResult.insertedId?.toString();

        return {
            success: true,
            shipment: {
                shipment_id,
                order_id: orderId,
                shipit_shipment_id: shipitId,
                carrier: shipmentDoc.carrier,
                tracking_number: trackingNumber,
                trackingNumber,
                label_url: labelUrl,
                labelUrl,
                status: shipmentDoc.status
            }
        };
    } catch (e) {
        console.error('[SHIPIT] createShipment error:', e);
        return { success: false, error: e.message || 'SHIPIT request failed' };
    }
}

/**
 * Track shipment via SHIPIT and update DB.
 * Uses POST /v1/query-tracking-events.
 * @param {string} trackingNumber
 * @returns {Promise<{ success: boolean, events?: array, status?: string, error?: string }>}
 */
async function trackShipment(trackingNumber) {
    if (!isConfigured()) {
        return { success: false, error: 'SHIPIT_API_KEY not configured' };
    }
    if (!trackingNumber) {
        return { success: false, error: 'trackingNumber required' };
    }

    try {
        const url = `${SHIPIT_BASE_URL}/query-tracking-events`;
        const res = await fetch(url, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ tracking_number: trackingNumber })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return { success: false, error: data.message || data.error || res.statusText || `HTTP ${res.status}` };
        }

        const events = data.events || data.tracking_events || [];
        const status = data.status || (events.length && events[events.length - 1].status) || null;

        const db = getDBInstance();
        const coll = await db.getCollection(DATABASE_NAME, SHIPMENTS_COLL);
        await coll.updateMany(
            { trackingNumber: trackingNumber },
            { $set: { status: status || 'in_transit', updated_at: new Date().toISOString(), lastEvents: events } }
        );

        return { success: true, events, status };
    } catch (e) {
        console.error('[SHIPIT] trackShipment error:', e);
        return { success: false, error: e.message || 'SHIPIT request failed' };
    }
}

/**
 * Get pickup points (agents) for checkout when shipping method = pickup.
 * Uses POST /v1/agents.
 * @param {string} postcode
 * @param {string} country
 * @param {string} [serviceId]
 * @returns {Promise<{ success: boolean, agents?: array, error?: string }>}
 */
async function getPickupPoints(postcode, country, serviceId) {
    if (!isConfigured()) {
        return { success: false, error: 'SHIPIT_API_KEY not configured', agents: [] };
    }
    if (!postcode || !country) {
        return { success: false, error: 'postcode and country required', agents: [] };
    }

    try {
        const url = `${SHIPIT_BASE_URL}/agents`;
        const body = { postcode: String(postcode).trim(), country: String(country).toUpperCase().substring(0, 2) };
        if (serviceId) body.service_id = serviceId;

        const res = await fetch(url, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return { success: false, error: data.message || data.error || res.statusText || `HTTP ${res.status}`, agents: [] };
        }

        const agents = data.agents || data.pickup_points || data.points || [];
        return { success: true, agents: Array.isArray(agents) ? agents : [] };
    } catch (e) {
        console.error('[SHIPIT] getPickupPoints error:', e);
        return { success: false, error: e.message || 'SHIPIT request failed', agents: [] };
    }
}

/**
 * Sync carrier services from SHIPIT and store/update in DB.
 * Uses GET /v1/list-methods.
 * @returns {Promise<{ success: boolean, methods?: array, error?: string }>}
 */
async function syncCarrierServices() {
    if (!isConfigured()) {
        return { success: false, error: 'SHIPIT_API_KEY not configured', methods: [] };
    }

    try {
        const url = `${SHIPIT_BASE_URL}/list-methods`;
        const res = await fetch(url, {
            method: 'GET',
            headers: getAuthHeaders()
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return { success: false, error: data.message || data.error || res.statusText || `HTTP ${res.status}`, methods: [] };
        }

        const methods = data.methods || data.services || data.carrier_services || [];
        const list = Array.isArray(methods) ? methods : [];

        const db = getDBInstance();
        const coll = await db.getCollection(DATABASE_NAME, 'shipit_services');
        if (list.length > 0) {
            await coll.deleteMany({});
            await coll.insertOne({ syncedAt: new Date().toISOString(), methods: list });
        }

        return { success: true, methods: list };
    } catch (e) {
        console.error('[SHIPIT] syncCarrierServices error:', e);
        return { success: false, error: e.message || 'SHIPIT request failed', methods: [] };
    }
}

module.exports = {
    isConfigured,
    createShipment,
    trackShipment,
    getPickupPoints,
    syncCarrierServices
};
