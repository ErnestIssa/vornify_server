const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { requirePermission } = require('../middleware/requirePermission');

const db = getDBInstance();

// Get email statistics
router.get('/stats', authenticateAdmin, requirePermission('email.view'), async (req, res) => {
    try {
        // Get all email logs
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'communication_messages',
            command: '--read',
            data: {}
        });

        if (!result.success) {
            // If collection doesn't exist yet, return zero stats
            return res.json({
                success: true,
                stats: {
                    totalSent: 0,
                    delivered: 0,
                    failed: 0,
                    opened: 0,
                    byType: {
                        order: 0,
                        newsletter: 0,
                        authentication: 0,
                        customer: 0
                    }
                }
            });
        }

        const logs = Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);

        // Calculate statistics
        const totalSent = logs.length;
        const delivered = logs.filter(log => log.status === 'DELIVERED').length;
        const failed = logs.filter(log => log.status === 'FAILED' || log.status === 'DEAD_LETTER').length;
        const opened = logs.filter(log => log.status === 'OPENED').length;
        const accepted = logs.filter(log => log.status === 'ACCEPTED').length;

        const byType = {
            order: logs.filter(log => log.emailType === 'ORDER_CONFIRMATION').length,
            newsletter: logs.filter(log => String(log.emailType || '').includes('NEWSLETTER')).length,
            authentication: logs.filter(log => String(log.emailType || '').startsWith('HUB_')).length,
            customer: logs.filter(log => log.category === 'TRANSACTIONAL' && log.emailType === 'ORDER_CONFIRMATION').length,
        };

        res.json({
            success: true,
            stats: {
                totalSent,
                delivered,
                failed,
                opened,
                acceptedByProvider: accepted,
                byType
            }
        });

    } catch (error) {
        console.error('Email stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Get email logs
router.get('/logs', authenticateAdmin, requirePermission('email.view'), async (req, res) => {
    try {
        const { limit = 50, offset = 0, type = 'all' } = req.query;

        // Get all email logs
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'communication_messages',
            command: '--read',
            data: type !== 'all' ? { filter: { emailType: type } } : {}
        });

        if (!result.success) {
            // If collection doesn't exist yet, return empty logs
            return res.json({
                success: true,
                logs: [],
                total: 0
            });
        }

        let logs = Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);

        // Sort by date (newest first)
        logs.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

        // Apply pagination
        const total = logs.length;
        const paginatedLogs = logs.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

        res.json({
            success: true,
            logs: paginatedLogs,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error('Email logs error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/** @deprecated Use email orchestrator (`email_messages`). Kept for backward-compatible imports. */
async function logEmail() {
    return { success: true, skipped: true, reason: 'email_messages_is_ssot' };
}

// Export the logging function for use in other modules
router.logEmail = logEmail;

module.exports = router;

