/**
 * Shipping Zone Configuration
 * Defines zones and pricing for delivery options
 */

// EU country codes (excluding Sweden)
const EU_COUNTRIES = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES'
];

/**
 * Determine shipping zone based on country code
 * @param {string} countryCode - ISO country code (e.g., 'SE', 'DK', 'DE')
 * @returns {string} - 'SE' for Sweden, 'EU' for other EU countries, null for others
 */
function getShippingZone(countryCode) {
    if (!countryCode) return null;
    
    const normalizedCountry = countryCode.toUpperCase().trim();
    
    // Zone SE: Sweden only
    if (normalizedCountry === 'SE') {
        return 'SE';
    }
    
    // Zone EU: All other EU countries
    if (EU_COUNTRIES.includes(normalizedCountry)) {
        return 'EU';
    }
    
    // Not in defined zones
    return null;
}

/**
 * Get zone-based pricing for delivery options
 * @param {string} zone - Shipping zone ('SE' or 'EU')
 * @returns {object} - Pricing object with costs for each delivery option
 */
function getZonePricing(zone) {
    const pricing = {
        SE: {
            parcelLocker: 79,
            mailbox: 79,
            eco: 79,
            home: 89
        },
        EU: {
            parcelLocker: 99,
            mailbox: 99,
            eco: 99,
            home: 109
        }
    };
    
    return pricing[zone] || null;
}

/**
 * Apply zone-based pricing to a delivery option based on its type
 * @param {object} option - Delivery option object
 * @param {string} zone - Shipping zone ('SE' or 'EU')
 * @returns {object} - Delivery option with pricing applied
 */
function applyZonePricingToOption(option, zone) {
    if (!option || !zone) {
        return option;
    }
    
    const pricing = getZonePricing(zone);
    if (!pricing) {
        return option;
    }
    
    // Determine option type and apply appropriate pricing
    const optionType = (option.type || '').toLowerCase();
    const deliveryMethod = (option.deliveryMethod || '').toUpperCase();
    const id = (option.id || '').toLowerCase();
    const name = (option.name || '').toLowerCase();
    
    let cost = 0;
    let pricingReason = '';
    
    // Home delivery (standard) - check type first (most reliable)
    if (optionType === 'home') {
        cost = pricing.home;
        pricingReason = 'home (type match)';
    }
    // Home delivery Eco
    else if (optionType === 'home_eco' || 
             option.sustainability?.eco === true ||
             id.includes('eco') ||
             name.includes('eco')) {
        cost = pricing.eco;
        pricingReason = 'home_eco';
    }
    // Parcel locker
    else if (optionType === 'parcel_locker' || optionType === 'parcel-locker') {
        cost = pricing.parcelLocker;
        pricingReason = 'parcel_locker (type match)';
    }
    // Mailbox / door
    else if (optionType === 'mailbox' || 
             optionType === 'express-mailbox' ||
             optionType === 'express_mailbox') {
        cost = pricing.mailbox;
        pricingReason = 'mailbox (type match)';
    }
    // Service point (use parcel locker pricing)
    else if (optionType === 'service_point' || optionType === 'service-point') {
        cost = pricing.parcelLocker;
        pricingReason = 'service_point (using parcel_locker pricing)';
    }
    // Fallback: Check deliveryMethod
    else if (deliveryMethod === 'HOME' || deliveryMethod === 'HOME_DELIVERY') {
        cost = pricing.home;
        pricingReason = 'home (deliveryMethod match)';
    }
    else if (deliveryMethod === 'PARCEL_LOCKER' || deliveryMethod === 'LOCKER') {
        cost = pricing.parcelLocker;
        pricingReason = 'parcel_locker (deliveryMethod match)';
    }
    else if (deliveryMethod === 'MAILBOX' || deliveryMethod === 'POSTBOX') {
        cost = pricing.mailbox;
        pricingReason = 'mailbox (deliveryMethod match)';
    }
    else if (deliveryMethod === 'SERVICE_POINT' || deliveryMethod === 'PICKUP_POINT') {
        cost = pricing.parcelLocker;
        pricingReason = 'service_point (deliveryMethod match)';
    }
    // Fallback: Check ID or name
    else if (id.includes('home') && !id.includes('eco')) {
        cost = pricing.home;
        pricingReason = 'home (id match)';
    }
    else if (id.includes('locker')) {
        cost = pricing.parcelLocker;
        pricingReason = 'parcel_locker (id match)';
    }
    else if (id.includes('mailbox') || id.includes('door')) {
        cost = pricing.mailbox;
        pricingReason = 'mailbox (id match)';
    }
    // Default to home delivery pricing if type is unknown
    else {
        cost = pricing.home;
        pricingReason = 'home (default fallback)';
        console.warn('⚠️ [PRICING] Unknown option type, using default home pricing:', {
            type: option.type,
            deliveryMethod: option.deliveryMethod,
            id: option.id,
            name: option.name,
            zone: zone
        });
    }
    
    // Return option with pricing applied (override any existing cost)
    const pricedOption = {
        ...option,
        cost: cost,
        currency: 'SEK',
        zone: zone,
        pricingSource: 'zone_based' // Flag to indicate pricing is zone-based
    };
    
    // Log if cost is still 0 (should never happen with valid zone)
    if (cost === 0 && zone) {
        console.error('❌ [PRICING] Applied cost is 0! This should not happen.', {
            optionType: option.type,
            deliveryMethod: option.deliveryMethod,
            id: option.id,
            name: option.name,
            zone: zone,
            pricingReason: pricingReason,
            pricing: pricing
        });
    }
    
    return pricedOption;
}

/**
 * Apply zone-based pricing to multiple delivery options
 * @param {Array} options - Array of delivery options
 * @param {string} zone - Shipping zone ('SE' or 'EU')
 * @returns {Array} - Array of delivery options with pricing applied
 */
function applyZonePricingToOptions(options, zone) {
    if (!Array.isArray(options) || !zone) {
        return options || [];
    }
    
    return options.map(option => applyZonePricingToOption(option, zone));
}

/**
 * Generate fixed delivery options with zone-based pricing
 * @param {string} countryCode - ISO country code
 * @returns {Array} - Array of delivery options with pricing
 */
function getFixedDeliveryOptions(countryCode) {
    const zone = getShippingZone(countryCode);
    
    if (!zone) {
        // Return empty array if country is not in defined zones
        return [];
    }
    
    const pricing = getZonePricing(zone);
    
    return [
        {
            id: 'home_delivery',
            type: 'home',
            name: 'Home delivery',
            description: 'Delivery to your home address',
            cost: pricing.home,
            currency: 'SEK',
            estimatedDays: '2-5 business days',
            trackingEnabled: true,
            carrier: 'PostNord',
            zone: zone
        },
        {
            id: 'parcel_locker',
            type: 'parcel_locker',
            name: 'Collect at parcel locker',
            description: 'Pick up from a nearby parcel locker',
            cost: pricing.parcelLocker,
            currency: 'SEK',
            estimatedDays: '2-5 business days',
            trackingEnabled: true,
            carrier: 'PostNord',
            zone: zone
        },
        {
            id: 'mailbox_door',
            type: 'mailbox',
            name: 'Collect at mailbox / door',
            description: 'Delivery to your mailbox or door',
            cost: pricing.mailbox,
            currency: 'SEK',
            estimatedDays: '2-5 business days',
            trackingEnabled: false,
            carrier: 'PostNord',
            zone: zone
        },
        {
            id: 'home_delivery_eco',
            type: 'home_eco',
            name: 'Home delivery 🌿 Eco',
            description: 'Eco-friendly delivery to your home address',
            cost: pricing.eco,
            currency: 'SEK',
            estimatedDays: '3-7 business days',
            trackingEnabled: true,
            carrier: 'PostNord',
            sustainability: {
                eco: true,
                carbonNeutral: true
            },
            zone: zone
        }
    ];
}

module.exports = {
    getShippingZone,
    getZonePricing,
    getFixedDeliveryOptions,
    applyZonePricingToOption,
    applyZonePricingToOptions,
    EU_COUNTRIES
};

