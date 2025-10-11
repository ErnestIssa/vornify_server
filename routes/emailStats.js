const express = require('express');
const router = express.Router();
const VortexDB = require('../vornifydb/vornifydb');

const db = new VortexDB();

// Get email statistics
router.get('/stats', async (req, res) => {
    try {
        // Get all email logs
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'email_logs',
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
        const delivered = logs.filter(log => log.status === 'delivered' || log.status === 'sent').length;
        const failed = logs.filter(log => log.status === 'failed').length;
        const opened = logs.filter(log => log.status === 'opened').length;

        // Count by type
        const byType = {
            order: logs.filter(log => log.type === 'order').length,
            newsletter: logs.filter(log => log.type === 'newsletter').length,
            authentication: logs.filter(log => log.type === 'authentication').length,
            customer: logs.filter(log => log.type === 'customer').length
        };

        res.json({
            success: true,
            stats: {
                totalSent,
                delivered,
                failed,
                opened,
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
router.get('/logs', async (req, res) => {
    try {
        const { limit = 50, offset = 0, type = 'all' } = req.query;

        // Get all email logs
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'email_logs',
            command: '--read',
            data: type !== 'all' ? { filter: { type } } : {}
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

// Log email send (internal utility)
async function logEmail({ type, to, subject, template, status, error, orderId, customerId }) {
    try {
        const emailLog = {
            type: type || 'other',
            to,
            subject: subject || 'No subject',
            template: template || 'unknown',
            status: status || 'sent',
            error: error || null,
            sentAt: new Date().toISOString(),
            orderId: orderId || null,
            customerId: customerId || null
        };

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'email_logs',
            command: '--create',
            data: emailLog
        });

        return { success: true };
    } catch (error) {
        console.error('Failed to log email:', error);
        return { success: false, error: error.message };
    }
}

// Export the logging function for use in other modules
router.logEmail = logEmail;

module.exports = router;

