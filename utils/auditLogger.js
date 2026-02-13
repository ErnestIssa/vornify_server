const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

/**
 * Audit Logger Utility
 * Logs admin activities for compliance and forensics
 * 
 * @param {Object} params
 * @param {string} params.adminId - Admin ID (ObjectId or string)
 * @param {string} params.adminEmail - Admin email
 * @param {string} params.action - Action type (login, login_failed, invite_sent, etc.)
 * @param {Object} params.details - Action-specific details
 * @param {string} params.ipAddress - IP address
 * @param {string} params.userAgent - User agent string
 * @param {boolean} params.success - Whether action was successful
 */
async function logAdminActivity({
    adminId = null,
    adminEmail = null,
    action,
    details = {},
    ipAddress = 'unknown',
    userAgent = 'unknown',
    success = true
}) {
    try {
        const logEntry = {
            adminId: adminId,
            adminEmail: adminEmail,
            action: action,
            details: details,
            ipAddress: ipAddress || 'unknown',
            userAgent: userAgent || 'unknown',
            timestamp: new Date().toISOString(),
            success: success
        };

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admin_activity_logs',
            command: '--create',
            data: logEntry
        });

        console.log(`📝 [AUDIT LOG] ${action} - ${adminEmail || 'unknown'} - ${success ? 'SUCCESS' : 'FAILED'}`);

    } catch (error) {
        // Don't throw - audit logging failure shouldn't break the app
        console.error('❌ [AUDIT LOG] Failed to log activity:', error);
    }
}

module.exports = logAdminActivity;

