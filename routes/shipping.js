const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

// Use built-in fetch (available in Node.js 18+)
// No need to import node-fetch for Node.js 18+

// PostNord Delivery Options API configuration
const POSTNORD_DELIVERY_API = {
    apiUrl: 'https://api2.postnord.com/rest/shipment/v1/deliveryoptions/bywarehouse',
    apiKey: process.env.POSTNORD_API_KEY || '820cdd1f29a640f86a83b38d902ab39f',
    customerKey: 'PeakMode'
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

// Helper function to filter and format home delivery options
function filterHomeDeliveryOptions(deliveryOptions) {
    return deliveryOptions
        .filter(option => 
            option.deliveryMethod === 'HOME' || 
            option.deliveryMethod === 'HOME_DELIVERY' ||
            option.serviceCode?.toLowerCase().includes('home') ||
            option.serviceName?.toLowerCase().includes('home')
        )
        .map(option => ({
            id: option.serviceCode || `home_${option.deliveryMethod}`,
            type: 'home',
            name: option.serviceName || 'Home Delivery',
            description: option.description || 'Delivery to your home address',
            cost: option.price?.amount || 0,
            currency: option.price?.currency || 'SEK',
            estimatedDays: option.estimatedDeliveryTime || '2-5 business days',
            trackingEnabled: option.trackingAvailable || true,
            carrier: 'PostNord',
            deliveryMethod: option.deliveryMethod,
            originalData: option
        }));
}

// Helper function to filter and format service point delivery options
function filterServicePointOptions(deliveryOptions) {
    return deliveryOptions
        .filter(option => 
            option.deliveryMethod === 'SERVICE_POINT' || 
            option.deliveryMethod === 'PICKUP_POINT' ||
            option.serviceCode?.toLowerCase().includes('service') ||
            option.serviceCode?.toLowerCase().includes('pickup') ||
            option.serviceName?.toLowerCase().includes('service point') ||
            option.serviceName?.toLowerCase().includes('pickup')
        )
        .map(option => ({
            id: option.serviceCode || `service_point_${option.deliveryMethod}`,
            type: 'service_point',
            name: option.serviceName || 'Service Point Delivery',
            description: option.description || 'Pick up from a nearby service point',
            cost: option.price?.amount || 0,
            currency: option.price?.currency || 'SEK',
            estimatedDays: option.estimatedDeliveryTime || '2-5 business days',
            trackingEnabled: option.trackingAvailable || true,
            carrier: 'PostNord',
            deliveryMethod: option.deliveryMethod,
            servicePointInfo: option.servicePointInfo || null,
            originalData: option
        }));
}

// Helper function to filter and format parcel locker delivery options
function filterParcelLockerOptions(deliveryOptions) {
    return deliveryOptions
        .filter(option => 
            option.deliveryMethod === 'PARCEL_LOCKER' || 
            option.deliveryMethod === 'LOCKER' ||
            option.serviceCode?.toLowerCase().includes('locker') ||
            option.serviceName?.toLowerCase().includes('locker') ||
            option.serviceName?.toLowerCase().includes('paketbox')
        )
        .map(option => ({
            id: option.serviceCode || `parcel_locker_${option.deliveryMethod}`,
            type: 'parcel_locker',
            name: option.serviceName || 'Parcel Locker Delivery',
            description: option.description || 'Delivery to a parcel locker',
            cost: option.price?.amount || 0,
            currency: option.price?.currency || 'SEK',
            estimatedDays: option.estimatedDeliveryTime || '2-5 business days',
            trackingEnabled: option.trackingAvailable || true,
            carrier: 'PostNord',
            deliveryMethod: option.deliveryMethod,
            lockerInfo: option.lockerInfo || null,
            originalData: option
        }));
}

// Helper function to filter and format mailbox delivery options
function filterMailboxOptions(deliveryOptions) {
    return deliveryOptions
        .filter(option => 
            option.deliveryMethod === 'MAILBOX' || 
            option.deliveryMethod === 'POSTBOX' ||
            option.serviceCode?.toLowerCase().includes('mailbox') ||
            option.serviceCode?.toLowerCase().includes('postbox') ||
            option.serviceName?.toLowerCase().includes('mailbox') ||
            option.serviceName?.toLowerCase().includes('postbox')
        )
        .map(option => ({
            id: option.serviceCode || `mailbox_${option.deliveryMethod}`,
            type: 'mailbox',
            name: option.serviceName || 'Mailbox Delivery',
            description: option.description || 'Delivery to your mailbox',
            cost: option.price?.amount || 0,
            currency: option.price?.currency || 'SEK',
            estimatedDays: option.estimatedDeliveryTime || '2-5 business days',
            trackingEnabled: option.trackingAvailable || false,
            carrier: 'PostNord',
            deliveryMethod: option.deliveryMethod,
            originalData: option
        }));
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

// POST /api/shipping/options - Get PostNord delivery options
router.post('/options', async (req, res) => {
    try {
        const { country, postalCode, street, city } = req.body;
        
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
        
        // Validate recipient address
        validateDeliveryOptionsAddress(recipientAddress);
        
        // Validate warehouse address is configured
        if (!WAREHOUSE_ADDRESS.countryCode || !WAREHOUSE_ADDRESS.postalCode || 
            !WAREHOUSE_ADDRESS.city || !WAREHOUSE_ADDRESS.streetName) {
            return res.status(500).json({
                success: false,
                error: 'Warehouse address not configured. Please set WAREHOUSE_COUNTRY, WAREHOUSE_POSTAL_CODE, WAREHOUSE_CITY, and WAREHOUSE_STREET environment variables.'
            });
        }
        
        // Prepare request body for PostNord API (correct format)
        const requestBody = {
            sender: {
                countryCode: WAREHOUSE_ADDRESS.countryCode,
                postalCode: WAREHOUSE_ADDRESS.postalCode,
                city: WAREHOUSE_ADDRESS.city,
                streetName: WAREHOUSE_ADDRESS.streetName
            },
            recipient: {
                countryCode: recipientAddress.country,
                postalCode: recipientAddress.postalCode,
                streetName: recipientAddress.street
            },
            customerKey: POSTNORD_DELIVERY_API.customerKey
        };
        
        // Add city to recipient if provided
        if (recipientAddress.city) {
            requestBody.recipient.city = recipientAddress.city;
        }
        
        // Log request for debugging (without sensitive data)
        console.log('PostNord API Request:', {
            url: POSTNORD_DELIVERY_API.apiUrl,
            customerKey: POSTNORD_DELIVERY_API.customerKey,
            sender: requestBody.sender,
            recipient: requestBody.recipient
        });
        
        // Make request to PostNord API
        const response = await fetch(POSTNORD_DELIVERY_API.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': POSTNORD_DELIVERY_API.apiKey
            },
            body: JSON.stringify(requestBody)
        });
        
        // Check if request was successful
        if (!response.ok) {
            const errorText = await response.text();
            console.error('PostNord API error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                requestBody: requestBody
            });
            
            // Provide more helpful error messages
            let errorMessage = 'Failed to fetch delivery options from PostNord';
            if (response.status === 403) {
                errorMessage = 'Access forbidden. This may be caused by missing or incorrect customerKey, or invalid sender address. Please verify your PostNord API key, customerKey, and warehouse address configuration.';
            } else if (response.status === 401) {
                errorMessage = 'Unauthorized. Please check your PostNord API key is correctly set in the X-Api-Key header.';
            } else if (response.status === 400) {
                errorMessage = 'Bad request. Please verify the request format and field names are correct (countryCode, streetName, etc.).';
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
        // PostNord API response structure may vary, so we handle different possible formats
        let deliveryOptions = [];
        
        if (data.deliveryOptions && Array.isArray(data.deliveryOptions)) {
            deliveryOptions = data.deliveryOptions;
        } else if (Array.isArray(data)) {
            deliveryOptions = data;
        } else if (data.data && Array.isArray(data.data)) {
            deliveryOptions = data.data;
        } else if (data.servicePointInformation) {
            // If response contains service point information, extract options from there
            deliveryOptions = data.servicePointInformation.deliveryOptions || [];
        }
        
        // Process delivery options using helper functions
        const homeDelivery = filterHomeDeliveryOptions(deliveryOptions);
        const servicePoint = filterServicePointOptions(deliveryOptions);
        const parcelLocker = filterParcelLockerOptions(deliveryOptions);
        const mailbox = filterMailboxOptions(deliveryOptions);
        
        // Return formatted response
        res.json({
            success: true,
            deliveryOptions: {
                home: homeDelivery,
                servicePoint: servicePoint,
                parcelLocker: parcelLocker,
                mailbox: mailbox,
                all: deliveryOptions // Include all options for reference
            },
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
            currency: 'SEK',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Delivery options error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get delivery options',
            details: error.message
        });
    }
});

module.exports = router;
