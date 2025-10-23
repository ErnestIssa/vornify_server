const express = require('express');
const router = express.Router();
const VortexDB = require('../vornifydb/vornifydb');

const db = new VortexDB();

// Carrier API configurations
const CARRIER_CONFIGS = {
    postnord: {
        name: 'PostNord',
        apiUrl: process.env.POSTNORD_API_URL || 'https://api.postnord.se',
        apiKey: process.env.POSTNORD_API_KEY,
        enabled: !!process.env.POSTNORD_API_KEY
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

module.exports = router;
