const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

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

        // Validate required fields
        if (!req.body.database_name || !req.body.collection_name || !req.body.command) {
            console.error('❌ [VORNIFYDB] Missing required fields:', {
                hasDatabase: !!req.body.database_name,
                hasCollection: !!req.body.collection_name,
                hasCommand: !!req.body.command
            });
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                message: 'database_name, collection_name, and command are required'
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

        console.log('🔍 [VORNIFYDB] Executing database operation...');
        const result = await db.executeOperation(req.body);
        
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