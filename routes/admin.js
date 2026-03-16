const express = require('express');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const getDBInstance = require('../vornifydb/dbInstance');
const authenticateAdmin = require('../middleware/authenticateAdmin');

const router = express.Router();
const db = getDBInstance();

// JWT secret from environment variable
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET;

/**
 * DELETE /api/admin/cleanup-newsletter-subscribers
 * Remove the old newsletter_subscribers collection
 * 
 * WARNING: This will permanently delete all records in newsletter_subscribers collection
 * Only use this after verifying all data has been migrated to 'subscribers' collection
 */
router.delete('/cleanup-newsletter-subscribers', authenticateAdmin, async (req, res) => {
    try {
        console.log('🧹 [ADMIN] Starting cleanup of newsletter_subscribers collection...');
        
        // Check if collection has any records
        const checkResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--read',
            data: {}
        });

        let recordCount = 0;
        if (checkResult.success && checkResult.data) {
            const records = Array.isArray(checkResult.data) ? checkResult.data : [checkResult.data].filter(Boolean);
            recordCount = records.length;
            console.log(`📊 [ADMIN] Found ${recordCount} records in newsletter_subscribers collection`);
        }

        // Delete all records
        console.log('🗑️  [ADMIN] Deleting all records from newsletter_subscribers collection...');
        
        const deleteResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--delete',
            data: {} // Empty filter - delete all
        });

        if (deleteResult.success) {
            console.log('✅ [ADMIN] Successfully deleted records from newsletter_subscribers collection');
            
            res.json({
                success: true,
                message: `Successfully deleted ${recordCount} records from newsletter_subscribers collection`,
                recordsDeleted: recordCount,
                note: 'Collection may still exist but is now empty. To fully remove, run: db.newsletter_subscribers.drop() in MongoDB'
            });
        } else {
            console.log('⚠️  [ADMIN] Delete operation may have failed:', deleteResult);
            
            res.status(500).json({
                success: false,
                error: 'Failed to delete records',
                details: deleteResult,
                note: 'You may need to manually drop the collection in MongoDB: db.newsletter_subscribers.drop()'
            });
        }

    } catch (error) {
        console.error('❌ [ADMIN] Error during cleanup:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to cleanup collection',
            details: error.message,
            note: 'You may need to manually drop the collection in MongoDB: db.newsletter_subscribers.drop()'
        });
    }
});

/**
 * GET /api/admin/check-newsletter-subscribers
 * Check if newsletter_subscribers collection exists and has records
 */
router.get('/check-newsletter-subscribers', authenticateAdmin, async (req, res) => {
    try {
        const checkResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--read',
            data: {}
        });

        let recordCount = 0;
        let records = [];
        
        if (checkResult.success && checkResult.data) {
            records = Array.isArray(checkResult.data) ? checkResult.data : [checkResult.data].filter(Boolean);
            recordCount = records.length;
        }

        res.json({
            success: true,
            collectionExists: checkResult.success,
            recordCount: recordCount,
            records: records.slice(0, 10), // Show first 10 records as sample
            message: recordCount > 0 
                ? `Collection exists with ${recordCount} records. Use DELETE /api/admin/cleanup-newsletter-subscribers to remove them.`
                : 'Collection is empty or does not exist.'
        });

    } catch (error) {
        console.error('❌ [ADMIN] Error checking collection:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check collection',
            details: error.message
        });
    }
});

/** Normalize admin id to string for API responses */
function adminIdString(admin) {
    if (!admin) return null;
    const raw = admin._id || admin.id;
    return raw && typeof raw.toString === 'function' ? raw.toString() : String(raw);
}

/** Build profile payload for GET /me and PATCH /me responses */
function toProfileData(admin) {
    if (!admin) return null;
    return {
        id: adminIdString(admin),
        name: admin.name || admin.username || admin.email,
        email: admin.email,
        role: admin.role || 'admin',
        status: admin.status || 'active',
        avatar: admin.avatar || null,
        timezone: admin.timezone || null,
        notificationPreference: admin.notificationPreference || null,
        theme: admin.theme || null
    };
}

/** Resolve admin filter by req.admin.id */
function adminFilter(req) {
    const adminId = req.admin.id;
    return ObjectId.isValid(adminId) ? { _id: new ObjectId(adminId) } : { _id: adminId };
}

/**
 * GET /api/admin/me
 * Get current admin profile from JWT token
 * Authentication: Requires JWT token in Authorization header
 * Returns: { success: true, data: { id, name, email, role, status, avatar?, timezone?, notificationPreference?, theme? } }
 */
router.get('/me', authenticateAdmin, async (req, res) => {
    try {
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: adminFilter(req)
        });

        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;

        if (!adminResult.success || !admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }

        res.json({
            success: true,
            data: toProfileData(admin)
        });
    } catch (error) {
        console.error('❌ [ADMIN ME] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/** Allowed keys for PATCH /api/admin/me (profile update) */
const PROFILE_UPDATE_KEYS = ['name', 'avatar', 'timezone', 'notificationPreference', 'theme'];

/**
 * PATCH /api/admin/me
 * Update current admin profile (name, avatar URL, and optional settings)
 * Body: { name?, avatar?, timezone?, notificationPreference?, theme? }
 * Returns: { success: true, data: admin } (same shape as GET /me)
 */
router.patch('/me', authenticateAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const update = {};
        for (const key of PROFILE_UPDATE_KEYS) {
            if (body[key] !== undefined) {
                update[key] = body[key] === null || body[key] === '' ? null : String(body[key]).trim();
            }
        }
        if (Object.keys(update).length === 0) {
            const adminResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'admins',
                command: '--read',
                data: adminFilter(req)
            });
            const adminData = adminResult && adminResult.success ? adminResult.data : null;
            const admin = Array.isArray(adminData) ? adminData[0] : adminData;
            if (!admin) {
                return res.status(404).json({
                    success: false,
                    message: 'Admin account not found',
                    errorCode: 'ADMIN_NOT_FOUND'
                });
            }
            return res.json({ success: true, data: toProfileData(admin) });
        }

        update.updatedAt = new Date().toISOString();

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--update',
            data: {
                filter: adminFilter(req),
                update
            }
        });

        if (!updateResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Failed to update profile',
                errorCode: 'UPDATE_FAILED'
            });
        }

        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: adminFilter(req)
        });
        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;
        if (!admin) {
            return res.status(500).json({
                success: false,
                message: 'Profile updated but could not load updated data',
                errorCode: 'INTERNAL_SERVER_ERROR'
            });
        }

        res.json({
            success: true,
            data: toProfileData(admin)
        });
    } catch (error) {
        console.error('❌ [ADMIN PATCH ME] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

const ACTIVITY_LOG_MAX = 50;

/**
 * GET /api/admin/me/activity
 * Return last N activity entries (path, label, timestamp) for the logged-in admin
 */
router.get('/me/activity', authenticateAdmin, async (req, res) => {
    try {
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: adminFilter(req)
        });
        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }
        const log = Array.isArray(admin.activityLog) ? admin.activityLog : [];
        const entries = log.slice(0, ACTIVITY_LOG_MAX).map((e) => ({
            path: e.path,
            label: e.label,
            timestamp: e.timestamp
        }));
        res.json({ success: true, data: entries });
    } catch (error) {
        console.error('❌ [ADMIN ME ACTIVITY] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * POST /api/admin/me/activity
 * Append one activity entry (path, label) with current timestamp
 */
router.post('/me/activity', authenticateAdmin, async (req, res) => {
    try {
        const { path, label } = req.body || {};
        const pathStr = path != null ? String(path).trim() : '';
        const labelStr = label != null ? String(label).trim() : '';

        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: adminFilter(req)
        });
        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }

        const existingLog = Array.isArray(admin.activityLog) ? admin.activityLog : [];
        const newEntry = {
            path: pathStr,
            label: labelStr,
            timestamp: new Date().toISOString()
        };
        const newLog = [newEntry, ...existingLog].slice(0, ACTIVITY_LOG_MAX);

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--update',
            data: {
                filter: adminFilter(req),
                update: {
                    activityLog: newLog,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Failed to record activity',
                errorCode: 'UPDATE_FAILED'
            });
        }

        res.json({
            success: true,
            data: newEntry
        });
    } catch (error) {
        console.error('❌ [ADMIN ME ACTIVITY POST] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * GET /api/admin/shipments – Recent shipments for Admin Shipping Settings
 * Returns all shipments from DB, latest first. Admin auth required.
 * Query: limit (default 50), offset (default 0).
 */
router.get('/shipments', authenticateAdmin, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        const coll = await db.getCollection('peakmode', 'shipments');
        const rows = await coll.aggregate([
            { $addFields: { _sortDate: { $ifNull: ['$updated_at', { $ifNull: ['$updatedAt', { $ifNull: ['$created_at', '$createdAt'] }] }] } } },
            { $sort: { _sortDate: -1 } },
            { $skip: offset },
            { $limit: limit },
            { $project: { _sortDate: 0 } }
        ]).toArray();

        const data = rows.map((s) => {
            const last = s.updated_at || s.updatedAt || s.created_at || s.createdAt;
            return {
                shipmentId: (s._id && s._id.toString) ? s._id.toString() : (s.shipit_shipment_id || s.shipmentNumber || ''),
                orderId: s.orderId || s.order_id || '',
                carrier: s.carrier || null,
                trackingNumber: s.trackingNumber || s.tracking_number || null,
                shipmentStatus: s.status || s.shipmentStatus || 'pending',
                lastUpdate: last || null,
                estimatedDelivery: s.estimatedDelivery || null,
                origin: s.origin || null,
                destination: s.destination || null
            };
        });

        return res.json({ success: true, data });
    } catch (e) {
        console.error('[admin] GET /shipments error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Failed to load shipments' });
    }
});

module.exports = router;

