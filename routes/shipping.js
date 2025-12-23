const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const { parseString } = require('xml2js');
const { promisify } = require('util');
const asyncHandler = require('../middleware/asyncHandler');
const { getLanguageFromRequest, DEFAULT_LANGUAGE } = require('../services/translationService');
const { getFixedDeliveryOptions, getShippingZone, applyZonePricingToOptions } = require('../utils/shippingZones');

const db = getDBInstance();

// Helper function to get Fraktjakt locale from request (defaults to English)
function getFraktjaktLocale(req) {
    const language = getLanguageFromRequest(req);
    // Fraktjakt supports 'en' and 'sv', default to 'en' (English)
    return language === 'sv' ? 'sv' : 'en';
}

// Use built-in fetch (available in Node.js 18+)
// No need to import node-fetch for Node.js 18+

// XML parser for Fraktjakt API
const parseXML = promisify(parseString);

// PostNord Delivery Options API configuration
const POSTNORD_DELIVERY_API = {
    baseUrl: 'https://api2.postnord.com/rest/shipment/v1/deliveryoptions/bywarehouse',
    apiKey: process.env.POSTNORD_API_KEY || '820cdd1f29a640f86a83b38d902ab39f',
    customerKey: 'PeakMode'
};

// Fraktjakt Query API configuration
const FRAKTJAKT_API = {
    baseUrl: 'https://api.fraktjakt.se/fraktjakt/query_xml',
    consignorId: process.env.FRAKTJAKT_CONSIGNOR_ID || '',
    consignorKey: process.env.FRAKTJAKT_CONSIGNOR_KEY || ''
};

// Warehouse address for Fraktjakt (hardcoded as per requirements)
const FRAKTJAKT_WAREHOUSE = {
    country: 'SE',
    postalCode: '74639',
    street: 'Kapellgatan 10',
    city: 'Bålsta'
};

// Warehouse address (sender) - MUST be configured via environment variables
// Required env vars: WAREHOUSE_COUNTRY, WAREHOUSE_POSTAL_CODE, WAREHOUSE_CITY, WAREHOUSE_STREET
const WAREHOUSE_ADDRESS = {
    countryCode: process.env.WAREHOUSE_COUNTRY,
    postalCode: process.env.WAREHOUSE_POSTAL_CODE,
    city: process.env.WAREHOUSE_CITY,
    streetName: process.env.WAREHOUSE_STREET
};

// Carrier API configurations
const CARRIER_CONFIGS = {
    postnord: {
        name: 'PostNord',
        apiUrl: process.env.POSTNORD_API_URL || 'https://api.postnord.se',
        apiKey: process.env.POSTNORD_API_KEY || POSTNORD_DELIVERY_API.apiKey,
        enabled: true
    },
    dhl: {
        name: 'DHL Express',
        apiUrl: process.env.DHL_API_URL || 'https://api-eu.dhl.com',
        apiKey: process.env.DHL_API_KEY,
        enabled: !!process.env.DHL_API_KEY
    },
    ups: {
        name: 'UPS',
        apiUrl: process.env.UPS_API_URL || 'https://onlinetools.ups.com',
        apiKey: process.env.UPS_API_KEY,
        enabled: !!process.env.UPS_API_KEY
    },
    fedex: {
        name: 'FedEx',
        apiUrl: process.env.FEDEX_API_URL || 'https://apis.fedex.com',
        apiKey: process.env.FEDEX_API_KEY,
        enabled: !!process.env.FEDEX_API_KEY
    }
};

// Helper function to calculate package weight from order items
function calculateOrderWeight(orderItems) {
    // Default weight per item (in kg) - this should be configurable per product
    const DEFAULT_ITEM_WEIGHT = 0.5;
    return orderItems.reduce((total, item) => {
        return total + (item.quantity * DEFAULT_ITEM_WEIGHT);
    }, 0);
}

// Helper function to validate address
function validateAddress(address) {
    const required = ['street', 'city', 'postalCode', 'country'];
    const missing = required.filter(field => !address[field]);
    
    if (missing.length > 0) {
        throw new Error(`Missing required address fields: ${missing.join(', ')}`);
    }
    
    return true;
}

// Helper function to validate delivery options address (minimal requirements)
function validateDeliveryOptionsAddress(address) {
    const required = ['street', 'postalCode', 'country'];
    const missing = required.filter(field => !address[field]);
    
    if (missing.length > 0) {
        throw new Error(`Missing required address fields: ${missing.join(', ')}`);
    }
    
    return true;
}

// Postal code format validation by country
const POSTAL_CODE_FORMATS = {
    'SE': { pattern: /^\d{5}$/, format: '5 digits', example: '11363' }, // Sweden
    'NO': { pattern: /^\d{4}$/, format: '4 digits', example: '0150' }, // Norway
    'DK': { pattern: /^\d{4}$/, format: '4 digits', example: '2100' }, // Denmark
    'FI': { pattern: /^\d{5}$/, format: '5 digits', example: '00100' }, // Finland
    'DE': { pattern: /^\d{5}$/, format: '5 digits', example: '10115' }, // Germany
    'NL': { pattern: /^\d{4}\s?[A-Z]{2}$/i, format: '4 digits + 2 letters', example: '1012 AB' }, // Netherlands
    'BE': { pattern: /^\d{4}$/, format: '4 digits', example: '1000' }, // Belgium
    'AT': { pattern: /^\d{4}$/, format: '4 digits', example: '1010' }, // Austria
    'CH': { pattern: /^\d{4}$/, format: '4 digits', example: '8001' }, // Switzerland
    'PL': { pattern: /^\d{2}-\d{3}$/, format: 'XX-XXX', example: '00-001' }, // Poland
    'FR': { pattern: /^\d{5}$/, format: '5 digits', example: '75001' }, // France
    'IT': { pattern: /^\d{5}$/, format: '5 digits', example: '00118' }, // Italy
    'ES': { pattern: /^\d{5}$/, format: '5 digits', example: '28001' }, // Spain
    'GB': { pattern: /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i, format: 'UK format', example: 'SW1A 1AA' }, // United Kingdom
    'US': { pattern: /^\d{5}(-\d{4})?$/, format: '5 or 9 digits', example: '10001' }, // United States
    'CA': { pattern: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i, format: 'A1A 1A1', example: 'K1A 0B1' } // Canada
};

// Postal code ranges for basic validation (first 1-2 digits indicate region)
const POSTAL_CODE_RANGES = {
    'SE': {
        // Sweden: First digit indicates region
        // 1 = Stockholm, 2 = Skåne, 3 = Gothenburg, 4 = Västra Götaland, etc.
        validFirstDigits: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
        ranges: {
            'Stockholm': { start: 10000, end: 19999 },
            'Göteborg': { start: 40000, end: 49999 },
            'Malmö': { start: 20000, end: 29999 }
        }
    },
    'NO': {
        validFirstDigits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        ranges: {
            'Oslo': { start: 0, end: 1299 },
            'Bergen': { start: 5000, end: 5999 }
        }
    },
    'DK': {
        validFirstDigits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        ranges: {
            'Copenhagen': { start: 1000, end: 2999 }
        }
    }
};

// City to postal code mapping (common cities for validation)
const CITY_POSTAL_CODE_MAP = {
    'SE': {
        'Stockholm': { ranges: [{ start: 10000, end: 19999 }], common: ['11122', '11363', '11434', '11620'] },
        'Göteborg': { ranges: [{ start: 40000, end: 49999 }], common: ['41104', '41301'] },
        'Malmö': { ranges: [{ start: 20000, end: 29999 }], common: ['21115', '21420'] },
        'Uppsala': { ranges: [{ start: 75000, end: 75999 }], common: ['75105'] },
        'Linköping': { ranges: [{ start: 58000, end: 58999 }], common: ['58183'] },
        'Örebro': { ranges: [{ start: 70000, end: 70999 }], common: ['70211'] },
        'Västerås': { ranges: [{ start: 72000, end: 72999 }], common: ['72212'] },
        'Borås': { ranges: [{ start: 50000, end: 50999 }], common: ['50333'] },
        'Bålsta': { ranges: [{ start: 74600, end: 74699 }], common: ['74639'] }
    },
    'NO': {
        'Oslo': { ranges: [{ start: 0, end: 1299 }], common: ['0150', '0160'] },
        'Bergen': { ranges: [{ start: 5000, end: 5999 }], common: ['5003', '5014'] }
    },
    'DK': {
        'Copenhagen': { ranges: [{ start: 1000, end: 2999 }], common: ['1050', '2100'] },
        'Aarhus': { ranges: [{ start: 8000, end: 8299 }], common: ['8000'] }
    }
};

/**
 * Validate postal code format for a country
 * @param {string} postalCode - Postal code to validate
 * @param {string} country - Country code (ISO 2-letter)
 * @returns {object|null} - Validation result or null if valid
 */
function validatePostalCodeFormat(postalCode, country) {
    const countryUpper = country.toUpperCase();
    const format = POSTAL_CODE_FORMATS[countryUpper];
    
    if (!format) {
        // Unknown country - accept any format
        return null;
    }
    
    // Remove spaces for validation
    const cleanedCode = postalCode.replace(/\s+/g, '');
    
    if (!format.pattern.test(cleanedCode)) {
        return {
            valid: false,
            issue: 'format_invalid',
            message: `Postal code format invalid for ${countryUpper}. Expected format: ${format.format} (e.g., ${format.example})`,
            field: 'postalCode'
        };
    }
    
    return null; // Valid
}

/**
 * Validate postal code matches city (if city is provided)
 * @param {string} postalCode - Postal code
 * @param {string} city - City name
 * @param {string} country - Country code
 * @returns {object|null} - Validation result or null if valid
 */
function validatePostalCodeCityMatch(postalCode, city, country) {
    if (!city || !postalCode) {
        return null; // Can't validate without both
    }
    
    const countryUpper = country.toUpperCase();
    const cityMap = CITY_POSTAL_CODE_MAP[countryUpper];
    
    if (!cityMap) {
        return null; // No validation data for this country
    }
    
    // Normalize city name (case-insensitive, remove accents)
    const normalizedCity = city.trim().toLowerCase();
    const normalizedPostalCode = parseInt(postalCode.replace(/\s+/g, ''));
    
    // Find matching city
    let cityData = null;
    for (const [cityName, data] of Object.entries(cityMap)) {
        if (cityName.toLowerCase() === normalizedCity) {
            cityData = data;
            break;
        }
    }
    
    if (!cityData) {
        // City not in our validation map - can't validate
        return null;
    }
    
    // Check if postal code is in any of the city's ranges
    const inRange = cityData.ranges.some(range => 
        normalizedPostalCode >= range.start && normalizedPostalCode <= range.end
    );
    
    // Also check common postal codes
    const isCommon = cityData.common.includes(postalCode.replace(/\s+/g, ''));
    
    if (!inRange && !isCommon) {
        // Find which city this postal code actually belongs to (if known)
        let suggestedCity = null;
        for (const [cityName, data] of Object.entries(cityMap)) {
            const inCityRange = data.ranges.some(range => 
                normalizedPostalCode >= range.start && normalizedPostalCode <= range.end
            );
            const isCityCommon = data.common.includes(postalCode.replace(/\s+/g, ''));
            if (inCityRange || isCityCommon) {
                suggestedCity = cityName;
                break;
            }
        }
        
        let userMessage;
        if (suggestedCity) {
            userMessage = `The postal code ${postalCode} doesn't match the city "${city}". This postal code belongs to ${suggestedCity}. Please check your address and try again.`;
        } else {
            userMessage = `The postal code ${postalCode} doesn't match the city "${city}". Please verify your address details and try again.`;
        }
        
        return {
            valid: false,
            issue: 'city_mismatch',
            message: userMessage,
            field: 'postalCode',
            suggestedCity: suggestedCity
        };
    }
    
    return null; // Valid
}

/**
 * Comprehensive address validation
 * @param {object} address - Address object with country, postalCode, street, city
 * @returns {object} - Validation result { valid: boolean, error: object|null }
 */
function validateShippingAddress(address) {
    const { country, postalCode, street, city } = address;
    
    // 1. Validate postal code format
    const formatError = validatePostalCodeFormat(postalCode, country);
    if (formatError) {
        return {
            valid: false,
            error: {
                success: false,
                validationError: true,
                error: formatError.message,
                field: formatError.field,
                details: {
                    postalCode: postalCode,
                    country: country,
                    issue: formatError.issue
                }
            }
        };
    }
    
    // 2. Validate postal code matches city (if city provided)
    if (city) {
        const cityError = validatePostalCodeCityMatch(postalCode, city, country);
        if (cityError) {
            return {
                valid: false,
                error: {
                    success: false,
                    validationError: true,
                    error: cityError.message, // User-friendly message
                    field: cityError.field,
                    suggestedCity: cityError.suggestedCity, // Include suggested city if available
                    details: {
                        postalCode: postalCode,
                        city: city,
                        country: country,
                        issue: cityError.issue
                    }
                }
            };
        }
    }
    
    // 3. Basic postal code range validation (for known countries)
    const countryUpper = country.toUpperCase();
    const ranges = POSTAL_CODE_RANGES[countryUpper];
    if (ranges) {
        const cleanedCode = postalCode.replace(/\s+/g, '');
        const firstDigit = cleanedCode[0];
        
        if (!ranges.validFirstDigits.includes(firstDigit)) {
            return {
                valid: false,
                error: {
                    success: false,
                    validationError: true,
                    error: `Postal code ${postalCode} appears invalid for ${countryUpper}`,
                    field: 'postalCode',
                    details: {
                        postalCode: postalCode,
                        country: country,
                        issue: 'postal_code_invalid'
                    }
                }
            };
        }
    }
    
    return { valid: true, error: null };
}

// Helper function to filter and format home delivery options
function filterHomeDeliveryOptions(deliveryOptions) {
    return deliveryOptions
        .filter(option => 
            option.type === 'home' ||
            option.deliveryMethod === 'HOME' || 
            option.deliveryMethod === 'HOME_DELIVERY'
        )
        .map(option => {
            const bookingInstructions = option.bookingInstructions || {};
            const descriptiveTexts = option.descriptiveTexts || {};
            const checkoutTexts = descriptiveTexts.checkout || {};
            const deliveryTime = option.deliveryTime || {};
            const dayRange = deliveryTime.dayRange || {};
            
            return {
                id: bookingInstructions.deliveryOptionId || `home_${option.type}`,
                type: 'home',
                name: checkoutTexts.title || 'Home Delivery',
                description: checkoutTexts.briefDescription || checkoutTexts.fullDescription || 'Delivery to your home address',
                fullDescription: checkoutTexts.fullDescription,
                cost: 0, // Price not in response, would need separate pricing API
                currency: 'SEK',
                estimatedDays: dayRange.days || checkoutTexts.friendlyDeliveryInfo || '2-5 business days',
                trackingEnabled: true,
                carrier: 'PostNord',
                serviceCode: bookingInstructions.serviceCode,
                deliveryOptionId: bookingInstructions.deliveryOptionId,
                sustainability: option.sustainability || {},
                originalData: option
            };
        });
}

// Helper function to filter and format service point delivery options
function filterServicePointOptions(deliveryOptions) {
    const servicePointOptions = [];
    
    deliveryOptions.forEach(option => {
        if (option.type === 'service-point' || 
            option.deliveryMethod === 'SERVICE_POINT' || 
            option.deliveryMethod === 'PICKUP_POINT') {
            
            const bookingInstructions = option.bookingInstructions || {};
            const descriptiveTexts = option.descriptiveTexts || {};
            const deliveryTime = option.deliveryTime || {};
            const location = option.location || {};
            
            // Only add default option if it has location data
            // The defaultOption from PostNord typically doesn't have location,
            // but additionalOptions do. We'll skip defaultOption without location
            // and only include the specific service point locations from additionalOptions
            if (bookingInstructions.deliveryOptionId && location && location.name) {
                const checkoutTexts = descriptiveTexts.checkout || {};
                const dayRange = deliveryTime.dayRange || {};
                
                servicePointOptions.push({
                    id: bookingInstructions.deliveryOptionId,
                    type: 'service_point',
                    name: checkoutTexts.title || 'Service Point Delivery',
                    description: checkoutTexts.briefDescription || checkoutTexts.fullDescription || 'Pick up from a nearby service point',
                    fullDescription: checkoutTexts.fullDescription,
                    cost: 0, // Price not in response
                    currency: 'SEK',
                    estimatedDays: dayRange.days || checkoutTexts.friendlyDeliveryInfo || '2-5 business days',
                    trackingEnabled: true,
                    carrier: 'PostNord',
                    serviceCode: bookingInstructions.serviceCode,
                    deliveryOptionId: bookingInstructions.deliveryOptionId,
                    location: location,
                    sustainability: option.sustainability || {},
                    isDefault: true,
                    originalData: option
                });
            }
            
            // Add additional service point options (if any)
            if (option.additionalOptions && Array.isArray(option.additionalOptions)) {
                option.additionalOptions.forEach((additionalOption, index) => {
                    if (additionalOption && additionalOption.bookingInstructions) {
                        const addBooking = additionalOption.bookingInstructions || {};
                        const addTexts = additionalOption.descriptiveTexts?.checkout || {};
                        const addTime = additionalOption.deliveryTime?.dayRange || {};
                        const addLocation = additionalOption.location || {};
                        
                        servicePointOptions.push({
                            id: addBooking.deliveryOptionId || `service_point_${index}`,
                            type: 'service_point',
                            name: addTexts.title || 'Service Point Delivery',
                            description: addTexts.briefDescription || addTexts.fullDescription || 'Pick up from a nearby service point',
                            fullDescription: addTexts.fullDescription,
                            cost: 0,
                            currency: 'SEK',
                            estimatedDays: addTime.days || addTexts.friendlyDeliveryInfo || '2-5 business days',
                            trackingEnabled: true,
                            carrier: 'PostNord',
                            serviceCode: addBooking.serviceCode,
                            deliveryOptionId: addBooking.deliveryOptionId,
                            location: addLocation,
                            sustainability: additionalOption.sustainability || {},
                            isDefault: false,
                            originalData: additionalOption
                        });
                    }
                });
            }
        }
    });
    
    return servicePointOptions;
}

// Helper function to filter and format parcel locker delivery options
function filterParcelLockerOptions(deliveryOptions) {
    const lockerOptions = [];
    
    deliveryOptions.forEach(option => {
        if (option.type === 'parcel-locker' || 
            option.deliveryMethod === 'PARCEL_LOCKER' || 
            option.deliveryMethod === 'LOCKER') {
            
            const bookingInstructions = option.bookingInstructions || {};
            const descriptiveTexts = option.descriptiveTexts || {};
            const deliveryTime = option.deliveryTime || {};
            const location = option.location || {};
            
            // Process additional options (parcel lockers usually have multiple locations)
            if (option.additionalOptions && Array.isArray(option.additionalOptions)) {
                option.additionalOptions.forEach((locker, index) => {
                    if (locker && locker.bookingInstructions) {
                        const lockerTexts = locker.descriptiveTexts?.checkout || {};
                        const lockerTime = locker.deliveryTime?.dayRange || {};
                        
                        lockerOptions.push({
                            id: locker.bookingInstructions.deliveryOptionId || `parcel_locker_${index}`,
                            type: 'parcel_locker',
                            name: lockerTexts.title || 'Parcel Locker Delivery',
                            description: lockerTexts.briefDescription || lockerTexts.fullDescription || 'Delivery to a parcel locker',
                            fullDescription: lockerTexts.fullDescription,
                            cost: 0,
                            currency: 'SEK',
                            estimatedDays: lockerTime.days || lockerTexts.friendlyDeliveryInfo || '2-5 business days',
                            trackingEnabled: true,
                            carrier: 'PostNord',
                            serviceCode: locker.bookingInstructions.serviceCode,
                            deliveryOptionId: locker.bookingInstructions.deliveryOptionId,
                            location: locker.location || {},
                            sustainability: locker.sustainability || {},
                            originalData: locker
                        });
                    }
                });
            }
        }
    });
    
    return lockerOptions;
}

// Helper function to filter and format mailbox delivery options
function filterMailboxOptions(deliveryOptions) {
    return deliveryOptions
        .filter(option => 
            option.type === 'mailbox' ||
            option.type === 'express-mailbox' ||
            option.deliveryMethod === 'MAILBOX' || 
            option.deliveryMethod === 'POSTBOX'
        )
        .map(option => {
            const bookingInstructions = option.bookingInstructions || {};
            const descriptiveTexts = option.descriptiveTexts || {};
            const checkoutTexts = descriptiveTexts.checkout || {};
            const deliveryTime = option.deliveryTime || {};
            const dayRange = deliveryTime.dayRange || {};
            
            return {
                id: bookingInstructions.deliveryOptionId || `mailbox_${option.type}`,
                type: option.type === 'express-mailbox' ? 'express_mailbox' : 'mailbox',
                name: checkoutTexts.title || (option.type === 'express-mailbox' ? 'Express Mailbox Delivery' : 'Collect at Mailbox'),
                description: checkoutTexts.briefDescription || checkoutTexts.fullDescription || 'Delivery to your mailbox',
                fullDescription: checkoutTexts.fullDescription,
                cost: 0, // Will be overridden by applyZonePricingToOptions
                currency: 'SEK',
                estimatedDays: dayRange.days || checkoutTexts.friendlyDeliveryInfo || '2-5 business days',
                trackingEnabled: false,
                carrier: 'PostNord',
                serviceCode: bookingInstructions.serviceCode,
                deliveryOptionId: bookingInstructions.deliveryOptionId,
                sustainability: option.sustainability || {},
                deliveryMethod: option.deliveryMethod || 'MAILBOX', // Ensure deliveryMethod is set for pricing
                originalData: option
            };
        });
}

// Helper function to call PostNord API
async function getPostNordQuotes(address, orderWeight, orderValue) {
    if (!CARRIER_CONFIGS.postnord.enabled) return [];
    
    try {
        // PostNord API integration would go here
        // For now, return mock data
        return [
            {
                id: 'postnord_standard',
                name: 'PostNord Standard',
                carrier: 'PostNord',
                cost: Math.max(29, Math.round(orderWeight * 15)),
                estimatedDays: '2-3 business days',
                description: 'Standard delivery within Sweden',
                trackingEnabled: true,
                carrierCode: 'POSTNORD'
            },
            {
                id: 'postnord_express',
                name: 'PostNord Express',
                carrier: 'PostNord',
                cost: Math.max(49, Math.round(orderWeight * 25)),
                estimatedDays: '1-2 business days',
                description: 'Express delivery within Sweden',
                trackingEnabled: true,
                carrierCode: 'POSTNORD'
            }
        ];
    } catch (error) {
        console.error('PostNord API error:', error);
        return [];
    }
}

// Helper function to call DHL API
async function getDHLQuotes(address, orderWeight, orderValue) {
    if (!CARRIER_CONFIGS.dhl.enabled) return [];
    
    try {
        // DHL API integration would go here
        // For now, return mock data
        return [
            {
                id: 'dhl_express',
                name: 'DHL Express',
                carrier: 'DHL',
                cost: Math.max(199, Math.round(orderWeight * 45)),
                estimatedDays: '1-3 business days',
                description: 'International express delivery',
                trackingEnabled: true,
                carrierCode: 'DHL'
            }
        ];
    } catch (error) {
        console.error('DHL API error:', error);
        return [];
    }
}

// Helper function to call UPS API
async function getUPSQuotes(address, orderWeight, orderValue) {
    if (!CARRIER_CONFIGS.ups.enabled) return [];
    
    try {
        // UPS API integration would go here
        // For now, return mock data
        return [
            {
                id: 'ups_standard',
                name: 'UPS Standard',
                carrier: 'UPS',
                cost: Math.max(149, Math.round(orderWeight * 35)),
                estimatedDays: '3-5 business days',
                description: 'International standard delivery',
                trackingEnabled: true,
                carrierCode: 'UPS'
            }
        ];
    } catch (error) {
        console.error('UPS API error:', error);
        return [];
    }
}

// Helper function to call FedEx API
async function getFedExQuotes(address, orderWeight, orderValue) {
    if (!CARRIER_CONFIGS.fedex.enabled) return [];
    
    try {
        // FedEx API integration would go here
        // For now, return mock data
        return [
            {
                id: 'fedex_express',
                name: 'FedEx Express',
                carrier: 'FedEx',
                cost: Math.max(179, Math.round(orderWeight * 40)),
                estimatedDays: '2-4 business days',
                description: 'International express delivery',
                trackingEnabled: true,
                carrierCode: 'FEDEX'
            }
        ];
    } catch (error) {
        console.error('FedEx API error:', error);
        return [];
    }
}

// POST /api/shipping/quotes - Get shipping quotes
router.post('/quotes', async (req, res) => {
    try {
        const { address, orderWeight, orderValue, orderItems } = req.body;
        
        // Validate required fields
        if (!address) {
            return res.status(400).json({
                success: false,
                error: 'Address is required'
            });
        }
        
        // Validate address
        validateAddress(address);
        
        // Calculate weight if not provided
        const weight = orderWeight || (orderItems ? calculateOrderWeight(orderItems) : 1);
        const value = orderValue || 0;
        
        // Get quotes from all enabled carriers
        const allQuotes = await Promise.all([
            getPostNordQuotes(address, weight, value),
            getDHLQuotes(address, weight, value),
            getUPSQuotes(address, weight, value),
            getFedExQuotes(address, weight, value)
        ]);
        
        // Flatten and sort quotes by cost
        const methods = allQuotes.flat().sort((a, b) => a.cost - b.cost);
        
        // Calculate valid until (24 hours from now)
        const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        
        res.json({
            success: true,
            methods,
            currency: 'SEK',
            validUntil,
            address: {
                street: address.street,
                city: address.city,
                postalCode: address.postalCode,
                country: address.country,
                fullAddress: address.fullAddress || `${address.street}, ${address.postalCode} ${address.city}, ${address.country}`
            }
        });
        
    } catch (error) {
        console.error('Shipping quotes error:', error);
        res.status(400).json({
            success: false,
            error: error.message || 'Failed to get shipping quotes'
        });
    }
});

// GET /api/shipping/methods - Get available shipping methods (for admin)
router.get('/methods', async (req, res) => {
    try {
        const methods = Object.values(CARRIER_CONFIGS).map(carrier => ({
            id: carrier.name.toLowerCase().replace(' ', '_'),
            name: carrier.name,
            enabled: carrier.enabled,
            apiUrl: carrier.apiUrl
        }));
        
        res.json({
            success: true,
            data: methods
        });
    } catch (error) {
        console.error('Get shipping methods error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get shipping methods'
        });
    }
});

// POST /api/shipping/validate-address - Validate shipping address
router.post('/validate-address', async (req, res) => {
    try {
        const { address } = req.body;
        
        if (!address) {
            return res.status(400).json({
                success: false,
                error: 'Address is required'
            });
        }
        
        validateAddress(address);
        
        // Address validation logic would go here
        // For now, return success
        res.json({
            success: true,
            valid: true,
            normalizedAddress: {
                street: address.street,
                city: address.city,
                postalCode: address.postalCode,
                country: address.country,
                fullAddress: `${address.street}, ${address.postalCode} ${address.city}, ${address.country}`
            }
        });
        
    } catch (error) {
        console.error('Address validation error:', error);
        res.status(400).json({
            success: false,
            error: error.message || 'Invalid address'
        });
    }
});

// POST /api/shipping/calculate-weight - Calculate package weight
router.post('/calculate-weight', async (req, res) => {
    try {
        const { orderItems } = req.body;
        
        if (!orderItems || !Array.isArray(orderItems)) {
            return res.status(400).json({
                success: false,
                error: 'Order items array is required'
            });
        }
        
        const weight = calculateOrderWeight(orderItems);
        
        res.json({
            success: true,
            weight,
            unit: 'kg'
        });
        
    } catch (error) {
        console.error('Weight calculation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to calculate weight'
        });
    }
});

// POST /api/shipping/options - Get PostNord delivery options with zone-based pricing
router.post('/options', async (req, res) => {
    try {
        const { country, postalCode, street, city, currency } = req.body;
        
        // Validate required fields
        if (!country || !postalCode || !street) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: country, postalCode, and street are required'
            });
        }
        
        // Prepare recipient address
        const recipientAddress = {
            country: country.toUpperCase(),
            postalCode: postalCode,
            street: street,
            city: city || '' // City is optional for PostNord API
        };
        
        // Validate required fields
        validateDeliveryOptionsAddress(recipientAddress);
        
        // Comprehensive address validation
        const addressValidation = validateShippingAddress(recipientAddress);
        if (!addressValidation.valid) {
            const errorResponse = {
                ...addressValidation.error,
                errorCode: 'INVALID_ADDRESS',
                validationError: true
            };
            return res.status(400).json(errorResponse);
        }
        
        // Determine shipping zone based on country (for pricing)
        const zone = getShippingZone(recipientAddress.country);
        
        if (!zone) {
            return res.status(400).json({
                success: false,
                error: `Shipping is not available to ${recipientAddress.country}. We currently ship to Sweden and EU countries only.`,
                errorCode: 'SHIPPING_UNAVAILABLE',
                validationError: true,
                field: 'country',
                details: `Country code ${recipientAddress.country} is not in our shipping zones.`
            });
        }
        
        // Validate warehouse address is configured
        if (!WAREHOUSE_ADDRESS.countryCode || !WAREHOUSE_ADDRESS.postalCode || 
            !WAREHOUSE_ADDRESS.city || !WAREHOUSE_ADDRESS.streetName) {
            return res.status(500).json({
                success: false,
                error: 'Warehouse address not configured. Please set WAREHOUSE_COUNTRY, WAREHOUSE_POSTAL_CODE, WAREHOUSE_CITY, and WAREHOUSE_STREET environment variables.'
            });
        }
        
        // Prepare request body for PostNord API (correct format according to PostNord support)
        const requestBody = {
            warehouses: [
                {
                    id: "warehouse1",
                    address: {
                        postCode: WAREHOUSE_ADDRESS.postalCode,
                        street: WAREHOUSE_ADDRESS.streetName,
                        city: WAREHOUSE_ADDRESS.city,
                        countryCode: WAREHOUSE_ADDRESS.countryCode
                    },
                    orderHandling: {
                        daysUntilOrderIsReady: "0-2"
                    }
                }
            ],
            customer: {
                customerKey: POSTNORD_DELIVERY_API.customerKey
            },
            recipient: {
                address: {
                    postCode: recipientAddress.postalCode,
                    countryCode: recipientAddress.country
                }
            }
        };
        
        // Add street and city to recipient address if provided (optional fields)
        if (recipientAddress.street) {
            requestBody.recipient.address.street = recipientAddress.street;
        }
        if (recipientAddress.city) {
            requestBody.recipient.address.city = recipientAddress.city;
        }
        
        // Build API URL with API key as query parameter (not header)
        const apiUrl = `${POSTNORD_DELIVERY_API.baseUrl}?apikey=${POSTNORD_DELIVERY_API.apiKey}`;
        
        // Make request to PostNord API
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        // Check if request was successful
        if (!response.ok) {
            const errorText = await response.text();
            console.error('PostNord API error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            
            // Provide more helpful error messages
            let errorMessage = 'Failed to fetch delivery options from PostNord';
            if (response.status === 403) {
                errorMessage = 'Access forbidden. This may be caused by missing or incorrect customerKey, or invalid sender address. Please verify your PostNord API key, customerKey, and warehouse address configuration.';
            } else if (response.status === 401) {
                errorMessage = 'Unauthorized. Please check your PostNord API key is correctly set.';
            } else if (response.status === 400) {
                errorMessage = 'Bad request. Please verify the request format and field names are correct.';
            }
            
            return res.status(response.status).json({
                success: false,
                error: errorMessage,
                status: response.status,
                details: errorText
            });
        }
        
        // Parse response
        const data = await response.json();
        
        // Extract delivery options from response
        // PostNord API response structure: warehouseToDeliveryOptions array
        let deliveryOptions = [];
        
        // PostNord returns: { warehouseToDeliveryOptions: [{ warehouse: {...}, deliveryOptions: [...] }] }
        if (data.warehouseToDeliveryOptions && Array.isArray(data.warehouseToDeliveryOptions)) {
            // Extract delivery options from all warehouses
            data.warehouseToDeliveryOptions.forEach(warehouseData => {
                if (warehouseData.deliveryOptions && Array.isArray(warehouseData.deliveryOptions)) {
                    // Each delivery option has: type, defaultOption, additionalOptions
                    warehouseData.deliveryOptions.forEach(option => {
                        // Add default option with type preserved
                        if (option.defaultOption) {
                            deliveryOptions.push({
                                ...option.defaultOption,
                                type: option.type,
                                isDefault: true,
                                additionalOptions: option.additionalOptions || []
                            });
                        } else {
                            // If no defaultOption, add the option itself with type
                            deliveryOptions.push({
                                ...option,
                                type: option.type,
                                isDefault: false
                            });
                        }
                    });
                }
            });
        } else if (data.deliveryOptions && Array.isArray(data.deliveryOptions)) {
            deliveryOptions = data.deliveryOptions;
        } else if (Array.isArray(data)) {
            deliveryOptions = data;
        }
        
        // Process delivery options using helper functions (maintains existing structure)
        let homeDelivery = filterHomeDeliveryOptions(deliveryOptions);
        let servicePoint = filterServicePointOptions(deliveryOptions);
        let parcelLocker = filterParcelLockerOptions(deliveryOptions);
        let mailbox = filterMailboxOptions(deliveryOptions);
        
        // Log zone detection for debugging
        console.log('📦 [SHIPPING] Zone detected:', zone, 'for country:', recipientAddress.country);
        console.log('📦 [SHIPPING] Options before pricing:', {
            home: homeDelivery.length,
            servicePoint: servicePoint.length,
            parcelLocker: parcelLocker.length,
            mailbox: mailbox.length
        });
        
        // Apply zone-based pricing to all options (SECURE - server-side calculation)
        if (zone) {
            homeDelivery = applyZonePricingToOptions(homeDelivery, zone);
            servicePoint = applyZonePricingToOptions(servicePoint, zone);
            parcelLocker = applyZonePricingToOptions(parcelLocker, zone);
            mailbox = applyZonePricingToOptions(mailbox, zone);
            
            // Log pricing application
            console.log('📦 [SHIPPING] Pricing applied. Sample home delivery cost:', homeDelivery[0]?.cost);
            console.log('📦 [SHIPPING] Sample parcel locker cost:', parcelLocker[0]?.cost);
            console.log('📦 [SHIPPING] Sample mailbox cost:', mailbox[0]?.cost);
            
            // Verify all mailbox options have prices
            const mailboxWithoutPrice = mailbox.filter(opt => !opt.cost || opt.cost === 0);
            if (mailboxWithoutPrice.length > 0) {
                console.error('❌ [SHIPPING] Mailbox options without prices:', mailboxWithoutPrice.map(opt => ({
                    id: opt.id,
                    type: opt.type,
                    name: opt.name
                })));
            }
        } else {
            console.error('⚠️ [SHIPPING] Zone is undefined! Cannot apply pricing.');
        }
        
        // Combine all options for 'all' array
        const allOptions = [
            ...homeDelivery,
            ...servicePoint,
            ...parcelLocker,
            ...mailbox
        ];
        
        // Ensure all options have zone and pricing applied
        if (!zone) {
            console.error('❌ [SHIPPING] Zone is undefined! Cannot apply pricing. Country:', recipientAddress.country);
            return res.status(400).json({
                success: false,
                error: 'Shipping not available to this country',
                errorCode: 'SHIPPING_UNAVAILABLE',
                details: `Shipping is only available to Sweden (SE) and EU countries. Country code: ${recipientAddress.country}`,
                field: 'country'
            });
        }
        
        // Verify pricing was applied (at least one option should have cost > 0)
        const hasPricing = allOptions.some(opt => opt.cost > 0);
        if (!hasPricing && allOptions.length > 0) {
            console.error('❌ [SHIPPING] No pricing applied to options!', {
                zone: zone,
                optionsCount: allOptions.length,
                sampleOption: allOptions[0]
            });
        }
        
        // Convert shipping prices to requested currency if different from SEK
        let finalOptions = allOptions;
        let finalHomeDelivery = homeDelivery;
        let finalServicePoint = servicePoint;
        let finalParcelLocker = parcelLocker;
        let finalMailbox = mailbox;
        let responseCurrency = 'SEK';
        let exchangeRate = 1.0;
        
        if (currency && currency.toUpperCase() !== 'SEK') {
            try {
                const currencyService = require('../services/currencyService');
                const conversionResult = await currencyService.convertCurrency(100, 'SEK', currency.toUpperCase());
                
                if (conversionResult.success) {
                    exchangeRate = conversionResult.rate;
                    responseCurrency = currency.toUpperCase();
                    
                    // Helper function to convert option costs
                    const convertOption = (option) => ({
                        ...option,
                        cost: Math.round(option.cost * exchangeRate * 100) / 100,
                        currency: responseCurrency,
                        baseCost: option.cost, // Keep original SEK cost
                        baseCurrency: 'SEK',
                        exchangeRate: exchangeRate
                    });
                    
                    // Convert all option arrays
                    finalHomeDelivery = homeDelivery.map(convertOption);
                    finalServicePoint = servicePoint.map(convertOption);
                    finalParcelLocker = parcelLocker.map(convertOption);
                    finalMailbox = mailbox.map(convertOption);
                    finalOptions = allOptions.map(convertOption);
                    
                    console.log(`💱 [SHIPPING] Converted shipping prices from SEK to ${responseCurrency} at rate ${exchangeRate}`);
                } else {
                    console.warn(`⚠️ [SHIPPING] Currency conversion failed, using SEK:`, conversionResult.error);
                }
            } catch (currencyError) {
                console.error('❌ [SHIPPING] Currency conversion error:', currencyError);
                // Continue with SEK if conversion fails
            }
        }
        
        // Return formatted response (maintains existing structure for frontend compatibility)
        res.json({
            success: true,
            deliveryOptions: {
                home: finalHomeDelivery,
                servicePoint: finalServicePoint,
                parcelLocker: finalParcelLocker,
                mailbox: finalMailbox,
                all: finalOptions
            },
            zone: zone, // Include zone for frontend reference (always "SE" or "EU")
            address: {
                country: recipientAddress.country,
                postalCode: recipientAddress.postalCode,
                street: recipientAddress.street,
                city: recipientAddress.city || null
            },
            warehouse: {
                countryCode: WAREHOUSE_ADDRESS.countryCode,
                postalCode: WAREHOUSE_ADDRESS.postalCode,
                city: WAREHOUSE_ADDRESS.city,
                streetName: WAREHOUSE_ADDRESS.streetName
            },
            currency: responseCurrency,
            baseCurrency: 'SEK',
            exchangeRate: exchangeRate,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Delivery options error:', error);
        
        // Check if it's a validation error
        if (error.message && error.message.includes('Missing required')) {
            return res.status(400).json({
                success: false,
                error: error.message,
                errorCode: 'MISSING_REQUIRED_FIELD',
                validationError: true
            });
        }
        
        // Check if it's an address validation error
        if (error.message && (error.message.includes('postal code') || error.message.includes('address'))) {
            return res.status(400).json({
                success: false,
                error: error.message,
                errorCode: 'INVALID_ADDRESS',
                validationError: true
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Unable to fetch delivery options. Please check your address and try again.',
            errorCode: 'SHIPPING_ERROR',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Helper function to build Fraktjakt XML request
function buildFraktjaktXML(recipient, parcel) {
    // Build consignor section with ID and key if available
    let consignorSection = '<consignor>';
    if (FRAKTJAKT_API.consignorId) {
        consignorSection += `<id>${FRAKTJAKT_API.consignorId}</id>`;
    }
    if (FRAKTJAKT_API.consignorKey) {
        consignorSection += `<key>${FRAKTJAKT_API.consignorKey}</key>`;
    }
    consignorSection += `
        <address_to>
            <street_address_1>${escapeXML(FRAKTJAKT_WAREHOUSE.street)}</street_address_1>
            <postal_code>${FRAKTJAKT_WAREHOUSE.postalCode}</postal_code>
            <city>${escapeXML(FRAKTJAKT_WAREHOUSE.city)}</city>
            <country_code>${FRAKTJAKT_WAREHOUSE.country}</country_code>
        </address_to>
    </consignor>`;
    
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<shipment>
    ${consignorSection}
    <consignee>
        <address_to>
            <street_address_1>${escapeXML(recipient.street)}</street_address_1>
            <postal_code>${recipient.postalCode}</postal_code>
            <city>${escapeXML(recipient.city || '')}</city>
            <country_code>${recipient.country}</country_code>
        </address_to>
    </consignee>
    <parcels>
        <parcel>
            <weight>${parcel.weight || 1.0}</weight>
            <length>${parcel.length || 30}</length>
            <width>${parcel.width || 20}</width>
            <height>${parcel.height || 10}</height>
        </parcel>
    </parcels>
</shipment>`;
    return xml;
}

// Helper function to escape XML special characters
function escapeXML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Helper function to parse Fraktjakt XML response
function parseFraktjaktResponse(xmlData) {
    return new Promise((resolve, reject) => {
        parseXML(xmlData, { explicitArray: false, mergeAttrs: true }, (err, result) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(result);
        });
    });
}

// Helper function to format Fraktjakt delivery options for frontend
function formatFraktjaktOptions(parsedXML) {
    const options = [];
    
    try {
        // Fraktjakt response structure
        const shipment = parsedXML.shipment || parsedXML.Shipment || parsedXML;
        
        // Extract shipment metadata (id and access_code) for Service Point Selector API
        const shipmentId = shipment.id || shipment.Id || shipment.id;
        const accessCode = shipment.access_code || shipment.AccessCode || shipment.accessCode || shipment.access_code;
        
        // Check if there's an error
        if (shipment.status === 'error' && shipment.error_message) {
            console.error('Fraktjakt API error:', shipment.error_message);
            return { options: [], shipmentId: null, accessCode: null };
        }
        
        const shippingProducts = shipment.shipping_products || shipment.ShippingProducts || shipment.shippingProducts;
        
        if (!shippingProducts) {
            return { options: [], shipmentId: shipmentId || null, accessCode: accessCode || null };
        }
        
        // Handle both single product and array of products
        // Fraktjakt uses 'shipping_product' (singular) as the array name
        let products = [];
        if (shippingProducts.shipping_product) {
            products = Array.isArray(shippingProducts.shipping_product) 
                ? shippingProducts.shipping_product 
                : [shippingProducts.shipping_product];
        } else if (shippingProducts.ShippingProduct) {
            products = Array.isArray(shippingProducts.ShippingProduct) 
                ? shippingProducts.ShippingProduct 
                : [shippingProducts.ShippingProduct];
        } else if (shippingProducts.product) {
            products = Array.isArray(shippingProducts.product) 
                ? shippingProducts.product 
                : [shippingProducts.product];
        }
        
        products.forEach((product, index) => {
            if (!product) return;
            
            // Extract carrier name from description (format: "Carrier Name - Service Name")
            const description = product.description || product.Description || '';
            const carrierMatch = description.match(/^([^-]+)/);
            const carrier = carrierMatch ? carrierMatch[1].trim() : 'Unknown Carrier';
            
            const serviceName = product.name || product.Name || 'Standard Delivery';
            const price = parseFloat(product.price || product.Price || 0);
            const arrivalTime = product.arrival_time || product.ArrivalTime || product.arrivalTime || '2-5 business days';
            const serviceId = product.id || product.Id || product.id || `service_${index}`;
            const taxClass = parseFloat(product.tax_class || product.TaxClass || product.tax_class || 0);
            const agentInfo = product.agent_info || product.AgentInfo || product.agent_info || '';
            const agentLink = product.agent_link || product.AgentLink || product.agent_link || '';
            
            options.push({
                id: `fraktjakt_${serviceId}`,
                carrier: carrier,
                name: serviceName,
                description: description || `${carrier} - ${serviceName}`,
                cost: price,
                tax: taxClass,
                totalCost: price + taxClass,
                currency: shipment.currency || 'SEK',
                estimatedDays: arrivalTime,
                trackingEnabled: true,
                serviceCode: serviceId.toString(),
                serviceId: serviceId.toString(),
                agentInfo: agentInfo,
                agentLink: agentLink,
                type: 'fraktjakt',
                originalData: product,
                // Add shipment metadata for Service Point Selector API
                shipmentId: shipmentId,
                accessCode: accessCode
            });
        });
        
        return { options, shipmentId: shipmentId || null, accessCode: accessCode || null };
    } catch (error) {
        console.error('Error formatting Fraktjakt options:', error);
        return { options: [], shipmentId: null, accessCode: null };
    }
}

// POST /api/shipping/fraktjakt-options - Get Fraktjakt delivery options
router.post('/fraktjakt-options', asyncHandler(async (req, res) => {
    try {
        const { country, postalCode, street, city, weight, length, width, height } = req.body;
        
        // Validate required fields
        if (!country || !postalCode || !street) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: country, postalCode, and street are required'
            });
        }
        
        // Prepare recipient address
        const recipient = {
            country: country.toUpperCase(),
            postalCode: postalCode,
            street: street,
            city: city || ''
        };
        
        // Comprehensive address validation
        const addressValidation = validateShippingAddress(recipient);
        if (!addressValidation.valid) {
            return res.status(400).json(addressValidation.error);
        }
        
        // Prepare parcel information (with defaults)
        const parcel = {
            weight: weight || 1.0, // Default 1 kg
            length: length || 30,  // Default 30 cm
            width: width || 20,    // Default 20 cm
            height: height || 10   // Default 10 cm
        };
        
        // Check if Fraktjakt credentials are configured
        if (!FRAKTJAKT_API.consignorId || !FRAKTJAKT_API.consignorKey) {
            return res.status(500).json({
                success: false,
                error: 'Fraktjakt API credentials not configured. Please set FRAKTJAKT_CONSIGNOR_ID and FRAKTJAKT_CONSIGNOR_KEY environment variables.',
                message: 'Consignor ID and Key are required for Fraktjakt API'
            });
        }
        
        // Build XML request
        const xmlRequest = buildFraktjaktXML(recipient, parcel);
        
        // URL encode the XML
        const encodedXML = encodeURIComponent(xmlRequest);
        
        // Build the full URL
        const apiUrl = `${FRAKTJAKT_API.baseUrl}?xml=${encodedXML}`;
        
        // Log request for debugging
        console.log('Fraktjakt API Request:', {
            url: FRAKTJAKT_API.baseUrl,
            recipient: recipient,
            parcel: parcel
        });
        
        // Make GET request to Fraktjakt API
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/xml'
            }
        });
        
        // Check if request was successful
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Fraktjakt API error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            
            return res.status(response.status).json({
                success: false,
                error: 'Failed to fetch delivery options from Fraktjakt',
                status: response.status,
                details: errorText
            });
        }
        
        // Get XML response
        let xmlResponse;
        try {
            xmlResponse = await response.text();
        } catch (textError) {
            console.error('Error reading response text:', textError);
            return res.status(500).json({
                success: false,
                error: 'Failed to read response from Fraktjakt API',
                details: textError.message
            });
        }
        
        if (!xmlResponse || xmlResponse.trim().length === 0) {
            console.error('Empty response from Fraktjakt API');
            return res.status(500).json({
                success: false,
                error: 'Empty response from Fraktjakt API',
                status: response.status
            });
        }
        
        // Parse XML response
        let parsedResponse;
        try {
            parsedResponse = await parseFraktjaktResponse(xmlResponse);
        } catch (parseError) {
            console.error('XML parsing error:', parseError);
            console.error('XML Response (first 500 chars):', xmlResponse.substring(0, 500));
            return res.status(500).json({
                success: false,
                error: 'Failed to parse XML response from Fraktjakt',
                details: parseError.message,
                status: 500
            });
        }
        
        // Format delivery options
        let formattedResult;
        try {
            formattedResult = formatFraktjaktOptions(parsedResponse);
            const deliveryOptions = formattedResult.options || [];
            const shipmentId = formattedResult.shipmentId;
            const accessCode = formattedResult.accessCode;
        
            if (deliveryOptions.length === 0) {
            console.warn('No delivery options found for address:', recipient);
            return res.status(404).json({
                success: false,
                error: 'No delivery options found for the provided address',
                parsedResponse: parsedResponse, // Include for debugging
                status: 404
            });
        }
        
            // Get service points near customer address using Service Point Locator API
            // Use language from request, default to English
            const locale = getFraktjaktLocale(req);
            
            let servicePoints = [];
            try {
                const locatorUrl = `https://api.fraktjakt.se/agents/service_point_locator?locale=${locale}&consignor_id=${FRAKTJAKT_API.consignorId}&consignor_key=${FRAKTJAKT_API.consignorKey}&country=${recipient.country.toLowerCase()}${recipient.city ? `&city=${encodeURIComponent(recipient.city)}` : ''}${recipient.street ? `&street=${encodeURIComponent(recipient.street)}` : ''}${recipient.postalCode ? `&postal_code=${encodeURIComponent(recipient.postalCode)}` : ''}`;
                
                const locatorResponse = await fetch(locatorUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json, application/xml, text/xml' }
                });
                
                if (locatorResponse.ok) {
                    const locatorContentType = locatorResponse.headers.get('content-type') || '';
                    let locatorData;
                    
                    if (locatorContentType.includes('application/json')) {
                        locatorData = await locatorResponse.json();
                    } else {
                        const locatorXml = await locatorResponse.text();
                        locatorData = await parseFraktjaktResponse(locatorXml);
                    }
                    
                    // Parse agents from response (JSON format)
                    const agentsList = locatorData.agents || locatorData.Agents || [];
                    if (Array.isArray(agentsList) && agentsList.length > 0) {
                        agentsList.forEach((agent) => {
                            if (!agent) return;
                            servicePoints.push({
                                agentId: agent.id || agent.Id || agent.agent_id,
                                name: agent.name || agent.Name || 'Service Point',
                                address: {
                                    street: agent.address?.street || agent.street || agent.Street || '',
                                    city: agent.address?.city || agent.city || agent.City || '',
                                    postalCode: agent.address?.postal_code || agent.postal_code || agent.PostalCode || agent.postalCode || '',
                                    country: agent.address?.country || agent.country || agent.Country || recipient.country
                                },
                                distance: agent.distance || agent.Distance || null,
                                coordinate: agent.latitude && agent.longitude ? {
                                    latitude: agent.latitude,
                                    longitude: agent.longitude
                                } : (agent.coordinate || agent.Coordinate || null),
                                openingHours: agent.agent_operation_hours || agent.opening_hours || agent.OpeningHours || agent.openingHours || null,
                                shipper: agent.shipper || agent.Shipper || null,
                                shipperId: agent.shipper_id || agent.ShipperId || agent.shipperId || null
                            });
                        });
                    }
                }
            } catch (locatorError) {
                console.warn('Failed to fetch service points from locator API:', locatorError);
                // Continue without service points - not critical
            }
        
            // Return formatted response
            res.json({
                success: true,
                deliveryOptions: deliveryOptions,
                servicePoints: servicePoints, // Service points near customer address
                shipmentId: shipmentId,
                accessCode: accessCode,
                address: {
                    country: recipient.country,
                    postalCode: recipient.postalCode,
                    street: recipient.street,
                    city: recipient.city || null
                },
                warehouse: {
                    country: FRAKTJAKT_WAREHOUSE.country,
                    postalCode: FRAKTJAKT_WAREHOUSE.postalCode,
                    city: FRAKTJAKT_WAREHOUSE.city,
                    street: FRAKTJAKT_WAREHOUSE.street
                },
                parcel: parcel,
                currency: 'SEK',
                timestamp: new Date().toISOString()
            });
        } catch (formatError) {
            console.error('Error formatting delivery options:', formatError);
            console.error('Parsed response:', JSON.stringify(parsedResponse, null, 2));
            return res.status(500).json({
                success: false,
                error: 'Failed to format delivery options',
                details: formatError.message,
                status: 500
            });
        }
        
    } catch (error) {
        console.error('Fraktjakt delivery options error:', error);
        console.error('Error stack:', error.stack);
        console.error('Request body:', req.body);
        
        // Return proper error response
        res.status(500).json({
            success: false,
            error: 'Failed to get delivery options from Fraktjakt',
            details: error.message,
            status: 500
        });
    }
}));

// GET /api/shipping/fraktjakt-service-point-locator - Get service points near customer address
router.get('/fraktjakt-service-point-locator', asyncHandler(async (req, res) => {
    try {
        // Get language from request, default to English
        const locale = getFraktjaktLocale(req);
        
        const { country, city, street, postal_code } = req.query;
        
        // Validate required parameters
        if (!country) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter: country is required'
            });
        }
        
        // Check if Fraktjakt credentials are configured
        if (!FRAKTJAKT_API.consignorId || !FRAKTJAKT_API.consignorKey) {
            return res.status(500).json({
                success: false,
                error: 'Fraktjakt API credentials not configured. Please set FRAKTJAKT_CONSIGNOR_ID and FRAKTJAKT_CONSIGNOR_KEY environment variables.'
            });
        }
        
        // Build Service Point Locator API URL
        // Format: https://api.fraktjakt.se/agents/service_point_locator?locale=sv&consignor_id=ID&consignor_key=KEY&country=se&city=City&street=Street&postal_code=12345
        let apiUrl = `https://api.fraktjakt.se/agents/service_point_locator?locale=${locale}&consignor_id=${FRAKTJAKT_API.consignorId}&consignor_key=${FRAKTJAKT_API.consignorKey}&country=${country.toLowerCase()}`;
        
        if (city) {
            apiUrl += `&city=${encodeURIComponent(city)}`;
        }
        if (street) {
            apiUrl += `&street=${encodeURIComponent(street)}`;
        }
        if (postal_code) {
            apiUrl += `&postal_code=${encodeURIComponent(postal_code)}`;
        }
        
        // Log request for debugging
        console.log('Fraktjakt Service Point Locator API Request:', {
            url: apiUrl.replace(FRAKTJAKT_API.consignorKey, '***'),
            country: country,
            city: city,
            street: street,
            postal_code: postal_code
        });
        
        // Make GET request to Fraktjakt Service Point Locator API
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/xml, application/json, text/xml'
            }
        });
        
        // Check if request was successful
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Fraktjakt Service Point Locator API error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            
            return res.status(response.status).json({
                success: false,
                error: 'Failed to fetch service points from Fraktjakt',
                status: response.status,
                details: errorText
            });
        }
        
        // Get response (usually JSON, but can be XML)
        const contentType = response.headers.get('content-type') || '';
        let responseData;
        
        if (contentType.includes('application/json')) {
            responseData = await response.json();
        } else {
            // Parse XML response
            const xmlText = await response.text();
            responseData = await parseFraktjaktResponse(xmlText);
        }
        
        // Format agents for frontend
        const agents = [];
        try {
            // Fraktjakt Service Point Locator API returns JSON with structure:
            // { status: "ok", agents: [{ id, name, address, latitude, longitude, distance, ... }] }
            const agentsList = responseData.agents || responseData.Agents || [];
            
            if (Array.isArray(agentsList) && agentsList.length > 0) {
                agentsList.forEach((agent) => {
                    if (!agent) return;
                    
                    agents.push({
                        agentId: agent.id || agent.Id || agent.agent_id,
                        name: agent.name || agent.Name || 'Service Point',
                        address: {
                            street: agent.address?.street || agent.street || agent.Street || '',
                            city: agent.address?.city || agent.city || agent.City || '',
                            postalCode: agent.address?.postal_code || agent.postal_code || agent.PostalCode || agent.postalCode || '',
                            country: agent.address?.country || agent.country || agent.Country || country.toUpperCase()
                        },
                        distance: agent.distance || agent.Distance || null,
                        coordinate: agent.latitude && agent.longitude ? {
                            latitude: agent.latitude,
                            longitude: agent.longitude
                        } : (agent.coordinate || agent.Coordinate || null),
                        openingHours: agent.agent_operation_hours || agent.opening_hours || agent.OpeningHours || agent.openingHours || null,
                        shipper: agent.shipper || agent.Shipper || null,
                        shipperId: agent.shipper_id || agent.ShipperId || agent.shipperId || null,
                        htmlInfo: agent.html_info || agent.HtmlInfo || agent.htmlInfo || null,
                        originalData: agent
                    });
                });
            }
        } catch (parseError) {
            console.error('Error parsing agents from response:', parseError);
            console.error('Response data:', JSON.stringify(responseData, null, 2));
        }
        
        // Return response
        res.json({
            success: true,
            agents: agents,
            count: agents.length,
            address: {
                country: country,
                city: city || null,
                street: street || null,
                postal_code: postal_code || null
            },
            rawResponse: responseData,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Fraktjakt Service Point Locator error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get service points',
            details: error.message
        });
    }
}));

// GET /api/shipping/fraktjakt-service-points - Get service points using Service Point Selector API
router.get('/fraktjakt-service-points', asyncHandler(async (req, res) => {
    try {
        // Get language from request, default to English
        const locale = getFraktjaktLocale(req);
        
        const { shipment_id, access_code, agent_id } = req.query;
        
        // Validate required parameters
        if (!shipment_id || !access_code || !agent_id) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: shipment_id, access_code, and agent_id are all required'
            });
        }
        
        // Build Service Point Selector API URL
        // According to Fraktjakt support: agent_id is REQUIRED
        const apiUrl = `https://api.fraktjakt.se/agents/service_point_selector?locale=${locale}&shipment_id=${shipment_id}&access_code=${access_code}&agent_id=${agent_id}`;
        
        // Log request for debugging
        console.log('Fraktjakt Service Point Selector API Request:', {
            url: apiUrl,
            shipment_id: shipment_id,
            access_code: access_code,
            agent_id: agent_id || 'not provided'
        });
        
        // Make GET request to Fraktjakt Service Point Selector API
        // This API typically returns HTML/JavaScript for client-side service point selection
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Accept': 'text/html, application/xhtml+xml, application/xml, application/json',
                'User-Agent': 'PeakMode-Backend/1.0'
            }
        });
        
        // Check if request was successful
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Fraktjakt Service Point Selector API error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            
            return res.status(response.status).json({
                success: false,
                error: 'Failed to fetch service points from Fraktjakt',
                status: response.status,
                details: errorText
            });
        }
        
        // Get response (could be XML, JSON, or HTML)
        const contentType = response.headers.get('content-type') || '';
        let responseData;
        
        if (contentType.includes('application/json')) {
            responseData = await response.json();
        } else if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
            const xmlText = await response.text();
            responseData = await parseFraktjaktResponse(xmlText);
        } else {
            // HTML response (likely a service point selector page)
            const htmlText = await response.text();
            responseData = { html: htmlText, type: 'html' };
        }
        
        // Return response
        res.json({
            success: true,
            data: responseData,
            contentType: contentType,
            shipmentId: shipment_id,
            accessCode: access_code,
            agentId: agent_id || null,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Fraktjakt Service Point Selector error:', error);
        console.error('Error stack:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Failed to get service points from Fraktjakt',
            details: error.message,
            status: 500
        });
    }
}));


module.exports = router;
