/**
 * Admin Shipping Configuration API
 * CRUD for shipping_zones, shipping_methods, shipping_prices, shipping_free_areas.
 * All endpoints require admin authentication.
 */

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const getDBInstance = require('../vornifydb/dbInstance');
const { DATABASE_NAME, COLLECTIONS } = require('../services/shippingConfigService');

const db = getDBInstance();

function toIdFilter(id) {
    if (!id) return null;
    return ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
}

// ---------- Zones ----------

router.get('/zones', authenticateAdmin, async (req, res) => {
    try {
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.ZONES,
            command: '--read',
            data: {}
        });
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error || 'Failed to list zones' });
        }
        const data = Array.isArray(result.data) ? result.data : [];
        return res.json({ success: true, data });
    } catch (e) {
        console.error('[adminShipping] GET zones error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.post('/zones', authenticateAdmin, async (req, res) => {
    try {
        const { name, countries, currency, active } = req.body;
        if (!name || !Array.isArray(countries)) {
            return res.status(400).json({ success: false, error: 'name and countries (array) are required' });
        }
        const doc = {
            name: String(name),
            countries: countries.map(c => String(c).toUpperCase()),
            currency: currency != null ? String(currency) : 'SEK',
            active: active !== false
        };
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.ZONES,
            command: '--create',
            data: doc
        });
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error || 'Failed to create zone' });
        }
        const inserted = result.data && result.data.insertedId;
        return res.status(201).json({ success: true, id: inserted, data: { _id: inserted, ...doc } });
    } catch (e) {
        console.error('[adminShipping] POST zones error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.put('/zones/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid zone id' });
        const { name, countries, currency, active } = req.body;
        const update = {};
        if (name !== undefined) update.name = String(name);
        if (countries !== undefined) update.countries = Array.isArray(countries) ? countries.map(c => String(c).toUpperCase()) : [];
        if (currency !== undefined) update.currency = String(currency);
        if (typeof active === 'boolean') update.active = active;
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.ZONES,
            command: '--update',
            data: { filter, update }
        });
        if (!result.success) {
            return res.status(result.error && result.error.includes('No document matched') ? 404 : 500)
                .json({ success: false, error: result.error || 'Update failed' });
        }
        return res.json({ success: true });
    } catch (e) {
        console.error('[adminShipping] PUT zones error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.delete('/zones/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid zone id' });
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.ZONES,
            command: '--delete',
            data: filter
        });
        if (!result.success) return res.status(500).json({ success: false, error: result.error || 'Delete failed' });
        return res.json({ success: true, deleted: result.data && result.data.deletedCount > 0 });
    } catch (e) {
        console.error('[adminShipping] DELETE zones error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// ---------- Methods ----------

router.get('/methods', authenticateAdmin, async (req, res) => {
    try {
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.METHODS,
            command: '--read',
            data: {}
        });
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error || 'Failed to list methods' });
        }
        const data = Array.isArray(result.data) ? result.data : [];
        return res.json({ success: true, data });
    } catch (e) {
        console.error('[adminShipping] GET methods error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.post('/methods', authenticateAdmin, async (req, res) => {
    try {
        const { id, name, type, carrier, active, estimatedDays, description, supportsServicePoints, supportsHomeDelivery } = req.body;
        if (!name || !type) {
            return res.status(400).json({ success: false, error: 'name and type are required' });
        }
        const methodId = (id != null && String(id).trim()) ? String(id).trim() : `${type}_${Date.now()}`;
        const doc = {
            id: methodId,
            name: String(name),
            type: String(type),
            carrier: carrier != null ? String(carrier) : null,
            active: active !== false,
            estimatedDays: estimatedDays != null ? String(estimatedDays) : null,
            description: description != null ? String(description) : null,
            supportsServicePoints: supportsServicePoints === true,
            supportsHomeDelivery: supportsHomeDelivery !== false
        };
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.METHODS,
            command: '--create',
            data: doc
        });
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error || 'Failed to create method' });
        }
        const inserted = result.data && result.data.insertedId;
        return res.status(201).json({ success: true, id: inserted, data: { _id: inserted, ...doc } });
    } catch (e) {
        console.error('[adminShipping] POST methods error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.put('/methods/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid method id' });
        const { name, type, carrier, active, estimatedDays, description, supportsServicePoints, supportsHomeDelivery } = req.body;
        const update = {};
        if (name !== undefined) update.name = String(name);
        if (type !== undefined) update.type = String(type);
        if (carrier !== undefined) update.carrier = carrier == null ? null : String(carrier);
        if (typeof active === 'boolean') update.active = active;
        if (estimatedDays !== undefined) update.estimatedDays = estimatedDays == null ? null : String(estimatedDays);
        if (description !== undefined) update.description = description == null ? null : String(description);
        if (typeof supportsServicePoints === 'boolean') update.supportsServicePoints = supportsServicePoints;
        if (typeof supportsHomeDelivery === 'boolean') update.supportsHomeDelivery = supportsHomeDelivery;
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.METHODS,
            command: '--update',
            data: { filter, update }
        });
        if (!result.success) {
            return res.status(result.error && result.error.includes('No document matched') ? 404 : 500)
                .json({ success: false, error: result.error || 'Update failed' });
        }
        return res.json({ success: true });
    } catch (e) {
        console.error('[adminShipping] PUT methods error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.delete('/methods/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid method id' });
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.METHODS,
            command: '--delete',
            data: filter
        });
        if (!result.success) return res.status(500).json({ success: false, error: result.error || 'Delete failed' });
        return res.json({ success: true, deleted: result.data && result.data.deletedCount > 0 });
    } catch (e) {
        console.error('[adminShipping] DELETE methods error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// ---------- Prices ----------

router.get('/prices', authenticateAdmin, async (req, res) => {
    try {
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.PRICES,
            command: '--read',
            data: {}
        });
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error || 'Failed to list prices' });
        }
        const data = Array.isArray(result.data) ? result.data : [];
        return res.json({ success: true, data });
    } catch (e) {
        console.error('[adminShipping] GET prices error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.post('/prices', authenticateAdmin, async (req, res) => {
    try {
        const { zoneId, methodId, basePrice, currency, active } = req.body;
        if (zoneId == null || methodId == null || typeof basePrice !== 'number') {
            return res.status(400).json({ success: false, error: 'zoneId, methodId, and basePrice (number) are required' });
        }
        const doc = {
            zoneId: ObjectId.isValid(zoneId) ? new ObjectId(zoneId) : zoneId,
            methodId: ObjectId.isValid(methodId) ? new ObjectId(methodId) : methodId,
            basePrice: Number(basePrice),
            currency: currency != null ? String(currency) : 'SEK',
            active: active !== false
        };
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.PRICES,
            command: '--create',
            data: doc
        });
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error || 'Failed to create price' });
        }
        const inserted = result.data && result.data.insertedId;
        return res.status(201).json({ success: true, id: inserted, data: { _id: inserted, ...doc } });
    } catch (e) {
        console.error('[adminShipping] POST prices error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.put('/prices/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid price id' });
        const { zoneId, methodId, basePrice, currency, active } = req.body;
        const update = {};
        if (zoneId !== undefined) update.zoneId = ObjectId.isValid(zoneId) ? new ObjectId(zoneId) : zoneId;
        if (methodId !== undefined) update.methodId = ObjectId.isValid(methodId) ? new ObjectId(methodId) : methodId;
        if (typeof basePrice === 'number') update.basePrice = basePrice;
        if (currency !== undefined) update.currency = String(currency);
        if (typeof active === 'boolean') update.active = active;
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.PRICES,
            command: '--update',
            data: { filter, update }
        });
        if (!result.success) {
            return res.status(result.error && result.error.includes('No document matched') ? 404 : 500)
                .json({ success: false, error: result.error || 'Update failed' });
        }
        return res.json({ success: true });
    } catch (e) {
        console.error('[adminShipping] PUT prices error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.delete('/prices/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid price id' });
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.PRICES,
            command: '--delete',
            data: filter
        });
        if (!result.success) return res.status(500).json({ success: false, error: result.error || 'Delete failed' });
        return res.json({ success: true, deleted: result.data && result.data.deletedCount > 0 });
    } catch (e) {
        console.error('[adminShipping] DELETE prices error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// ---------- Free areas ----------

router.get('/free-areas', authenticateAdmin, async (req, res) => {
    try {
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.FREE_AREAS,
            command: '--read',
            data: {}
        });
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error || 'Failed to list free areas' });
        }
        const data = Array.isArray(result.data) ? result.data : [];
        return res.json({ success: true, data });
    } catch (e) {
        console.error('[adminShipping] GET free-areas error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.post('/free-areas', authenticateAdmin, async (req, res) => {
    try {
        const { country, municipality, active } = req.body;
        if (!country || !municipality) {
            return res.status(400).json({ success: false, error: 'country and municipality are required' });
        }
        const doc = {
            country: String(country).toUpperCase(),
            municipality: String(municipality).trim(),
            active: active !== false
        };
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.FREE_AREAS,
            command: '--create',
            data: doc
        });
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error || 'Failed to create free area' });
        }
        const inserted = result.data && result.data.insertedId;
        return res.status(201).json({ success: true, id: inserted, data: { _id: inserted, ...doc } });
    } catch (e) {
        console.error('[adminShipping] POST free-areas error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.put('/free-areas/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid free area id' });
        const { country, municipality, active } = req.body;
        const update = {};
        if (country !== undefined) update.country = String(country).toUpperCase();
        if (municipality !== undefined) update.municipality = String(municipality).trim();
        if (typeof active === 'boolean') update.active = active;
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.FREE_AREAS,
            command: '--update',
            data: { filter, update }
        });
        if (!result.success) {
            return res.status(result.error && result.error.includes('No document matched') ? 404 : 500)
                .json({ success: false, error: result.error || 'Update failed' });
        }
        return res.json({ success: true });
    } catch (e) {
        console.error('[adminShipping] PUT free-areas error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.delete('/free-areas/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid free area id' });
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTIONS.FREE_AREAS,
            command: '--delete',
            data: filter
        });
        if (!result.success) return res.status(500).json({ success: false, error: result.error || 'Delete failed' });
        return res.json({ success: true, deleted: result.data && result.data.deletedCount > 0 });
    } catch (e) {
        console.error('[adminShipping] DELETE free-areas error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// ---------- Warehouses ----------
const WAREHOUSES_COLL = 'warehouses';

router.get('/warehouses', authenticateAdmin, async (req, res) => {
    try {
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: WAREHOUSES_COLL,
            command: '--read',
            data: {}
        });
        const data = (result.success && Array.isArray(result.data)) ? result.data : [];
        return res.json({ success: true, data });
    } catch (e) {
        console.error('[adminShipping] GET warehouses error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.post('/warehouses', authenticateAdmin, async (req, res) => {
    try {
        const { name, address, city, country, postal_code, postalCode, processingTimeDays, processing_time, carriers, supported_carriers, priorityLevel, priority_level, active } = req.body;
        if (!name || !country) {
            return res.status(400).json({ success: false, error: 'name and country are required' });
        }
        const countryCode = String(country).toUpperCase();
        const addr = address && typeof address === 'object' ? address : {};
        const doc = {
            name: String(name),
            address: {
                street: addr.street || addr.streetName || '',
                city: addr.city || city || '',
                postalCode: addr.postalCode || addr.postal_code || postalCode || postal_code || '',
                country: countryCode
            },
            city: addr.city || city || '',
            country: countryCode,
            postal_code: addr.postalCode || addr.postal_code || postalCode || postal_code || '',
            processingTimeDays: typeof processingTimeDays === 'number' ? processingTimeDays : (typeof processing_time === 'number' ? processing_time : 0),
            processing_time: typeof processingTimeDays === 'number' ? processingTimeDays : (typeof processing_time === 'number' ? processing_time : 0),
            carriers: Array.isArray(carriers) ? carriers : (Array.isArray(supported_carriers) ? supported_carriers : []),
            supported_carriers: Array.isArray(carriers) ? carriers : (Array.isArray(supported_carriers) ? supported_carriers : []),
            priorityLevel: typeof priorityLevel === 'number' ? priorityLevel : (typeof priority_level === 'number' ? priority_level : 0),
            priority_level: typeof priorityLevel === 'number' ? priorityLevel : (typeof priority_level === 'number' ? priority_level : 0),
            active: active !== false,
            active_status: active !== false
        };
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: WAREHOUSES_COLL,
            command: '--create',
            data: doc
        });
        if (!result.success) return res.status(500).json({ success: false, error: result.error || 'Failed to create warehouse' });
        const id = result.data && result.data.insertedId;
        return res.status(201).json({ success: true, id, data: { _id: id, ...doc } });
    } catch (e) {
        console.error('[adminShipping] POST warehouses error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.put('/warehouses/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid warehouse id' });
        const { name, address, city, country, postal_code, postalCode, processingTimeDays, processing_time, carriers, supported_carriers, priorityLevel, priority_level, active } = req.body;
        const update = {};
        if (name !== undefined) update.name = String(name);
        if (address !== undefined) {
            const a = address && typeof address === 'object' ? address : {};
            update.address = { street: a.street || a.streetName || '', city: a.city || '', postalCode: a.postalCode || a.postal_code || '', country: a.country || '' };
            if (a.city !== undefined) update.city = a.city;
            if (a.postalCode !== undefined || a.postal_code !== undefined) update.postal_code = a.postalCode || a.postal_code;
        }
        if (city !== undefined) update.city = city;
        if (postalCode !== undefined || postal_code !== undefined) update.postal_code = postalCode || postal_code;
        if (country !== undefined) { update.country = String(country).toUpperCase(); if (!update.address) update.address = {}; update.address.country = update.country; }
        if (typeof processingTimeDays === 'number') { update.processingTimeDays = processingTimeDays; update.processing_time = processingTimeDays; }
        if (typeof processing_time === 'number') { update.processingTimeDays = processing_time; update.processing_time = processing_time; }
        if (Array.isArray(carriers)) { update.carriers = carriers; update.supported_carriers = carriers; }
        if (Array.isArray(supported_carriers)) { update.carriers = supported_carriers; update.supported_carriers = supported_carriers; }
        if (typeof priorityLevel === 'number') { update.priorityLevel = priorityLevel; update.priority_level = priorityLevel; }
        if (typeof priority_level === 'number') { update.priorityLevel = priority_level; update.priority_level = priority_level; }
        if (typeof active === 'boolean') { update.active = active; update.active_status = active; }
        if (Object.keys(update).length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: WAREHOUSES_COLL,
            command: '--update',
            data: { filter, update }
        });
        if (!result.success) return res.status(result.error && result.error.includes('No document matched') ? 404 : 500).json({ success: false, error: result.error || 'Update failed' });
        return res.json({ success: true });
    } catch (e) {
        console.error('[adminShipping] PUT warehouses error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.delete('/warehouses/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid warehouse id' });
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: WAREHOUSES_COLL,
            command: '--delete',
            data: filter
        });
        if (!result.success) return res.status(500).json({ success: false, error: result.error || 'Delete failed' });
        return res.json({ success: true, deleted: result.data && result.data.deletedCount > 0 });
    } catch (e) {
        console.error('[adminShipping] DELETE warehouses error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// ---------- Package presets ----------
const PACKAGES_COLL = 'package_presets';

router.get('/packages', authenticateAdmin, async (req, res) => {
    try {
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: PACKAGES_COLL,
            command: '--read',
            data: {}
        });
        const data = (result.success && Array.isArray(result.data)) ? result.data : [];
        return res.json({ success: true, data });
    } catch (e) {
        console.error('[adminShipping] GET packages error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.post('/packages', authenticateAdmin, async (req, res) => {
    try {
        const { name, type, weightKg, lengthCm, widthCm, heightCm, maxCapacity, active } = req.body;
        if (!name || !type) {
            return res.status(400).json({ success: false, error: 'name and type are required' });
        }
        const doc = {
            name: String(name),
            type: String(type),
            weightKg: typeof weightKg === 'number' ? weightKg : 0,
            lengthCm: typeof lengthCm === 'number' ? lengthCm : 0,
            widthCm: typeof widthCm === 'number' ? widthCm : 0,
            heightCm: typeof heightCm === 'number' ? heightCm : 0,
            maxCapacity: maxCapacity != null ? maxCapacity : null,
            active: active !== false
        };
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: PACKAGES_COLL,
            command: '--create',
            data: doc
        });
        if (!result.success) return res.status(500).json({ success: false, error: result.error || 'Failed to create package preset' });
        const id = result.data && result.data.insertedId;
        return res.status(201).json({ success: true, id, data: { _id: id, ...doc } });
    } catch (e) {
        console.error('[adminShipping] POST packages error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.put('/packages/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid package id' });
        const { name, type, weightKg, lengthCm, widthCm, heightCm, maxCapacity, active } = req.body;
        const update = {};
        if (name !== undefined) update.name = String(name);
        if (type !== undefined) update.type = String(type);
        if (typeof weightKg === 'number') update.weightKg = weightKg;
        if (typeof lengthCm === 'number') update.lengthCm = lengthCm;
        if (typeof widthCm === 'number') update.widthCm = widthCm;
        if (typeof heightCm === 'number') update.heightCm = heightCm;
        if (maxCapacity !== undefined) update.maxCapacity = maxCapacity;
        if (typeof active === 'boolean') update.active = active;
        if (Object.keys(update).length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: PACKAGES_COLL,
            command: '--update',
            data: { filter, update }
        });
        if (!result.success) return res.status(result.error && result.error.includes('No document matched') ? 404 : 500).json({ success: false, error: result.error || 'Update failed' });
        return res.json({ success: true });
    } catch (e) {
        console.error('[adminShipping] PUT packages error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.delete('/packages/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid package id' });
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: PACKAGES_COLL,
            command: '--delete',
            data: filter
        });
        if (!result.success) return res.status(500).json({ success: false, error: result.error || 'Delete failed' });
        return res.json({ success: true, deleted: result.data && result.data.deletedCount > 0 });
    } catch (e) {
        console.error('[adminShipping] DELETE packages error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// ---------- Global shipping settings (single document) ----------
const GLOBAL_SETTINGS_COLL = 'global_shipping_settings';

router.get('/settings', authenticateAdmin, async (req, res) => {
    try {
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: GLOBAL_SETTINGS_COLL,
            command: '--read',
            data: {}
        });
        const data = (result.success && Array.isArray(result.data) && result.data.length > 0) ? result.data[0] : null;
        return res.json({ success: true, data: data || {} });
    } catch (e) {
        console.error('[adminShipping] GET settings error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.put('/settings', authenticateAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const collection = await db.getCollection(DATABASE_NAME, GLOBAL_SETTINGS_COLL);
        const existing = await collection.find({}).limit(1).toArray();
        const doc = {
            defaultOriginAddress: body.defaultOriginAddress != null ? body.defaultOriginAddress : (existing[0] && existing[0].defaultOriginAddress) || null,
            defaultPackagePresetId: body.defaultPackagePresetId != null ? body.defaultPackagePresetId : (existing[0] && existing[0].defaultPackagePresetId) || null,
            shippingCurrency: body.shippingCurrency != null ? body.shippingCurrency : (existing[0] && existing[0].shippingCurrency) || 'SEK',
            weightUnit: body.weightUnit != null ? body.weightUnit : (existing[0] && existing[0].weightUnit) || 'kg',
            dimensionUnit: body.dimensionUnit != null ? body.dimensionUnit : (existing[0] && existing[0].dimensionUnit) || 'cm',
            handlingTimeDays: typeof body.handlingTimeDays === 'number' ? body.handlingTimeDays : (existing[0] && existing[0].handlingTimeDays) ?? 0,
            cutoffTime: body.cutoffTime != null ? body.cutoffTime : (existing[0] && existing[0].cutoffTime) || null,
            updatedAt: new Date().toISOString()
        };
        if (existing.length === 0) {
            await collection.insertOne(doc);
            return res.json({ success: true, data: doc });
        }
        await collection.updateOne({}, { $set: doc });
        return res.json({ success: true, data: doc });
    } catch (e) {
        console.error('[adminShipping] PUT settings error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// ---------- Warehouse selection (for admin / order assignment) ----------
const warehouseSelectionService = require('../services/warehouseSelectionService');

router.get('/warehouse-select', authenticateAdmin, async (req, res) => {
    try {
        const { destinationCountry, productIds, preferSingleShipment, allowSplit } = req.query;
        const ids = (productIds || '').split(',').map(s => s.trim()).filter(Boolean);
        const orderItems = ids.map(id => ({ id, productId: id, quantity: 1 }));
        const result = await warehouseSelectionService.selectWarehouse(
            orderItems,
            destinationCountry || '',
            { preferSingleShipment: preferSingleShipment !== 'false', allowSplit: allowSplit !== 'false' }
        );
        return res.json({ success: true, ...result });
    } catch (e) {
        console.error('[adminShipping] GET warehouse-select error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// ---------- Carrier integrations (credentials stored in DB; never return secrets) ----------
const carrierIntegrationService = require('../services/carrierIntegrationService');
const CARRIER_INTEGRATIONS_COLL = carrierIntegrationService.CARRIER_INTEGRATIONS_COLL;
const MASK = carrierIntegrationService.MASK;

function maskCredential(v) {
    if (v == null || v === '') return null;
    const s = String(v);
    return s.length <= 4 ? MASK : s.slice(0, 2) + MASK + s.slice(-2);
}

router.get('/carriers', authenticateAdmin, async (req, res) => {
    try {
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: CARRIER_INTEGRATIONS_COLL,
            command: '--read',
            data: {}
        });
        let data = (result.success && result.data) ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
        data = data.map(c => ({
            _id: c._id,
            carrier_name: c.carrier_name,
            carrier_id: c.carrier_id || c._id?.toString(),
            api_key: c.api_key ? maskCredential(c.api_key) : null,
            api_secret: c.api_secret ? MASK : null,
            account_number: c.account_number ? maskCredential(c.account_number) : null,
            environment: c.environment || 'test',
            active: c.active !== false,
            active_status: c.active !== false,
            supported_services: c.supported_services || []
        }));
        return res.json({ success: true, data });
    } catch (e) {
        console.error('[adminShipping] GET carriers error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.post('/carriers', authenticateAdmin, async (req, res) => {
    try {
        const { carrier_name, api_key, api_secret, account_number, environment, active, supported_services } = req.body || {};
        if (!carrier_name) {
            return res.status(400).json({ success: false, error: 'carrier_name is required' });
        }
        const doc = {
            carrier_name: String(carrier_name).trim(),
            api_key: api_key != null ? String(api_key) : '',
            api_secret: api_secret != null ? String(api_secret) : '',
            account_number: account_number != null ? String(account_number) : '',
            environment: (environment === 'live' ? 'live' : 'test'),
            active: active !== false,
            active_status: active !== false,
            supported_services: Array.isArray(supported_services) ? supported_services : []
        };
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: CARRIER_INTEGRATIONS_COLL,
            command: '--create',
            data: doc
        });
        if (!result.success) return res.status(500).json({ success: false, error: result.error || 'Failed to create carrier integration' });
        const id = result.data && result.data.insertedId;
        return res.status(201).json({ success: true, id, data: { _id: id, ...doc, api_key: maskCredential(doc.api_key), api_secret: MASK } });
    } catch (e) {
        console.error('[adminShipping] POST carriers error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.put('/carriers/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid carrier id' });
        const { carrier_name, api_key, api_secret, account_number, environment, active, supported_services } = req.body || {};
        const update = { updatedAt: new Date().toISOString() };
        if (carrier_name !== undefined) update.carrier_name = String(carrier_name).trim();
        if (api_key !== undefined) update.api_key = String(api_key);
        if (api_secret !== undefined) update.api_secret = String(api_secret);
        if (account_number !== undefined) update.account_number = String(account_number);
        if (environment !== undefined) update.environment = environment === 'live' ? 'live' : 'test';
        if (typeof active === 'boolean') { update.active = active; update.active_status = active; }
        if (Array.isArray(supported_services)) update.supported_services = supported_services;
        if (Object.keys(update).length <= 1) return res.status(400).json({ success: false, error: 'No fields to update' });
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: CARRIER_INTEGRATIONS_COLL,
            command: '--update',
            data: { filter, update }
        });
        if (!result.success) return res.status(result.error && result.error.includes('No document matched') ? 404 : 500).json({ success: false, error: result.error || 'Update failed' });
        return res.json({ success: true });
    } catch (e) {
        console.error('[adminShipping] PUT carriers error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.delete('/carriers/:id', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid carrier id' });
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: CARRIER_INTEGRATIONS_COLL,
            command: '--delete',
            data: filter
        });
        if (!result.success) return res.status(500).json({ success: false, error: result.error || 'Delete failed' });
        return res.json({ success: true, deleted: result.data && result.data.deletedCount > 0 });
    } catch (e) {
        console.error('[adminShipping] DELETE carriers error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// POST /api/admin/shipping/carriers/:id/verify - Test carrier connection (stub)
router.post('/carriers/:id/verify', authenticateAdmin, async (req, res) => {
    try {
        const filter = toIdFilter(req.params.id);
        if (!filter) return res.status(400).json({ success: false, error: 'Invalid carrier id' });
        const credsResult = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: CARRIER_INTEGRATIONS_COLL,
            command: '--read',
            data: filter
        });
        const list = (credsResult.success && credsResult.data) ? (Array.isArray(credsResult.data) ? credsResult.data : [credsResult.data]) : [];
        const creds = list[0];
        if (!creds) return res.status(404).json({ success: false, error: 'Carrier integration not found' });
        return res.json({
            success: true,
            verified: false,
            message: 'Carrier API test not implemented. Configure credentials in Admin; real verification will use carrier API.'
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// ---------- SHIPIT logistics (admin only; no pricing – pricing is DB) ----------
const shipitService = require('../services/shipping/shipitService');

router.post('/shipit/sync-methods', authenticateAdmin, async (req, res) => {
    try {
        const result = await shipitService.syncCarrierServices();
        if (!result.success) {
            return res.status(result.error && result.error.includes('not configured') ? 503 : 400).json({
                success: false,
                error: result.error,
                methods: result.methods || []
            });
        }
        return res.json({ success: true, methods: result.methods || [], message: 'Carrier services synced from SHIPIT' });
    } catch (e) {
        console.error('[adminShipping] SHIPIT sync-methods error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

router.post('/shipit/sync-tracking', authenticateAdmin, async (req, res) => {
    try {
        const { trackingNumber } = req.body || {};
        if (trackingNumber) {
            const result = await shipitService.trackShipment(trackingNumber);
            if (!result.success) {
                return res.status(400).json({ success: false, error: result.error, events: result.events || [] });
            }
            return res.json({ success: true, trackingNumber, status: result.status, events: result.events || [] });
        }
        const getDBInstance = require('../vornifydb/dbInstance');
        const dbInstance = getDBInstance();
        const coll = await dbInstance.getCollection(DATABASE_NAME, 'shipments');
        const shipments = await coll.find({ trackingNumber: { $exists: true, $ne: null, $ne: '' } }).toArray();
        const updated = [];
        for (const s of shipments) {
            const tn = s.trackingNumber || s.tracking_number;
            if (!tn) continue;
            const result = await shipitService.trackShipment(tn);
            if (result.success) updated.push({ trackingNumber: tn, status: result.status });
        }
        return res.json({ success: true, synced: updated.length, updated });
    } catch (e) {
        console.error('[adminShipping] SHIPIT sync-tracking error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

module.exports = router;
