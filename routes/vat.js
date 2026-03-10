/**
 * VAT (MOMS) and display currency API – country, VAT rate, and currency for the current request.
 * Used by frontend for VAT messaging and for automatic currency selection (SEK/EUR/USD).
 */
const express = require('express');
const router = express.Router();
const vatService = require('../services/vatService');
const currencySelectionService = require('../services/currencySelectionService');

/**
 * GET /api/vat
 * Returns country, VAT rate, and display currency for this request.
 * Country: Cloudflare CF-IPCountry or ?country= override.
 * Currency: ?currency= override (SEK, EUR, USD) or auto from country (SE→SEK, EU→EUR, else→USD).
 * Symbols: SEK→kr, EUR→€, USD→$ (never £).
 */
router.get('/', (req, res) => {
    const { country, vatRate } = vatService.getCountryAndVatFromRequest(req);
    const { currency, currencySymbol } = currencySelectionService.getDisplayCurrencyFromRequest(req);
    res.json({
        success: true,
        country,
        vatRate,
        currency,
        currencySymbol,
        message: 'VAT rate for display; final VAT is applied at checkout based on shipping country. Currency can be overridden with ?currency=SEK|EUR|USD.'
    });
});

module.exports = router;
