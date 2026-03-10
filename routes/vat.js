/**
 * VAT (MOMS) API – country and rate for the current request.
 * Used by frontend to show "VAT estimated from your location" and display prices including VAT.
 */
const express = require('express');
const router = express.Router();
const vatService = require('../services/vatService');

/**
 * GET /api/vat
 * Returns country and VAT rate for this request (Cloudflare CF-IPCountry or ?country= override).
 * Frontend can use this to display "Prices include estimated VAT of X% based on your location."
 */
router.get('/', (req, res) => {
    const { country, vatRate } = vatService.getCountryAndVatFromRequest(req);
    res.json({
        success: true,
        country,
        vatRate,
        message: 'VAT rate for display; final VAT is applied at checkout based on shipping country.'
    });
});

module.exports = router;
