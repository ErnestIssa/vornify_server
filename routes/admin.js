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

/**
 * GET /api/admin/me
 * Get current admin profile from JWT token
 * Authentication: Requires JWT token in Authorization header
 * Returns: { success: true, data: { id, name, email, role, status } }
 */
router.get('/me', authenticateAdmin, async (req, res) => {
    try {
        // Admin info is already attached by authenticateAdmin middleware
        const adminId = req.admin.id;

        // Fetch full admin data from database
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: ObjectId.isValid(adminId) ? { _id: new ObjectId(adminId) } : { _id: adminId }
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

        // Return admin data
        res.json({
            success: true,
            data: {
                id: admin._id || admin.id,
                name: admin.name || admin.email,
                email: admin.email,
                role: admin.role || 'admin',
                status: admin.status || 'active'
            }
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

module.exports = router;

