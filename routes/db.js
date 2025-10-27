const express = require('express');
const router = express.Router();
const VortexDB = require('../vornifydb/vornifydb');

const db = new VortexDB();

router.post('/', async (req, res) => {
    try {
        const result = await db.executeOperation(req.body);
        
        // Convert VortexDB format to expected format
        const response = {
            success: result.status !== false, // status=true becomes success=true
            ...result
        };
        
        // If there's an error message, include it
        if (result.message) {
            response.error = result.message;
        }
        
        res.json(response);
    } catch (error) {
        console.error('Database operation error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

module.exports = router; 