const express = require('express');
const router = express.Router();
const currencyService = require('../services/currencyService');

/**
 * GET /api/convert
 * Convert amount from one currency to another
 * Query params: amount, from, to
 */
router.get('/convert', async (req, res) => {
    try {
        const { amount, from, to } = req.query;

        // Validation
        if (!amount || !from || !to) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: amount, from, to'
            });
        }

        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum < 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount. Must be a positive number.'
            });
        }

        // Convert currency
        const result = await currencyService.convertCurrency(amountNum, from.toUpperCase(), to.toUpperCase());

        if (!result.success) {
            return res.status(200).json(result); // Still return 200, but with error flag
        }

        res.json(result);

    } catch (error) {
        console.error('Currency conversion error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * GET /api/settings/currencies
 * Get all supported currencies with current exchange rates
 */
router.get('/settings/currencies', async (req, res) => {
    try {
        const result = await currencyService.getSupportedCurrencies();
        res.json(result);
    } catch (error) {
        console.error('Error getting supported currencies:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/settings/currencies/update
 * Update exchange rates (admin only - can be called by scheduled job)
 */
router.post('/settings/currencies/update', async (req, res) => {
    try {
        const result = await currencyService.updateExchangeRates();
        
        if (!result.success) {
            return res.status(500).json(result);
        }

        res.json(result);
    } catch (error) {
        console.error('Error updating exchange rates:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router;

