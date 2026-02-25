const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

/** Exclude soft-deleted orders (align with orders.js) */
const NOT_DELETED_ORDER = { $or: [ { deletedAt: { $exists: false } }, { deletedAt: null } ] };

/**
 * Normalize request for orders --read by email so client filter works.
 * Orders store email in customer.email and optionally customerEmail; client may send filter: { email } or { customerEmail }.
 */
function normalizeOrdersReadByEmail(body) {
    const collection = (body.collection_name || body.collection || '').toLowerCase();
    const command = body.command;
    if (collection !== 'orders' || command !== '--read') return body;

    const query = body.data || body.filter || {};
    const email = query.email || query.customerEmail;
    if (email == null || typeof email !== 'string' || !email.trim()) return body;

    const operationBody = { ...body };
    operationBody.data = {
        $and: [
            NOT_DELETED_ORDER,
            { $or: [ { 'customer.email': email.trim() }, { customerEmail: email.trim() } ] }
        ]
    };
    return operationBody;
}

/**
 * For --read, if client sent "filter" but not "data", use filter as the query.
 */
function ensureReadData(body) {
    if (body.command !== '--read') return body;
    const hasData = body.data != null && Object.keys(body.data || {}).length > 0;
    if (hasData) return body;
    if (body.filter != null && typeof body.filter === 'object') {
        const operationBody = { ...body, data: body.filter };
        return operationBody;
    }
    return body;
}

router.post('/', async (req, res) => {
    try {
        console.log('🔍 [VORNIFYDB] Request received:', {
            database_name: req.body?.database_name,
            collection_name: req.body?.collection_name,
            command: req.body?.command,
            timestamp: new Date().toISOString()
        });

        // Validate request body
        if (!req.body) {
            console.error('❌ [VORNIFYDB] Missing request body');
            return res.status(400).json({
                success: false,
                error: 'Request body is required',
                message: 'Request body is required'
            });
        }

        // Validate required fields (accept collection_name or collection for compatibility)
        const collectionName = req.body.collection_name || req.body.collection;
        const databaseName = req.body.database_name || req.body.database;
        if (!databaseName || !collectionName || !req.body.command) {
            console.error('❌ [VORNIFYDB] Missing required fields:', {
                hasDatabase: !!databaseName,
                hasCollection: !!collectionName,
                hasCommand: !!req.body.command
            });
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                message: 'database_name (or database), collection_name (or collection), and command are required'
            });
        }

        // Check if db instance is available
        if (!db) {
            console.error('❌ [VORNIFYDB] Database instance not available');
            return res.status(500).json({
                success: false,
                error: 'Database not initialized',
                message: 'Database connection not available'
            });
        }

        // Check if executeOperation method exists
        if (typeof db.executeOperation !== 'function') {
            console.error('❌ [VORNIFYDB] executeOperation method not available');
            return res.status(500).json({
                success: false,
                error: 'Database method not available',
                message: 'executeOperation method not found'
            });
        }

        // Normalize body for executeOperation (use collection_name/database_name)
        let operationBody = {
            ...req.body,
            database_name: databaseName,
            collection_name: collectionName
        };
        operationBody = ensureReadData(operationBody);
        operationBody = normalizeOrdersReadByEmail(operationBody);

        console.log('🔍 [VORNIFYDB] Executing database operation...');
        const result = await db.executeOperation(operationBody);
        
        console.log('🔍 [VORNIFYDB] Operation result:', {
            success: result?.success !== false && result?.status !== false,
            hasData: !!result?.data,
            dataType: Array.isArray(result?.data) ? 'array' : typeof result?.data,
            dataLength: Array.isArray(result?.data) ? result.data.length : 'N/A'
        });
        
        // Convert VortexDB format to expected format
        const response = {
            success: result.status !== false && result.success !== false, // status=true becomes success=true
            ...result
        };
        
        // If there's an error message, include it
        if (result.message) {
            response.error = result.message;
        }
        
        res.json(response);
    } catch (error) {
        console.error('❌ [VORNIFYDB] Database operation error:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
            requestBody: {
                database_name: req.body?.database_name,
                collection_name: req.body?.collection_name,
                command: req.body?.command
            }
        });
        
        // Ensure response hasn't been sent
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message || 'Database operation failed'
            });
        } else {
            console.error('❌ [VORNIFYDB] Response already sent, cannot send error response');
        }
    }
});

module.exports = router; 