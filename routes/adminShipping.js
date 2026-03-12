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

module.exports = router;
