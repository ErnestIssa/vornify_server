const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('../services/emailService');
const { ObjectId } = require('mongodb');

const db = getDBInstance();

// Debug middleware to log all requests to support routes
router.use((req, res, next) => {
    console.log(`🔍 [SUPPORT ROUTES] ${req.method} ${req.path} - Original URL: ${req.originalUrl}`);
    console.log(`   Params:`, req.params);
    console.log(`   Query:`, req.query);
    next();
});

const CONTACT_COLLECTION = 'contact_messages';
const LEGACY_CONTACT_COLLECTION = 'support_messages';
const CONTACT_COLLECTIONS = [CONTACT_COLLECTION, LEGACY_CONTACT_COLLECTION];

const CANONICAL_STATUSES = ['new', 'in_progress', 'replied', 'resolved', 'archived'];
const STATUS_ALIASES = {
    unread: 'new',
    read: 'in_progress',
    pending: 'in_progress',
    replied: 'replied',
    responding: 'in_progress',
    responded: 'replied',
    closed: 'resolved',
    resolved: 'resolved',
    archive: 'archived',
    archived: 'archived'
};

const PRIORITY_VALUES = ['low', 'normal', 'high', 'urgent'];
const DEFAULT_PRIORITY = 'normal';
const DEFAULT_SOURCE = 'contact';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const normalizeStatus = (status) => {
    if (!status) return 'new';
    const lower = String(status).trim().toLowerCase();
    if (CANONICAL_STATUSES.includes(lower)) {
        return lower;
    }
    if (STATUS_ALIASES[lower]) {
        return STATUS_ALIASES[lower];
    }
    return 'new';
};

const normalizePriority = (priority) => {
    if (!priority) return DEFAULT_PRIORITY;
    const lower = String(priority).trim().toLowerCase();
    if (PRIORITY_VALUES.includes(lower)) {
        return lower;
    }
    return DEFAULT_PRIORITY;
};

const normalizeSource = (source) => {
    if (!source) return DEFAULT_SOURCE;
    const lower = String(source).trim().toLowerCase();
    if (lower === 'returns_portal' || lower === 'returns') return 'returns';
    if (lower.includes('contact')) return 'contact';
    if (lower.includes('support')) return 'support';
    return lower;
};

const generateTicketId = () => `SPT-${Date.now()}`;
const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const generateNoteId = () => `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeAttachments = (attachments = []) => {
    if (!Array.isArray(attachments)) {
        return [];
    }

    return attachments
        .map((attachment, index) => {
            if (!attachment) return null;

            if (typeof attachment === 'string') {
                return {
                    name: `attachment_${index + 1}`,
                    url: attachment,
                    mimeType: 'application/octet-stream',
                    size: null
                };
            }

            const name = attachment.name || attachment.filename || attachment.originalname || `attachment_${index + 1}`;
            const url = attachment.url || attachment.path || attachment.location || attachment.secure_url;

            if (!url) {
                return null;
            }

            return {
                name,
                url,
                mimeType: attachment.mimeType || attachment.type || attachment.contentType || 'application/octet-stream',
                size: attachment.size ? Number(attachment.size) : null
            };
        })
        .filter(Boolean);
};

const buildThreadEntry = ({
    authorType,
    authorName,
    authorEmail,
    message,
    attachments,
    channel = 'web_form',
    sentAt,
    metadata = {}
}) => {
    if (!message) {
        return null;
    }

    return {
        id: generateMessageId(),
        authorType,
        authorName: authorName || null,
        authorEmail: authorEmail || null,
        message,
        attachments: normalizeAttachments(attachments),
        channel,
        status: authorType === 'customer' ? 'received' : 'sent',
        sentAt: sentAt || new Date().toISOString(),
        metadata
    };
};

const buildHistoryEntry = (action, actor = 'system', details = {}) => ({
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action,
    actor,
    timestamp: new Date().toISOString(),
    ...details
});

const buildCustomerInfo = (record = {}) => {
    const customerObj = typeof record.customer === 'object' && record.customer !== null ? record.customer : {};

    return {
        name: record.name || record.customerName || customerObj.name || 'Peak Mode Customer',
        email: record.email || record.customerEmail || customerObj.email || '',
        phone: record.phone || customerObj.phone || record.customerPhone || '',
        orderId: record.orderId || customerObj.orderId || record.orderNumber || null,
        country: customerObj.country || record.country || null
    };
};

const ensureThreadArray = (record, collectionName) => {
    const createdAt = record.createdAt || record.dateCreated || new Date().toISOString();
    const source = normalizeSource(record.source || (collectionName === CONTACT_COLLECTION ? 'contact' : 'legacy'));

    if (Array.isArray(record.thread) && record.thread.length) {
        return record.thread.map(entry => ({
            ...entry,
            id: entry.id || generateMessageId(),
            status: entry.status || (entry.authorType === 'customer' ? 'received' : 'sent'),
            attachments: normalizeAttachments(entry.attachments),
            sentAt: entry.sentAt || entry.createdAt || createdAt
        }));
    }

    const normalizedAttachments = normalizeAttachments(record.attachments || record.files || []);
    const thread = [];

    if (record.message) {
        thread.push(
            buildThreadEntry({
                authorType: 'customer',
                authorName: record.name,
                authorEmail: record.email,
                message: record.message,
                attachments: normalizedAttachments,
                channel: source === 'returns' ? 'returns_form' : 'web_form',
                sentAt: createdAt
            })
        );
    }

    if (record.reply) {
        thread.push(
            buildThreadEntry({
                authorType: 'agent',
                authorName: record.assignedAgent?.name || 'Peak Mode Support',
                authorEmail: record.assignedAgent?.email || 'support@peakmode.se',
                message: record.reply,
                attachments: normalizeAttachments(record.replyAttachments),
                channel: 'email',
                sentAt: record.repliedAt || record.updatedAt || new Date().toISOString()
            })
        );
    }

    return thread;
};

const mapRecordToConversation = (record = {}, collectionName = CONTACT_COLLECTION) => {
    if (!record) return null;

    const createdAt = record.createdAt || record.dateCreated || new Date().toISOString();
    const updatedAt = record.updatedAt || record.dateUpdated || createdAt;
    const ticketId = record.ticketId || record.ticket || record.id || record._id || generateTicketId();
    const source = normalizeSource(record.source || (collectionName === CONTACT_COLLECTION ? 'contact' : 'legacy'));
    const status = normalizeStatus(record.status);
    const priority = normalizePriority(record.priority);
    const attachments = normalizeAttachments(record.attachments || record.files || []);
    const thread = ensureThreadArray(record, collectionName);
    const notes = Array.isArray(record.notes) ? record.notes : [];
    const history = Array.isArray(record.history) ? record.history : [];

    const conversation = {
        _id: record._id || record.id || ticketId,
        ticketId,
        source,
        subject: record.subject || record.topic || 'Support Request',
        body: record.body || record.message || '',
        customer: buildCustomerInfo(record),
        status,
        priority,
        assignedAgent: record.assignedAgent || null,
        tags: Array.isArray(record.tags) ? record.tags : [],
        attachments,
        createdAt,
        updatedAt,
        lastInboundAt: record.lastInboundAt || createdAt,
        lastOutboundAt: record.lastOutboundAt || record.repliedAt || null,
        thread,
        notes,
        history,
        meta: record.meta || {}
    };

    Object.defineProperty(conversation, '_collection', {
        value: collectionName,
        enumerable: false
    });

    return conversation;
};

const buildPersistencePayload = (conversation) => {
    const payload = {
        ticketId: conversation.ticketId,
        source: conversation.source,
        subject: conversation.subject,
        body: conversation.body,
        message: conversation.body,
        status: normalizeStatus(conversation.status),
        priority: normalizePriority(conversation.priority),
        tags: Array.isArray(conversation.tags) ? conversation.tags : [],
        attachments: normalizeAttachments(conversation.attachments),
        customer: conversation.customer || {},
        name: conversation.customer?.name,
        email: conversation.customer?.email,
        phone: conversation.customer?.phone,
        orderId: conversation.customer?.orderId,
        assignedAgent: conversation.assignedAgent || null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastInboundAt: conversation.lastInboundAt || conversation.createdAt,
        lastOutboundAt: conversation.lastOutboundAt || null,
        thread: Array.isArray(conversation.thread) ? conversation.thread : [],
        notes: Array.isArray(conversation.notes) ? conversation.notes : [],
        history: Array.isArray(conversation.history) ? conversation.history : [],
        meta: conversation.meta || {}
    };

    const lastAgentReply = [...(payload.thread || [])].reverse().find(entry => entry.authorType === 'agent');
    if (lastAgentReply) {
        payload.reply = lastAgentReply.message;
        payload.repliedAt = lastAgentReply.sentAt;
    }

    return payload;
};

const extractInsertedId = (dbResponse) => {
    return (
        dbResponse.data?._id ||
        dbResponse.data?.insertedId ||
        dbResponse.insertedId ||
        dbResponse.id ||
        null
    );
};

const createFilterVariants = (identifier) => {
    const filters = [
        { _id: identifier },
        { id: identifier },
        { adminMessageId: identifier },
        { ticketId: identifier }
    ];

    if (typeof identifier === 'string' && /^[0-9a-fA-F]{24}$/.test(identifier)) {
        try {
            filters.unshift({ _id: new ObjectId(identifier) });
        } catch (error) {
            console.warn(`⚠️ Unable to convert identifier ${identifier} to ObjectId:`, error.message);
        }
    }

    return filters;
};

const stripInternalFields = (conversation, { includeThread = true } = {}) => {
    if (!conversation) return conversation;

    const { _collection, ...rest } = conversation;

    if (!includeThread) {
        const { thread, ...summary } = rest;
        return summary;
    }

    return rest;
};

const buildThreadPreview = (thread = []) => {
    if (!Array.isArray(thread) || !thread.length) return [];
    return thread.slice(0, 2).map(entry => ({
        authorType: entry.authorType,
        message: entry.message
    }));
};

const buildSummaryFromConversation = (conversation) => {
    if (!conversation) return null;
    const summary = {
        ...stripInternalFields(conversation, { includeThread: false }),
        threadPreview: buildThreadPreview(conversation.thread)
    };
    return summary;
};

const parsePagination = (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || DEFAULT_PAGE, 1);
    const requestedLimit = parseInt(query.limit, 10) || DEFAULT_LIMIT;
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);

    return { page, limit };
};

const parseFilters = (query = {}) => {
    const filters = {};

    if (query.status) {
        const statuses = Array.isArray(query.status) ? query.status : String(query.status).split(',');
        filters.status = statuses.map(normalizeStatus);
    }

    if (query.source) {
        const sources = Array.isArray(query.source) ? query.source : String(query.source).split(',');
        filters.source = sources.map(normalizeSource);
    }

    if (query.assigned) {
        filters.assigned = String(query.assigned).trim();
    }

    if (query.search) {
        filters.search = String(query.search).trim().toLowerCase();
    }

    if (query.from) {
        const fromDate = new Date(query.from);
        if (!Number.isNaN(fromDate.getTime())) {
            filters.from = fromDate;
        }
    }

    if (query.to) {
        const toDate = new Date(query.to);
        if (!Number.isNaN(toDate.getTime())) {
            filters.to = toDate;
        }
    }

    if (query.priority) {
        const priorities = Array.isArray(query.priority) ? query.priority : String(query.priority).split(',');
        filters.priority = priorities.map(p => normalizePriority(p));
    }

    return filters;
};

const applyFilters = (conversations = [], filters = {}) => {
    return conversations.filter(conversation => {
        if (filters.status && filters.status.length && !filters.status.includes(conversation.status)) {
            return false;
        }

        if (filters.source && filters.source.length && !filters.source.includes(conversation.source)) {
            return false;
        }

        if (filters.priority && filters.priority.length && !filters.priority.includes(conversation.priority)) {
            return false;
        }

        if (filters.assigned) {
            if (filters.assigned === 'unassigned' && conversation.assignedAgent) {
                return false;
            }
            if (
                filters.assigned !== 'unassigned' &&
                (!conversation.assignedAgent ||
                    (conversation.assignedAgent.id !== filters.assigned &&
                        conversation.assignedAgent.email !== filters.assigned))
            ) {
                return false;
            }
        }

        if (filters.search) {
            const haystack = [
                conversation.ticketId,
                conversation.subject,
                conversation.body,
                conversation.customer?.name,
                conversation.customer?.email,
                conversation.tags?.join(' ')
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            if (!haystack.includes(filters.search)) {
                return false;
            }
        }

        if (filters.from && new Date(conversation.createdAt) < filters.from) {
            return false;
        }

        if (filters.to && new Date(conversation.createdAt) > filters.to) {
            return false;
        }

        return true;
    });
};

const buildFilterEcho = (filters = {}) => ({
    status: filters.status || [],
    source: filters.source || [],
    assigned: filters.assigned || null,
    search: filters.search || null,
    priority: filters.priority || [],
    dateRange: {
        from: filters.from ? filters.from.toISOString() : null,
        to: filters.to ? filters.to.toISOString() : null
    }
});

const buildMetaSummary = (conversations = []) => {
    const statusCounts = CANONICAL_STATUSES.reduce((acc, status) => {
        acc[status] = 0;
        return acc;
    }, {});

    const priorityCounts = PRIORITY_VALUES.reduce((acc, priority) => {
        acc[priority] = 0;
        return acc;
    }, {});

    const sourceCounts = {};

    conversations.forEach(conversation => {
        statusCounts[conversation.status] = (statusCounts[conversation.status] || 0) + 1;
        priorityCounts[conversation.priority] = (priorityCounts[conversation.priority] || 0) + 1;
        sourceCounts[conversation.source] = (sourceCounts[conversation.source] || 0) + 1;
    });

    return {
        statusCounts,
        priorityCounts,
        sourceCounts,
        unreadCount: statusCounts.new || 0
    };
};

const fetchAllConversations = async () => {
    const conversations = [];

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

            const records = Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);
            records.forEach(record => {
                const conversation = mapRecordToConversation(record, collectionName);
                if (conversation) {
                    conversations.push(conversation);
                }
            });
        } catch (error) {
            console.error(`⚠️ Error fetching ${collectionName}:`, error);
        }
    }

    return conversations;
};

const findConversationRecordById = async (identifier) => {
    console.log(`🔍 [findConversationRecordById] Looking for message: ${identifier}`);
    
    for (const collectionName of CONTACT_COLLECTIONS) {
        try {
            const filters = createFilterVariants(identifier);
            console.log(`   Checking collection: ${collectionName} with ${filters.length} filter variants`);

            for (const filter of filters) {
                // readRecords expects the query directly, not wrapped in a 'filter' property
                const result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: collectionName,
                    command: '--read',
                    data: filter  // Pass filter directly, not wrapped
                });

                if (result.success && result.data) {
                    console.log(`   ✅ Found record in ${collectionName} with filter:`, Object.keys(filter)[0]);
                    const conversation = mapRecordToConversation(result.data, collectionName);
                    if (!conversation) {
                        console.log(`   ⚠️ Failed to map conversation from record`);
                        continue;
                    }
                    console.log(`   ✅ Successfully mapped conversation - Status: ${conversation.status}, Source: ${conversation.source}`);
                    return {
                        collection: collectionName,
                        filter,
                        record: result.data,
                        conversation
                    };
                } else {
                    console.log(`   ❌ No match with filter:`, Object.keys(filter)[0]);
                }
            }
        } catch (error) {
            console.error(`⚠️ Error fetching ${collectionName} record ${identifier}:`, error);
        }
    }

    console.log(`❌ [findConversationRecordById] Message ${identifier} not found in any collection`);
    return null;
};

const persistConversation = async (collection, filter, conversation) => {
    const payload = buildPersistencePayload(conversation);
    const payloadWithoutId = { ...payload };
    delete payloadWithoutId._id;

    return db.executeOperation({
        database_name: 'peakmode',
        collection_name: collection,
        command: '--update',
        data: {
            filter,
            update: payloadWithoutId
        }
    });
};

const applyConversationUpdates = async (id, updates = {}) => {
    const recordInfo = await findConversationRecordById(id);

    if (!recordInfo) {
        return { error: 'not_found' };
    }

    const updatedConversation = { ...recordInfo.conversation };
    const nowIso = new Date().toISOString();
    let hasChanges = false;

    if (updates.status) {
        const normalized = normalizeStatus(updates.status);
        if (normalized !== updatedConversation.status) {
            updatedConversation.history = [
                ...(updatedConversation.history || []),
                buildHistoryEntry('status_change', 'admin', {
                    from: updatedConversation.status,
                    to: normalized
                })
            ];
            updatedConversation.status = normalized;
            hasChanges = true;
        }
    }

    if (updates.priority) {
        const normalizedPriority = normalizePriority(updates.priority);
        if (normalizedPriority !== updatedConversation.priority) {
            updatedConversation.priority = normalizedPriority;
            hasChanges = true;
        }
    }

    if (updates.assignedAgent !== undefined) {
        const sanitizedAgent =
            updates.assignedAgent && typeof updates.assignedAgent === 'object'
                ? {
                      id: updates.assignedAgent.id || null,
                      name: updates.assignedAgent.name || null,
                      email: updates.assignedAgent.email || null
                  }
                : null;

        updatedConversation.assignedAgent = sanitizedAgent;
        updatedConversation.history = [
            ...(updatedConversation.history || []),
            buildHistoryEntry('assignment', 'admin', {
                assignedTo: sanitizedAgent?.id || sanitizedAgent?.email || 'unassigned'
            })
        ];
        hasChanges = true;
    }

    if (Array.isArray(updates.tags)) {
        updatedConversation.tags = updates.tags.filter(Boolean);
        hasChanges = true;
    }

    if (updates.note && updates.note.trim()) {
        updatedConversation.notes = [
            ...(updatedConversation.notes || []),
            {
                id: generateNoteId(),
                authorId: 'admin',
                authorName: 'Peak Mode Admin',
                text: updates.note.trim(),
                createdAt: nowIso
            }
        ];
        hasChanges = true;
    }

    if (!hasChanges) {
        return { error: 'no_changes' };
    }

    updatedConversation.updatedAt = nowIso;

    const persistResult = await persistConversation(
        recordInfo.collection,
        recordInfo.filter,
        updatedConversation
    );

    if (!persistResult.success) {
        return { error: 'persist_failed', details: persistResult.error };
    }

    return { conversation: updatedConversation };
};

/**
 * POST /api/support/contact
 * Submit a support/contact message
 */
router.post('/contact', async (req, res) => {
    try {
        const {
            name,
            email,
            subject,
            message,
            phone,
            orderId,
            attachments = [],
            source,
            priority
        } = req.body;

        if (!email || !message) {
            return res.status(400).json({
                success: false,
                error: 'Email and message are required'
            });
        }

        const trimmedName = name?.trim() || 'Anonymous';
        const trimmedSubject = subject?.trim() || 'General Inquiry';
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedAttachments = normalizeAttachments(attachments);
        const normalizedSource = normalizeSource(source);
        const normalizedPriority = normalizePriority(priority);
        const nowIso = new Date().toISOString();
        const ticketId = generateTicketId();

        const threadEntry = buildThreadEntry({
            authorType: 'customer',
            authorName: trimmedName,
            authorEmail: normalizedEmail,
            message,
            attachments: normalizedAttachments,
            channel: normalizedSource === 'returns' ? 'returns_form' : 'web_form',
            sentAt: nowIso
        });

        const conversation = {
            ticketId,
            source: normalizedSource,
            subject: trimmedSubject,
            body: message,
            customer: {
                name: trimmedName,
            email: normalizedEmail,
                phone: phone || '',
                orderId: orderId || null
            },
            status: 'new',
            priority: normalizedPriority,
            assignedAgent: null,
            tags: [],
            attachments: normalizedAttachments,
            createdAt: nowIso,
            updatedAt: nowIso,
            lastInboundAt: nowIso,
            lastOutboundAt: null,
            thread: threadEntry ? [threadEntry] : [],
            notes: [],
            history: [
                buildHistoryEntry('created', 'customer', {
                    channel: normalizedSource === 'returns' ? 'returns_form' : 'web_form'
                })
            ],
            meta: {
                ip: req.headers['x-forwarded-for'] || req.ip,
                userAgent: req.headers['user-agent'] || null
            }
        };

        const persistencePayload = buildPersistencePayload(conversation);

        const dbResponse = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: CONTACT_COLLECTION,
            command: '--create',
            data: persistencePayload
        });

        if (!dbResponse.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to save support message'
            });
        }

        const insertedId = extractInsertedId(dbResponse);
        if (insertedId) {
            conversation._id = String(insertedId);
        }

        console.log(`✅ Support message received from ${normalizedEmail}, ticket: ${conversation.ticketId}`);

        try {
            await emailService.sendSupportConfirmationEmail(
                normalizedEmail,
                trimmedName.split(' ')[0] || 'there',
                conversation.ticketId
            );
        } catch (emailError) {
            console.error('⚠️ Failed to send support confirmation email:', emailError);
        }

        try {
            const forwardResult = await emailService.sendSupportInboxEmail({
                fromEmail: normalizedEmail,
                fromName: trimmedName,
                subject: trimmedSubject,
                message,
                ticketId: conversation.ticketId
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
            ticketId: conversation.ticketId,
            adminMessageId: conversation._id || conversation.ticketId,
            emailSent: true,
            conversation: buildSummaryFromConversation(conversation)
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
        const pagination = parsePagination(req.query);
        const filters = parseFilters(req.query);
        const allConversations = await fetchAllConversations();

        const filteredConversations = applyFilters(allConversations, filters).sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );

        const totalCount = filteredConversations.length;
        const startIndex = (pagination.page - 1) * pagination.limit;
        const pagedItems = filteredConversations.slice(startIndex, startIndex + pagination.limit);

        res.json({
            success: true,
            data: {
                items: pagedItems.map(buildSummaryFromConversation),
                page: pagination.page,
                limit: pagination.limit,
                totalPages: Math.max(Math.ceil(totalCount / pagination.limit), 1),
                totalCount,
                hasNext: startIndex + pagination.limit < totalCount,
                hasPrev: pagination.page > 1,
                sort: {
                    field: 'createdAt',
                    direction: 'desc'
                },
                filters: buildFilterEcho(filters),
                meta: buildMetaSummary(allConversations)
            }
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
 * POST/PUT /api/support/messages/:id/reply
 * Reply to a support message (admin only)
 * NOTE: This route must come BEFORE /messages/:id to avoid route conflicts
 */
const replyHandler = async (req, res) => {
    console.log(`📨 Reply handler called - Method: ${req.method}, Path: ${req.path}, ID: ${req.params.id}`);
    try {
        const { id } = req.params;
        const { message, attachments = [], cc = [], bcc = [], internalNote } = req.body || {};

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Reply message is required'
            });
        }

        const recordInfo = await findConversationRecordById(id);

        if (!recordInfo) {
            return res.status(404).json({
                success: false,
                error: 'Support message not found'
            });
        }

        const updatedConversation = { ...recordInfo.conversation };
        const nowIso = new Date().toISOString();
        const normalizedAttachments = normalizeAttachments(attachments);

        const replyEntry = buildThreadEntry({
            authorType: 'agent',
            authorName: 'Peak Mode Support',
            authorEmail: 'support@peakmode.se',
            message: message.trim(),
            attachments: normalizedAttachments,
            channel: 'admin_dashboard',
            sentAt: nowIso,
            metadata: {
                cc,
                bcc
            }
        });

        if (replyEntry) {
            updatedConversation.thread = [...(updatedConversation.thread || []), replyEntry];
        }

        if (internalNote && internalNote.trim()) {
            updatedConversation.notes = [
                ...(updatedConversation.notes || []),
                {
                    id: generateNoteId(),
                    authorId: 'admin',
                    authorName: 'Peak Mode Admin',
                    text: internalNote.trim(),
                    createdAt: nowIso
                }
            ];
        }

        updatedConversation.status = 'replied';
        updatedConversation.updatedAt = nowIso;
        updatedConversation.lastOutboundAt = nowIso;
        updatedConversation.history = [
            ...(updatedConversation.history || []),
            buildHistoryEntry('reply_sent', 'admin', { messageId: replyEntry?.id })
        ];

        const persistResult = await persistConversation(
            recordInfo.collection,
            recordInfo.filter,
            updatedConversation
        );

        if (!persistResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to save reply'
            });
        }

        if (updatedConversation.customer?.email) {
            try {
                const emailResult = await emailService.sendSupportReplyEmail({
                    to: updatedConversation.customer.email,
                    name: updatedConversation.customer.name,
                    replyMessage: message.trim(),
                    subject: updatedConversation.subject,
                    ticketId: updatedConversation.ticketId
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
            data: stripInternalFields(updatedConversation, { includeThread: true })
        });
    } catch (error) {
        console.error('Reply support message error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

// Register reply routes (must come before /messages/:id to avoid conflicts)
// Add OPTIONS handler for CORS preflight
router.options('/messages/:id/reply', (req, res) => {
    res.header('Access-Control-Allow-Methods', 'POST, PUT, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(200).end();
});
router.post('/messages/:id/reply', replyHandler);
router.put('/messages/:id/reply', replyHandler);

// Register PATCH route (must come before GET /messages/:id to avoid conflicts)
// Add OPTIONS handler for CORS preflight
router.options('/messages/:id', (req, res) => {
    res.header('Access-Control-Allow-Methods', 'PATCH, GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(200).end();
});
router.patch('/messages/:id', async (req, res) => {
    console.log(`🔄 PATCH /messages/:id hit - ID: ${req.params.id}, Updates:`, Object.keys(req.body || {}));
    try {
        const { id } = req.params;
        const updates = req.body || {};

        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No updates provided'
            });
        }

        const result = await applyConversationUpdates(id, updates);

        if (result.error === 'not_found') {
            return res.status(404).json({
                success: false,
                error: 'Support message not found'
            });
                }

        if (result.error === 'no_changes') {
            return res.status(400).json({
                success: false,
                error: 'No supported updates provided'
            });
        }

        if (result.error === 'persist_failed') {
            return res.status(500).json({
                success: false,
                error: 'Failed to update support message',
                details: result.details
            });
        }

        res.json({
            success: true,
            data: stripInternalFields(result.conversation, { includeThread: true })
        });
    } catch (error) {
        console.error('Update support message error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * GET /api/support/messages/:id
 * Get a specific support message with full thread history
 */
router.get('/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const recordInfo = await findConversationRecordById(id);

        if (!recordInfo) {
            return res.status(404).json({
                success: false,
                error: 'Support message not found'
            });
        }

        res.json({
            success: true,
            data: stripInternalFields(recordInfo.conversation, { includeThread: true })
        });
    } catch (error) {
        console.error('Get support message error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

router.post('/messages/:id/archive', async (req, res) => {
    try {
        const result = await applyConversationUpdates(req.params.id, { status: 'archived' });

        if (result.error === 'not_found') {
            return res.status(404).json({ success: false, error: 'Support message not found' });
        }

        if (result.error === 'persist_failed') {
            return res.status(500).json({
                success: false,
                error: 'Failed to archive support message',
                details: result.details
            });
        }

        res.json({
            success: true,
            data: stripInternalFields(result.conversation, { includeThread: true })
        });
    } catch (error) {
        console.error('Archive support message error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

router.post('/messages/:id/resolve', async (req, res) => {
    try {
        const result = await applyConversationUpdates(req.params.id, { status: 'resolved' });

        if (result.error === 'not_found') {
            return res.status(404).json({ success: false, error: 'Support message not found' });
        }

        if (result.error === 'persist_failed') {
            return res.status(500).json({
                success: false,
                error: 'Failed to resolve support message',
                details: result.details
            });
        }

        res.json({
            success: true,
            data: stripInternalFields(result.conversation, { includeThread: true })
        });
    } catch (error) {
        console.error('Resolve support message error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

router.post('/messages/:id/assign', async (req, res) => {
    try {
        const { agentId, agentName, agentEmail } = req.body || {};
        const result = await applyConversationUpdates(req.params.id, {
            assignedAgent: {
                id: agentId || req.body?.assignedAgent?.id || null,
                name: agentName || req.body?.assignedAgent?.name || null,
                email: agentEmail || req.body?.assignedAgent?.email || null
            }
        });

        if (result.error === 'not_found') {
            return res.status(404).json({ success: false, error: 'Support message not found' });
        }

        if (result.error === 'persist_failed') {
            return res.status(500).json({
                success: false,
                error: 'Failed to assign support message',
                details: result.details
            });
        }

        res.json({
            success: true,
            data: stripInternalFields(result.conversation, { includeThread: true })
        });
    } catch (error) {
        console.error('Assign support message error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Test route to verify router is working
router.get('/test', (req, res) => {
    res.json({ success: true, message: 'Support routes are working!' });
});

// Debug: Catch-all to see what routes are being hit
router.use('/messages*', (req, res, next) => {
    console.log(`🔍 [DEBUG] Unmatched /messages route: ${req.method} ${req.path} - Original: ${req.originalUrl}`);
    next();
});

// Log registered routes for debugging
const registeredRoutes = [
    'POST /api/support/contact',
    'GET /api/support/messages',
    'POST /api/support/messages/:id/reply',
    'PUT /api/support/messages/:id/reply',
    'PATCH /api/support/messages/:id',
    'GET /api/support/messages/:id',
    'POST /api/support/messages/:id/archive',
    'POST /api/support/messages/:id/resolve',
    'POST /api/support/messages/:id/assign',
    'GET /api/support/test'
];

console.log('✅ Support routes module loaded. Registered routes:');
registeredRoutes.forEach(route => console.log(`   ${route}`));

module.exports = router;

