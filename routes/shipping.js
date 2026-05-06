/**
 * Shipping routes – checkout delivery options only.
 * All data from database (zones, methods, prices, free areas) via shippingConfigService.
 * No external carrier APIs (Fraktjakt, PostNord, DHL, etc.) in this file.
 */

const express = require('express');
const router = express.Router();

// ---------- Address validation (used by POST /options) ----------

function validateDeliveryOptionsAddress(address) {
    // For delivery options we only need enough to resolve a zone/methods.
    // Street is not required to quote shipping methods.
    const required = ['postalCode', 'country'];
    const missing = required.filter(field => !address[field]);
    if (missing.length > 0) {
        throw new Error(`Missing required address fields: ${missing.join(', ')}`);
    }
}

const POSTAL_CODE_FORMATS = {
    'SE': { pattern: /^\d{5}$/, format: '5 digits', example: '11363' },
    'NO': { pattern: /^\d{4}$/, format: '4 digits', example: '0150' },
    'DK': { pattern: /^\d{4}$/, format: '4 digits', example: '2100' },
    'FI': { pattern: /^\d{5}$/, format: '5 digits', example: '00100' },
    'DE': { pattern: /^\d{5}$/, format: '5 digits', example: '10115' },
    'NL': { pattern: /^\d{4}\s?[A-Z]{2}$/i, format: '4 digits + 2 letters', example: '1012 AB' },
    'BE': { pattern: /^\d{4}$/, format: '4 digits', example: '1000' },
    'AT': { pattern: /^\d{4}$/, format: '4 digits', example: '1010' },
    'CH': { pattern: /^\d{4}$/, format: '4 digits', example: '8001' },
    'PL': { pattern: /^\d{2}-\d{3}$/, format: 'XX-XXX', example: '00-001' },
    'FR': { pattern: /^\d{5}$/, format: '5 digits', example: '75001' },
    'IT': { pattern: /^\d{5}$/, format: '5 digits', example: '00118' },
    'ES': { pattern: /^\d{5}$/, format: '5 digits', example: '28001' },
    'GB': { pattern: /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i, format: 'UK format', example: 'SW1A 1AA' },
    'US': { pattern: /^\d{5}(-\d{4})?$/, format: '5 or 9 digits', example: '10001' },
    'CA': { pattern: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i, format: 'A1A 1A1', example: 'K1A 0B1' }
};

const POSTAL_CODE_RANGES = {
    'SE': { validFirstDigits: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], ranges: {} },
    'NO': { validFirstDigits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], ranges: {} },
    'DK': { validFirstDigits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], ranges: {} }
};

const CITY_POSTAL_CODE_MAP = {
    'SE': {
        'Stockholm': { ranges: [{ start: 10000, end: 19999 }], common: ['11122', '11363', '11434', '11620'] },
        'Göteborg': { ranges: [{ start: 40000, end: 49999 }], common: ['41104', '41301'] },
        'Malmö': { ranges: [{ start: 20000, end: 29999 }], common: ['21115', '21420'] },
        'Uppsala': { ranges: [{ start: 75000, end: 75999 }], common: ['75105'] },
        'Bålsta': { ranges: [{ start: 74600, end: 74699 }], common: ['74639'] }
    },
    'NO': { 'Oslo': { ranges: [{ start: 0, end: 1299 }], common: ['0150', '0160'] }, 'Bergen': { ranges: [{ start: 5000, end: 5999 }], common: ['5003', '5014'] } },
    'DK': { 'Copenhagen': { ranges: [{ start: 1000, end: 2999 }], common: ['1050', '2100'] }, 'Aarhus': { ranges: [{ start: 8000, end: 8299 }], common: ['8000'] } }
};

function validatePostalCodeFormat(postalCode, country) {
    const countryUpper = country.toUpperCase();
    const format = POSTAL_CODE_FORMATS[countryUpper];
    if (!format) return null;
    const cleanedCode = (postalCode || '').replace(/\s+/g, '');
    if (!format.pattern.test(cleanedCode)) {
        return { valid: false, issue: 'format_invalid', message: `Postal code format invalid for ${countryUpper}. Expected: ${format.format} (e.g. ${format.example})`, field: 'postalCode' };
    }
    return null;
}

function validatePostalCodeCityMatch(postalCode, city, country) {
    if (!city || !postalCode) return null;
    const countryUpper = country.toUpperCase();
    const cityMap = CITY_POSTAL_CODE_MAP[countryUpper];
    if (!cityMap) return null;
    const normalizedCity = city.trim().toLowerCase();
    const normalizedPostalCode = parseInt((postalCode || '').replace(/\s+/g, ''), 10);
    if (isNaN(normalizedPostalCode)) return null;
    let cityData = null;
    for (const [cityName, data] of Object.entries(cityMap)) {
        if (cityName.toLowerCase() === normalizedCity) { cityData = data; break; }
    }
    if (!cityData) return null;
    const inRange = cityData.ranges.some(range => normalizedPostalCode >= range.start && normalizedPostalCode <= range.end);
    const isCommon = (cityData.common || []).includes((postalCode || '').replace(/\s+/g, ''));
    if (!inRange && !isCommon) {
        let suggestedCity = null;
        for (const [cityName, data] of Object.entries(cityMap)) {
            const inCityRange = (data.ranges || []).some(range => normalizedPostalCode >= range.start && normalizedPostalCode <= range.end);
            const isCityCommon = (data.common || []).includes((postalCode || '').replace(/\s+/g, ''));
            if (inCityRange || isCityCommon) { suggestedCity = cityName; break; }
        }
        const userMessage = suggestedCity
            ? `The postal code ${postalCode} doesn't match the city "${city}". This postal code belongs to ${suggestedCity}. Please check your address.`
            : `The postal code ${postalCode} doesn't match the city "${city}". Please verify your address.`;
        return { valid: false, issue: 'city_mismatch', message: userMessage, field: 'postalCode', suggestedCity };
    }
    return null;
}

function validateShippingAddress(address) {
    const { country, postalCode, street, city } = address || {};
    const formatError = validatePostalCodeFormat(postalCode, country);
    if (formatError) {
        return { valid: false, error: { success: false, validationError: true, error: formatError.message, field: formatError.field, details: { postalCode, country, issue: formatError.issue } } };
    }
    // IMPORTANT: Do not hard-fail on city↔postal-code mismatch here.
    // Some address providers use different spellings/municipalities, and we still want to show shipping methods.
    // We'll return a warning instead and continue.
    if (city) {
        const cityError = validatePostalCodeCityMatch(postalCode, city, country);
        if (cityError) {
            return {
                valid: true,
                warning: {
                    warningCode: 'CITY_POSTAL_MISMATCH',
                    message: cityError.message,
                    suggestedCity: cityError.suggestedCity || null,
                    details: { postalCode, city, country, issue: cityError.issue }
                }
            };
        }
    }
    const countryUpper = (country || '').toUpperCase();
    const ranges = POSTAL_CODE_RANGES[countryUpper];
    if (ranges) {
        const cleanedCode = (postalCode || '').replace(/\s+/g, '');
        const firstDigit = cleanedCode[0];
        if (firstDigit && !ranges.validFirstDigits.includes(firstDigit)) {
            return { valid: false, error: { success: false, validationError: true, error: `Postal code ${postalCode} appears invalid for ${countryUpper}`, field: 'postalCode', details: { postalCode, country: countryUpper, issue: 'postal_code_invalid' } } };
        }
    }
    return { valid: true, error: null };
}

// ---------- POST /api/shipping/options – checkout delivery options (DB only) ----------

router.post('/options', async (req, res) => {
    try {
        const { country, postalCode, street, city, currency } = req.body;
        
        if (!country || !postalCode) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: country and postalCode are required',
                errorCode: 'MISSING_REQUIRED_FIELD',
                validationError: true
            });
        }
        
        const recipientAddress = {
            country: country.toUpperCase(),
            postalCode: postalCode,
            street: street || '',
            city: city || ''
        };
        
        validateDeliveryOptionsAddress(recipientAddress);
        
        const addressValidation = validateShippingAddress(recipientAddress);
        if (!addressValidation.valid) {
            return res.status(400).json({
                ...addressValidation.error,
                errorCode: 'INVALID_ADDRESS',
                validationError: true
            });
        }
        const addressWarning = addressValidation.warning || null;

        const shippingConfigService = require('../services/shippingConfigService');
        const municipality = req.body.municipality || city || '';
        const { zone: dbZone, options: dbOptions, fromDb } = await shippingConfigService.getDeliveryOptionsFromDb(
            recipientAddress.country,
            municipality,
            currency || 'SEK'
        );

        if (fromDb && dbOptions && dbOptions.length > 0) {
            const byType = (type) => dbOptions.filter(o => (o.type || '').toLowerCase() === (type || '').toLowerCase());
            const home = [...byType('home'), ...byType('home_eco')];
            const parcelLocker = byType('parcel_locker');
            const mailbox = byType('mailbox');
            const servicePoint = byType('service_point');
            const allOptions = [...dbOptions].sort((a, b) => (a.cost || 0) - (b.cost || 0));
            return res.json({
                success: true,
                deliveryOptions: { home, servicePoint, parcelLocker, mailbox, all: allOptions },
                zone: dbZone ? (dbZone.name || dbZone._id?.toString()) : null,
                address: { country: recipientAddress.country, postalCode: recipientAddress.postalCode, street: recipientAddress.street, city: recipientAddress.city || null },
                warning: addressWarning,
                currency: (dbOptions[0] && dbOptions[0].currency) || 'SEK',
                baseCurrency: 'SEK',
                exchangeRate: 1,
                timestamp: new Date().toISOString()
            });
        }

        if (!dbZone) {
            return res.status(400).json({
                success: false,
                error: `Shipping is not available to ${recipientAddress.country}. Add a shipping zone for this country in Admin → Shipping Config.`,
                errorCode: 'SHIPPING_UNAVAILABLE',
                validationError: true,
                field: 'country'
            });
        }
        
        return res.json({
            success: true,
            deliveryOptions: { home: [], servicePoint: [], parcelLocker: [], mailbox: [], all: [] },
            zone: dbZone.name || dbZone._id?.toString(),
            address: { country: recipientAddress.country, postalCode: recipientAddress.postalCode, street: recipientAddress.street, city: recipientAddress.city || null },
            warning: addressWarning,
            currency: 'SEK',
            baseCurrency: 'SEK',
            exchangeRate: 1,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Delivery options error:', error);
        if (error.message && error.message.includes('Missing required')) {
            return res.status(400).json({ success: false, error: error.message, errorCode: 'MISSING_REQUIRED_FIELD', validationError: true });
        }
        if (error.message && (error.message.includes('postal code') || error.message.includes('address'))) {
            return res.status(400).json({ success: false, error: error.message, errorCode: 'INVALID_ADDRESS', validationError: true });
        }
        res.status(500).json({
            success: false,
            error: 'Unable to fetch delivery options. Please check your address and try again.',
            errorCode: 'SHIPPING_ERROR',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ---------- POST /api/shipping/pickup-points – SHIPIT agents (when shipping method = pickup) ----------
router.post('/pickup-points', async (req, res) => {
    try {
        const { postcode, country, serviceId } = req.body || {};
        if (!postcode || !country) {
            return res.status(400).json({
                success: false,
                error: 'postcode and country are required',
                agents: []
            });
        }
        const shipitService = require('../services/shipping/shipitService');
        const result = await shipitService.getPickupPoints(postcode, country, serviceId);
        if (!result.success) {
            return res.status(result.error && result.error.includes('not configured') ? 503 : 400).json({
                success: false,
                error: result.error || 'Failed to get pickup points',
                agents: result.agents || []
            });
        }
        return res.json({ success: true, agents: result.agents || [] });
    } catch (e) {
        console.error('Pickup points error:', e);
        return res.status(500).json({ success: false, error: e.message || 'Failed to get pickup points', agents: [] });
    }
});

module.exports = router;
