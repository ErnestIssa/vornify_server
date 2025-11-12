const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('../services/emailService');

const db = getDBInstance();

const VALID_CONTACT_STATUSES = new Set(['unread', 'read', 'replied']);

const normalizeStatusForStorage = (status) => {
    if (!status) return 'unread';
    const lower = status.toLowerCase();
    if (VALID_CONTACT_STATUSES.has(lower)) return lower;
    if (lower === 'new' || lower === 'pending') return 'unread';
    return 'unread';
};

const normalizeStatusForResponse = (status) => {
    if (!status) return 'unread';
    const lower = status.toLowerCase();
    if (VALID_CONTACT_STATUSES.has(lower)) return lower;
    if (lower === 'new' || lower === 'pending') return 'unread';
    return lower;
};

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

        const trimmedName = name?.trim();
        const trimmedSubject = subject?.trim();
        const normalizedEmail = email.trim().toLowerCase();
        const nowIso = new Date().toISOString();
        const ticketId = `SPT-${Date.now()}`;

        // Extract first name from full name
        const firstName = name ? name.split(' ')[0] : 'there';

        // Create support message record
        const contactMessage = {
            ticketId,
            source: 'website_contact_form',
            name: trimmedName || 'Anonymous',
            email: normalizedEmail,
            subject: trimmedSubject || 'General Inquiry',
            message,
            status: 'unread',
            createdAt: nowIso,
            updatedAt: nowIso,
            reply: null,
            repliedAt: null
        };

        // Save to database
        const dbResponse = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'contact_messages',
            command: '--create',
            data: contactMessage
        });

        if (!dbResponse.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to save support message'
            });
        }

        const insertedId =
            dbResponse.data?._id ||
            dbResponse.data?.insertedId ||
            dbResponse.insertedId ||
            null;

        const adminMessageId = insertedId ? String(insertedId) : null;
        const resolvedTicketId = ticketId || adminMessageId || `SPT-${Date.now()}`;

        console.log(`✅ Support message received from ${normalizedEmail}, ticket: ${resolvedTicketId}`);

        // Send confirmation email to customer
        try {
            await emailService.sendSupportConfirmationEmail(
                normalizedEmail,
                firstName,
                resolvedTicketId
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
                fromName: trimmedName,
                subject: trimmedSubject,
                message,
                ticketId: resolvedTicketId
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
            ticketId: resolvedTicketId,
            adminMessageId,
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

        const filter = {};
        if (status) {
            filter.status = normalizeStatusForStorage(status);
        }

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'contact_messages',
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

        messages = messages.map(message => ({
            ...message,
            status: normalizeStatusForResponse(message.status),
            updatedAt: message.updatedAt || message.createdAt,
            source: message.source || 'website_contact_form'
        }));

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
            collection_name: 'contact_messages',
            command: '--read',
            data: { filter: { _id: id } }
        });

        if (!result.success || !result.data) {
            return res.status(404).json({
                success: false,
                error: 'Support message not found'
            });
        }

        const messageRecord = {
            ...result.data,
            status: normalizeStatusForResponse(result.data.status),
            updatedAt: result.data.updatedAt || result.data.createdAt,
            source: result.data.source || 'website_contact_form'
        };

        res.json({
            success: true,
            message: messageRecord
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
        const { reply, status } = req.body;

        if (!reply && !status) {
            return res.status(400).json({
                success: false,
                error: 'Reply message or status update is required'
            });
        }

        const nowIso = new Date().toISOString();
        const updatePayload = {
            updatedAt: nowIso
        };

        if (reply) {
            updatePayload.reply = reply;
            updatePayload.repliedAt = nowIso;
            updatePayload.status = 'replied';
        }

        if (status && !reply) {
            updatePayload.status = normalizeStatusForStorage(status);
        } else if (status && reply) {
            // If both reply and status provided, ensure consistency
            updatePayload.status = normalizeStatusForStorage(status);
        }

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'contact_messages',
            command: '--update',
            data: {
                filter: { _id: id },
                update: updatePayload
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
            message: 'Support message updated successfully'
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

