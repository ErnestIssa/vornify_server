const express = require('express');
const router = express.Router();
const StorageMonitor = require('../vornifydb/storage/storageMonitor');

const storageMonitor = new StorageMonitor();

router.post('/', async (req, res) => {
    try {
        const { database_name } = req.body;

        if (!database_name) {
            return res.status(400).json({
                status: false,
                error: 'Database name is required'
            });
        }

        const stats = await storageMonitor.getStorageStats(database_name);
        res.json(stats);
    } catch (error) {
        console.error('Storage route error:', error);
        res.status(500).json({
            status: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router; 