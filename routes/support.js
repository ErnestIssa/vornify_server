const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('../services/emailService');

const db = getDBInstance();

const CONTACT_COLLECTION = 'contact_messages';
const LEGACY_CONTACT_COLLECTION = 'support_messages';
const CONTACT_COLLECTIONS = [CONTACT_COLLECTION, LEGACY_CONTACT_COLLECTION];

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

const formatContactMessage = (message = {}, collectionTag = CONTACT_COLLECTION) => {
    const base = { ...(message || {}) };
    const createdAt = base.createdAt || base.created_at || base.dateCreated || new Date().toISOString();
    const updatedAt = base.updatedAt || base.updated_at || base.dateUpdated || createdAt;
    const ticketId = base.ticketId || base.ticket || base.id || base._id || null;

    return {
        ...base,
        ticketId,
        status: normalizeStatusForResponse(base.status),
        createdAt,
        updatedAt,
        source: base.source || (collectionTag === CONTACT_COLLECTION ? 'website_contact_form' : 'legacy_support_form'),
        _collection: collectionTag
    };
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
            collection_name: CONTACT_COLLECTION,
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

        const normalizedStatusFilter = status ? normalizeStatusForStorage(status) : null;
        const aggregatedMessages = [];

        for (const collectionName of CONTACT_COLLECTIONS) {
            try {
                const result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: collectionName,
                    command: '--read',
                    data: {}
                });

                if (!result.success) {
                    if (result.error && /not found/i.test(result.error)) {
                        continue;
                    }
                    console.warn(`⚠️ Failed to read ${collectionName}:`, result.error);
                    continue;
                }

                const collectionRecords = Array.isArray(result.data)
                    ? result.data
                    : [result.data].filter(Boolean);

                collectionRecords.forEach(record => {
                    aggregatedMessages.push(formatContactMessage(record, collectionName));
                });
            } catch (collectionError) {
                console.error(`⚠️ Error fetching ${collectionName}:`, collectionError);
            }
        }

        const filteredMessages = normalizedStatusFilter
            ? aggregatedMessages.filter(message => message.status === normalizedStatusFilter)
            : aggregatedMessages;

        filteredMessages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const total = filteredMessages.length;
        const start = parseInt(offset, 10);
        const end = start + parseInt(limit, 10);
        const paginatedMessages = filteredMessages.slice(start, end);

        res.json({
            success: true,
            messages: paginatedMessages,
            total,
            limit: parseInt(limit, 10),
            offset: parseInt(offset, 10)
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

        let fetchedMessage = null;

        for (const collectionName of CONTACT_COLLECTIONS) {
            try {
                const result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: collectionName,
                    command: '--read',
                    data: { filter: { _id: id } }
                });

                if (result.success && result.data) {
                    fetchedMessage = formatContactMessage(result.data, collectionName);
                    break;
                }
            } catch (collectionError) {
                console.error(`⚠️ Error fetching ${collectionName} record ${id}:`, collectionError);
            }
        }

        if (!fetchedMessage) {
            return res.status(404).json({
                success: false,
                error: 'Support message not found'
            });
        }

        res.json({
            success: true,
            message: fetchedMessage
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

        let existingRecord = null;
        let existingCollection = null;
        let updateFilter = { _id: id };

        for (const collectionName of CONTACT_COLLECTIONS) {
            try {
                const possibleFilters = [
                    { _id: id },
                    { id: id }
                ];

                for (const filter of possibleFilters) {
                    const fetchResult = await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: collectionName,
                        command: '--read',
                        data: { filter }
                    });

                    if (fetchResult.success && fetchResult.data) {
                        existingRecord = fetchResult.data;
                        existingCollection = collectionName;
                        updateFilter = filter;
                        break;
                    }
                }

                if (existingRecord) {
                    break;
                }
            } catch (fetchError) {
                console.error(`⚠️ Error fetching ${collectionName} record ${id}:`, fetchError);
            }
        }

        if (!existingRecord || !existingCollection) {
            return res.status(404).json({
                success: false,
                error: 'Support message not found'
            });
        }

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: existingCollection,
            command: '--update',
            data: {
                filter: updateFilter,
                update: updatePayload
            }
        });

        if (!updateResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to update support message'
            });
        }

        const rawUpdatedRecord = {
            ...existingRecord,
            ...updatePayload
        };

        const updatedMessage = formatContactMessage(rawUpdatedRecord, existingCollection);

        if (reply && updatedMessage && updatedMessage.email) {
            try {
                const emailResult = await emailService.sendSupportReplyEmail({
                    to: updatedMessage.email,
                    name: updatedMessage.name,
                    replyMessage: reply,
                    subject: updatedMessage.subject,
                    ticketId: updatedMessage.ticketId
                });

                if (!emailResult.success) {
                    console.error('⚠️ Failed to send support reply email:', emailResult.details || emailResult.error);
                }
            } catch (emailError) {
                console.error('⚠️ Error sending support reply email:', emailError);
            }
        }

        res.json({
            success: true,
            message: updatedMessage
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

