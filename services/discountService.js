const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

/**
 * Discount Service
 * Handles all discount code validation and calculation on the BACKEND
 * IMPORTANT: All discount calculations must be done server-side, NOT on the frontend
 */

/**
 * Helper function to round currency values to 2 decimal places
 * Ensures all monetary values are displayed with proper decimal formatting (e.g., 50.00 instead of 50)
 */
function roundToCurrency(value) {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    // Round to 2 decimal places for currency display
    return Math.round(value * 100) / 100;
}

/**
 * Calculate discount amount
 * CRITICAL: Discount is calculated on product price (subtotal) BEFORE tax
 * Formula: subtotal + shipping + tax - discount = total
 * Discount is always applied to subtotal (product prices), never to tax or shipping
 * 
 * @param {number} subtotal - Cart subtotal (product prices, BEFORE tax)
 * @param {number} discountPercentage - Discount percentage (e.g., 10 for 10%)
 * @returns {number} Discount amount (rounded to 2 decimal places)
 */
function calculateDiscountAmount(subtotal, discountPercentage) {
    if (!subtotal || subtotal <= 0) return 0;
    if (!discountPercentage || discountPercentage <= 0) return 0;
    if (discountPercentage > 100) discountPercentage = 100; // Cap at 100%
    
    // Calculate discount on subtotal (product prices, BEFORE tax)
    // Example: 10% discount on 500 SEK = 500 * (10 / 100) = 50.00 SEK
    const discountAmount = subtotal * (discountPercentage / 100);
    
    // Never allow discount to exceed subtotal
    // Round to 2 decimal places for proper currency formatting
    return roundToCurrency(Math.min(discountAmount, subtotal));
}

/**
 * Validate and get discount code details
 * @param {string} discountCode - Discount code to validate
 * @returns {Promise<object>} Validation result with discount details
 */
async function validateDiscountCode(discountCode) {
    try {
        if (!discountCode || typeof discountCode !== 'string' || discountCode.trim().length === 0) {
            return {
                success: false,
                valid: false,
                error: 'Discount code is required'
            };
        }

        const normalizedCode = discountCode.trim().toUpperCase();

        // Look up discount code in subscribers collection
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: { discountCode: normalizedCode }
        });

        if (!result.success || !result.data) {
            return {
                success: true,
                valid: false,
                error: 'Invalid discount code'
            };
        }

        const subscriber = Array.isArray(result.data) ? result.data[0] : result.data;

        // Check if code is already used
        if (subscriber.discountCodeUsed === true) {
            return {
                success: true,
                valid: false,
                error: 'This discount code has already been used'
            };
        }

        // Check if code is expired
        if (subscriber.discountCodeExpiresAt) {
            const expiresAt = new Date(subscriber.discountCodeExpiresAt);
            const now = new Date();
            if (expiresAt < now) {
                return {
                    success: true,
                    valid: false,
                    error: 'This discount code has expired'
                };
            }
        }

        // Code is valid
        // All discount codes are 10% off (PEAK10-XXXXXX format)
        const discountPercentage = 10;

        return {
            success: true,
            valid: true,
            discountCode: normalizedCode,
            discountPercentage: discountPercentage,
            expiresAt: subscriber.discountCodeExpiresAt || null,
            message: 'Discount code is valid'
        };

    } catch (error) {
        console.error('❌ [DISCOUNT SERVICE] Validate discount code error:', error);
        return {
            success: false,
            valid: false,
            error: 'Failed to validate discount code',
            details: error.message
        };
    }
}

/**
 * Calculate order totals with discount
 * CRITICAL: Discount is applied to subtotal (product prices) BEFORE tax
 * 
 * Calculation order:
 * 1. Subtotal (product prices, no tax)
 * 2. Calculate discount on subtotal
 * 3. Add shipping
 * 4. Add tax (calculated on subtotal - discount + shipping, or just subtotal - discount, depending on tax rules)
 * 5. Total = subtotal - discount + shipping + tax
 * 
 * @param {number} subtotal - Cart subtotal (product prices, BEFORE tax)
 * @param {number} shipping - Shipping cost
 * @param {number} tax - Tax amount
 * @param {string} discountCode - Optional discount code
 * @returns {Promise<object>} Calculated totals with discount
 */
async function calculateOrderTotals(subtotal, shipping = 0, tax = 0, discountCode = null) {
    try {
        let discountAmount = 0;
        let appliedDiscount = null;

        // If discount code provided, validate and calculate discount
        if (discountCode) {
            const validation = await validateDiscountCode(discountCode);
            
            if (validation.success && validation.valid) {
                // Calculate discount on subtotal (BEFORE tax)
                discountAmount = calculateDiscountAmount(subtotal, validation.discountPercentage);
                
                appliedDiscount = {
                    code: validation.discountCode,
                    percentage: validation.discountPercentage,
                    amount: discountAmount,
                    appliedAt: new Date().toISOString()
                };
            } else {
                // Invalid discount code - return error
                return {
                    success: false,
                    error: validation.error || 'Invalid discount code',
                    totals: null
                };
            }
        }

        // Calculate totals
        // IMPORTANT: Discount is applied to subtotal BEFORE tax calculation
        // Total = subtotal - discount + shipping + tax
        const discountedSubtotal = roundToCurrency(subtotal - discountAmount);
        const total = roundToCurrency(discountedSubtotal + shipping + tax);

        const totals = {
            subtotal: roundToCurrency(subtotal),              // Original product prices (before discount)
            discount: discountAmount,                         // Discount amount (already rounded, calculated on subtotal)
            discountedSubtotal: discountedSubtotal,           // Subtotal after discount (rounded)
            shipping: roundToCurrency(shipping),              // Shipping cost (rounded)
            tax: roundToCurrency(tax),                        // Tax amount (rounded)
            total: total                                      // Final total (rounded)
        };

        return {
            success: true,
            totals: totals,
            appliedDiscount: appliedDiscount,
            message: discountCode ? 'Discount applied successfully' : 'Totals calculated'
        };

    } catch (error) {
        console.error('❌ [DISCOUNT SERVICE] Calculate order totals error:', error);
        return {
            success: false,
            error: 'Failed to calculate order totals',
            details: error.message,
            totals: null
        };
    }
}

/**
 * Mark discount code as used
 * IMPORTANT: This should ONLY be called AFTER successful payment
 * Called by payment webhook handler when payment succeeds
 * 
 * @param {string} discountCode - Discount code to mark as used
 * @param {string} orderId - Order ID that used this code
 * @returns {Promise<object>} Result
 */
async function markDiscountCodeAsUsed(discountCode, orderId) {
    try {
        if (!discountCode) {
            return {
                success: false,
                error: 'Discount code is required'
            };
        }

        const normalizedCode = discountCode.trim().toUpperCase();

        // Update subscriber record to mark code as used
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--update',
            data: {
                filter: { discountCode: normalizedCode },
                update: {
                    discountCodeUsed: true,
                    discountCodeUsedAt: new Date().toISOString(),
                    discountCodeUsedInOrder: orderId || null,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            console.error(`⚠️ [DISCOUNT SERVICE] Failed to mark discount code ${normalizedCode} as used`);
            return {
                success: false,
                error: 'Failed to mark discount code as used'
            };
        }

        console.log(`✅ [DISCOUNT SERVICE] Discount code ${normalizedCode} marked as used for order ${orderId || 'N/A'}`);
        return {
            success: true,
            message: 'Discount code marked as used'
        };

    } catch (error) {
        console.error('❌ [DISCOUNT SERVICE] Mark discount code as used error:', error);
        return {
            success: false,
            error: 'Failed to mark discount code as used',
            details: error.message
        };
    }
}

module.exports = {
    validateDiscountCode,
    calculateDiscountAmount,
    calculateOrderTotals,
    markDiscountCodeAsUsed
};

