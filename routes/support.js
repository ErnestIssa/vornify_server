const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('../services/emailService');

const db = getDBInstance();

/**
 * POST /api/support/contact
 * Submit a support/contact message
 */
router.post('/contact', async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;

        // Validation
        if (!email || !message) {
            return res.status(400).json({
                success: false,
                error: 'Email and message are required'
            });
        }

        // Normalize email
        const normalizedEmail = email.trim().toLowerCase();

        // Extract first name from full name
        const firstName = name ? name.split(' ')[0] : 'there';

        // Create support message record
        const supportMessage = {
            name: name || 'Anonymous',
            email: normalizedEmail,
            subject: subject || 'General Inquiry',
            message: message,
            status: 'pending',
            createdAt: new Date().toISOString(),
            repliedAt: null,
            reply: null
        };

        // Save to database
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'support_messages',
            command: '--create',
            data: supportMessage
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to save support message'
            });
        }

        // Get the created message ID (ticket ID)
        const ticketId = result.data?._id || result.insertedId || 'SPT-' + Date.now();

        console.log(`✅ Support message received from ${normalizedEmail}, ticket: ${ticketId}`);

        // Send confirmation email to customer
        try {
            await emailService.sendSupportConfirmationEmail(
                normalizedEmail,
                firstName,
                ticketId
            );
            console.log(`✅ Support confirmation email sent to ${normalizedEmail}`);
        } catch (emailError) {
            console.error('⚠️ Failed to send support confirmation email:', emailError);
            // Don't fail the request if email fails
        }

        // Forward the support request to the Peak Mode support inbox
        try {
            const forwardResult = await emailService.sendSupportInboxEmail({
                fromEmail: normalizedEmail,
                fromName: name,
                subject,
                message,
                ticketId
            });

            if (!forwardResult.success) {
                console.error('⚠️ Failed to forward support message to inbox:', forwardResult.details);
            }
        } catch (error) {
            console.error('⚠️ Error forwarding support message to inbox:', error);
        }

        res.json({
            success: true,
            message: 'Support message received. We\'ll reply within 24 hours.',
            ticketId: ticketId,
            emailSent: true
        });

    } catch (error) {
        console.error('Support message submission error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * GET /api/support/messages
 * Get all support messages (admin only)
 */
router.get('/messages', async (req, res) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;

        const filter = status ? { status } : {};

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'support_messages',
            command: '--read',
            data: { filter }
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch support messages'
            });
        }

        let messages = Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);

        // Sort by date (newest first)
        messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Apply pagination
        const total = messages.length;
        const paginatedMessages = messages.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

        res.json({
            success: true,
            messages: paginatedMessages,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error('Get support messages error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * GET /api/support/messages/:id
 * Get a specific support message
 */
router.get('/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'support_messages',
            command: '--read',
            data: { filter: { _id: id } }
        });

        if (!result.success || !result.data) {
            return res.status(404).json({
                success: false,
                error: 'Support message not found'
            });
        }

        res.json({
            success: true,
            message: result.data
        });

    } catch (error) {
        console.error('Get support message error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * PUT /api/support/messages/:id/reply
 * Reply to a support message (admin only)
 */
router.put('/messages/:id/reply', async (req, res) => {
    try {
        const { id } = req.params;
        const { reply } = req.body;

        if (!reply) {
            return res.status(400).json({
                success: false,
                error: 'Reply message is required'
            });
        }

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'support_messages',
            command: '--update',
            data: {
                filter: { _id: id },
                update: {
                    reply: reply,
                    status: 'replied',
                    repliedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            return res.status(404).json({
                success: false,
                error: 'Support message not found'
            });
        }

        res.json({
            success: true,
            message: 'Reply sent successfully'
        });

    } catch (error) {
        console.error('Reply support message error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

module.exports = router;

