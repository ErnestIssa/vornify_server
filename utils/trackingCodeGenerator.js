/**
 * Tracking Code Generator
 * 
 * Generates customer-friendly tracking codes in the format:
 * [Second 2 letters of first name][First 2 letters of last name]-[4 digit number]
 * 
 * Example: Ernest Issa → NEIS-1234
 *   - "Ernest": Skip first letter (E), take next 2 (N, E) = "NE"
 *   - "Issa": Take first 2 letters (I, S) = "IS"
 *   - Combined: "NEIS-1234"
 */

const getDBInstance = require('../vornifydb/dbInstance');

/**
 * Generate a customer-friendly tracking code
 * @param {string} firstName - Customer first name
 * @param {string} lastName - Customer last name
 * @returns {string} Tracking code (e.g., "NEIS-1234")
 */
function generateTrackingCode(firstName, lastName) {
    // Get second 2 letters of first name (skip first letter, take next 2)
    // Example: "Ernest" -> skip "E", take "N" and "E" = "NE"
    let firstPart = 'XX';
    if (firstName && typeof firstName === 'string' && firstName.length >= 3) {
        firstPart = firstName.substring(1, 3).toUpperCase(); // Skip first char (index 0), take next 2 (index 1-2)
    } else if (firstName && typeof firstName === 'string' && firstName.length === 2) {
        firstPart = (firstName[1] + 'X').toUpperCase(); // Take second char + pad
    } else if (firstName && typeof firstName === 'string' && firstName.length === 1) {
        firstPart = 'XX'; // Too short, use default
    }
    
    // Get first 2 letters of last name
    // Example: "Issa" -> take "I" and "S" = "IS"
    let secondPart = 'XX';
    if (lastName && typeof lastName === 'string' && lastName.length >= 2) {
        secondPart = lastName.substring(0, 2).toUpperCase();
    } else if (lastName && typeof lastName === 'string' && lastName.length === 1) {
        secondPart = (lastName[0] + 'X').toUpperCase();
    }
    
    // Generate 4-digit random number (0000-9999)
    const randomNumber = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
    
    // Combine: NEIS-1234
    return `${firstPart}${secondPart}-${randomNumber}`;
}

/**
 * Check if tracking code is unique in database
 * @param {string} trackingCode - Tracking code to check
 * @returns {Promise<boolean>} True if unique, false if exists
 */
async function isTrackingCodeUnique(trackingCode) {
    try {
        const db = getDBInstance();
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { trackingCode: trackingCode.toUpperCase().trim() }
        });
        
        // If result has data, tracking code exists (not unique)
        if (result.success && result.data) {
            const orders = Array.isArray(result.data) ? result.data : [result.data];
            return orders.length === 0;
        }
        
        return true; // No data found, so it's unique
    } catch (error) {
        console.error('Error checking tracking code uniqueness:', error);
        // On error, assume it's unique to avoid blocking order creation
        return true;
    }
}

/**
 * Generate a unique tracking code
 * @param {string} firstName - Customer first name
 * @param {string} lastName - Customer last name
 * @returns {Promise<string>} Unique tracking code
 */
async function generateUniqueTrackingCode(firstName, lastName) {
    let trackingCode = generateTrackingCode(firstName, lastName);
    let attempts = 0;
    const maxAttempts = 20;
    
    while (!(await isTrackingCodeUnique(trackingCode)) && attempts < maxAttempts) {
        // Regenerate with new random number
        const [letters] = trackingCode.split('-');
        const newNumber = Math.floor(Math.random() * 10000)
            .toString()
            .padStart(4, '0');
        trackingCode = `${letters}-${newNumber}`;
        attempts++;
    }
    
    if (attempts >= maxAttempts) {
        console.warn('⚠️ [TRACKING CODE] Failed to generate unique code after max attempts, using generated code anyway');
        // Still return the code - collision is very unlikely with 4-digit random
    }
    
    return trackingCode;
}

/**
 * Normalize email for comparison
 * @param {string} email - Email address
 * @returns {string} Normalized email (lowercase, trimmed)
 */
function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.toLowerCase().trim();
}

/**
 * Extract first and last name from various order formats
 * @param {object} orderData - Order data object
 * @returns {object} { firstName, lastName }
 */
function extractCustomerNames(orderData) {
    let firstName = null;
    let lastName = null;
    
    // Try different field combinations
    if (orderData.customer?.firstName && orderData.customer?.lastName) {
        firstName = orderData.customer.firstName;
        lastName = orderData.customer.lastName;
    } else if (orderData.firstName && orderData.lastName) {
        firstName = orderData.firstName;
        lastName = orderData.lastName;
    } else if (orderData.customerName) {
        // Try to split customerName
        const nameParts = String(orderData.customerName).trim().split(/\s+/);
        if (nameParts.length >= 2) {
            firstName = nameParts[0];
            lastName = nameParts.slice(1).join(' ');
        } else if (nameParts.length === 1) {
            firstName = nameParts[0];
            lastName = 'XX';
        }
    } else if (orderData.customer?.name) {
        const nameParts = String(orderData.customer.name).trim().split(/\s+/);
        if (nameParts.length >= 2) {
            firstName = nameParts[0];
            lastName = nameParts.slice(1).join(' ');
        } else if (nameParts.length === 1) {
            firstName = nameParts[0];
            lastName = 'XX';
        }
    }
    
    return {
        firstName: firstName || 'XX',
        lastName: lastName || 'XX'
    };
}

module.exports = {
    generateTrackingCode,
    isTrackingCodeUnique,
    generateUniqueTrackingCode,
    normalizeEmail,
    extractCustomerNames
};

