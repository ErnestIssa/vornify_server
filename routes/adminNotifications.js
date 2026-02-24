const express = require('express');
const { ObjectId } = require('mongodb');
const getDBInstance = require('../vornifydb/dbInstance');
const authenticateAdmin = require('../middleware/authenticateAdmin');

const router = express.Router();
const db = getDBInstance();

const DATABASE_NAME = 'peakmode';
const COLLECTION_NAME = 'admin_notifications';

const NOTIFICATION_TYPES = ['success', 'error', 'info', 'warning'];

/**
 * Normalize document for response: ensure id is set from _id for frontend
 */
function normalizeDoc(doc) {
    if (!doc) return doc;
    const d = { ...doc };
    if (d._id != null && d.id == null) {
        d.id = typeof d._id === 'string' ? d._id : d._id.toString();
    }
    if (d._id && typeof d._id.toString === 'function') {
        d._id = d._id.toString();
    }
    return d;
}

/**
 * GET /api/admin/notifications
 * List notifications for the logged-in admin (by recipientId).
 * Query: recipientId (required) – admin user id who receives the notifications.
 * Response: Array of notification documents, newest first (createdAt desc).
 */
router.get('/notifications', authenticateAdmin, async (req, res) => {
    try {
        const recipientId = req.query.recipientId;
        if (!recipientId || typeof recipientId !== 'string' || !recipientId.trim()) {
            return res.status(400).json({
                success: false,
                error: 'recipientId is required',
                message: 'Query parameter recipientId is required'
            });
        }

        const readResult = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTION_NAME,
            command: '--read',
            data: { recipientId: recipientId.trim() }
        });

        if (!readResult.success) {
            return res.status(500).json({
                success: false,
                error: readResult.error || 'Failed to list notifications',
                message: readResult.message
            });
        }

        let list = readResult.data;
        if (!Array.isArray(list)) {
            list = list != null ? [list] : [];
        }

        list.sort((a, b) => {
            const tA = (a.createdAt && new Date(a.createdAt).getTime()) || 0;
            const tB = (b.createdAt && new Date(b.createdAt).getTime()) || 0;
            return tB - tA;
        });

        const data = list.map(normalizeDoc);
        res.json({
            success: true,
            data
        });
    } catch (error) {
        console.error('❌ [ADMIN NOTIFICATIONS] List error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list notifications',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/notifications/on-login
 * Called when an admin logs in; creates notifications for other admins (e.g. super_admins).
 * Body: { adminName: string, adminId: string }
 * Behaviour: Create one notification per recipient (e.g. all super_admin users except the one who logged in).
 * Response: { success: true }. Frontend may ignore errors.
 */
router.post('/notifications/on-login', async (req, res) => {
    try {
        const { adminName, adminId } = req.body;
        const name = adminName != null ? String(adminName).trim() : 'An admin';
        const id = adminId != null ? String(adminId).trim() : '';

        const adminsResult = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: 'admins',
            command: '--read',
            data: {}
        });

        if (!adminsResult.success || !adminsResult.data) {
            return res.json({ success: true });
        }

        let admins = adminsResult.data;
        if (!Array.isArray(admins)) {
            admins = admins ? [admins] : [];
        }

        const idStr = (a) => (a._id && a._id.toString ? a._id.toString() : String(a._id || a.id || ''));

        const recipients = admins.filter((a) => {
            const rid = idStr(a);
            return (a.role === 'super_admin' || a.role === 'admin') && rid && rid !== id;
        });

        const now = new Date().toISOString();
        const msg = `${name}${id ? ` (${id})` : ''} has logged in.`;

        for (const admin of recipients) {
            const recipientId = idStr(admin);
            await db.executeOperation({
                database_name: DATABASE_NAME,
                collection_name: COLLECTION_NAME,
                command: '--create',
                data: {
                    recipientId,
                    type: 'info',
                    message: msg,
                    fullMessage: msg,
                    createdAt: now
                }
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('❌ [ADMIN NOTIFICATIONS] on-login error:', error);
        res.json({ success: true });
    }
});

/**
 * POST /api/admin/notifications
 * Create one notification.
 * Body: { recipientId, type, message, fullMessage?, createdAt? }
 * type: one of "success" | "error" | "info" | "warning"
 * createdAt: optional ISO string; defaults to now.
 * Response: The created document (with _id / id).
 */
router.post('/notifications', authenticateAdmin, async (req, res) => {
    try {
        const { recipientId, type, message, fullMessage, createdAt } = req.body;

        if (!recipientId || typeof recipientId !== 'string' || !recipientId.trim()) {
            return res.status(400).json({
                success: false,
                error: 'recipientId is required',
                message: 'recipientId is required'
            });
        }
        if (!type || !NOTIFICATION_TYPES.includes(type)) {
            return res.status(400).json({
                success: false,
                error: `type must be one of: ${NOTIFICATION_TYPES.join(', ')}`,
                message: 'Invalid type'
            });
        }
        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: 'message is required',
                message: 'message is required'
            });
        }

        const now = new Date().toISOString();
        const doc = {
            recipientId: recipientId.trim(),
            type,
            message: message.trim(),
            fullMessage: fullMessage != null ? String(fullMessage).trim() : message.trim(),
            createdAt: createdAt && typeof createdAt === 'string' ? createdAt : now
        };

        const createResult = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTION_NAME,
            command: '--create',
            data: doc
        });

        if (!createResult.success) {
            return res.status(500).json({
                success: false,
                error: createResult.error || 'Failed to create notification',
                message: createResult.message
            });
        }

        const insertedId = createResult.data && createResult.data.insertedId;
        if (!insertedId) {
            return res.json({
                success: true,
                data: normalizeDoc({ ...doc, _id: null, id: null })
            });
        }

        const readResult = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTION_NAME,
            command: '--read',
            data: { _id: insertedId }
        });

        if (readResult.success && readResult.data) {
            const created = Array.isArray(readResult.data) ? readResult.data[0] : readResult.data;
            return res.status(201).json({
                success: true,
                data: normalizeDoc(created)
            });
        }

        res.status(201).json({
            success: true,
            data: normalizeDoc({ ...doc, _id: insertedId.toString(), id: insertedId.toString() })
        });
    } catch (error) {
        console.error('❌ [ADMIN NOTIFICATIONS] Create error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create notification',
            message: error.message
        });
    }
});

/**
 * DELETE /api/admin/notifications/:id
 * Delete one notification by id (_id).
 * Response: success and deletedCount or acknowledged so frontend can treat as success.
 */
router.delete('/notifications/:id', authenticateAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Notification id is required',
                message: 'Id is required'
            });
        }

        let query;
        if (ObjectId.isValid(id) && String(new ObjectId(id)) === id) {
            query = { _id: new ObjectId(id) };
        } else {
            query = { _id: id };
        }

        const deleteResult = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTION_NAME,
            command: '--delete',
            data: query
        });

        if (!deleteResult.success) {
            return res.status(500).json({
                success: false,
                error: deleteResult.error || 'Failed to delete notification',
                message: deleteResult.message
            });
        }

        const result = deleteResult.data;
        const deletedCount = result && result.deletedCount != null ? result.deletedCount : (result && result.acknowledged ? 1 : 0);
        res.json({
            success: true,
            acknowledged: true,
            deletedCount: deletedCount
        });
    } catch (error) {
        console.error('❌ [ADMIN NOTIFICATIONS] Delete error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete notification',
            message: error.message
        });
    }
});

module.exports = router;
