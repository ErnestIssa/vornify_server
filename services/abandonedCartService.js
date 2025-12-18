const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('./emailService');

const db = getDBInstance();

// Abandoned cart detection settings
const ABANDONED_CART_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

/**
 * Format cart items for email (structured data, no HTML)
 * @param {array} items - Cart items array
 * @returns {array} Formatted items array
 */
function formatCartItemsForEmail(items) {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return [];
    }
    
    return items.map(item => ({
        name: item.name || 'Product',
        quantity: item.quantity || 1,
        displayPrice: `${(item.price || 0) * (item.quantity || 1)} SEK`
    }));
}

/**
 * Format cart total for email
 * @param {object} totals - Cart totals object
 * @returns {string} Formatted total (e.g., "897 SEK")
 */
function formatCartTotal(totals) {
    if (!totals || typeof totals.total !== 'number') {
        return '0 SEK';
    }
    
    return `${totals.total} SEK`;
}

/**
 * Generate cart recovery URL
 * @param {string} userId - User ID
 * @returns {string} Cart recovery URL
 */
function generateCartUrl(userId) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://peakmode.se';
    return `${frontendUrl}/cart?recover=${userId}`;
}

/**
 * Check if cart is abandoned (no activity for 30 minutes)
 * @param {object} cart - Cart object
 * @returns {boolean} True if cart is abandoned
 */
function isCartAbandoned(cart) {
    if (!cart || !cart.items || cart.items.length === 0) {
        return false; // Empty cart is not abandoned
    }
    
    if (!cart.updatedAt) {
        return false; // No timestamp, can't determine
    }
    
    const lastUpdate = new Date(cart.updatedAt);
    const now = new Date();
    const timeSinceUpdate = now - lastUpdate;
    
    // Cart is abandoned if last update was more than 30 minutes ago
    return timeSinceUpdate >= ABANDONED_CART_TIMEOUT;
}

/**
 * Check if abandoned cart email was already sent
 * @param {object} cart - Cart object
 * @returns {boolean} True if email was already sent
 */
function wasEmailSent(cart) {
    return cart.abandonedCartEmailSent === true;
}

/**
 * Mark abandoned cart email as sent
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if marked successfully
 */
async function markEmailAsSent(userId) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--update',
            data: {
                filter: { userId },
                update: {
                    abandonedCartEmailSent: true,
                    abandonedCartEmailSentAt: new Date().toISOString()
                }
            }
        });
        
        return result.success;
    } catch (error) {
        console.error('Error marking email as sent:', error);
        return false;
    }
}

/**
 * Get customer email from user ID
 * @param {string} userId - User ID
 * @returns {Promise<string|null>} Customer email or null
 */
async function getCustomerEmail(userId) {
    try {
        // Try to get from customers collection
        const customerResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--read',
            data: { id: userId }
        });
        
        if (customerResult.success && customerResult.data && customerResult.data.email) {
            return customerResult.data.email;
        }
        
        // Try to get from users/auth collection if exists
        const userResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { id: userId }
        });
        
        if (userResult.success && userResult.data && userResult.data.email) {
            return userResult.data.email;
        }
        
        return null;
    } catch (error) {
        console.error('Error getting customer email:', error);
        return null;
    }
}

/**
 * Get customer name from user ID
 * @param {string} userId - User ID
 * @returns {Promise<string>} Customer name or default
 */
async function getCustomerName(userId) {
    try {
        const customerResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--read',
            data: { id: userId }
        });
        
        if (customerResult.success && customerResult.data) {
            const customer = customerResult.data;
            return customer.name || 
                   `${customer.firstName || ''} ${customer.lastName || ''}`.trim() ||
                   'Valued Customer';
        }
        
        return 'Valued Customer';
    } catch (error) {
        console.error('Error getting customer name:', error);
        return 'Valued Customer';
    }
}

/**
 * Check if order was created from this cart
 * @param {string} userId - User ID
 * @param {string} cartUpdatedAt - Cart last update timestamp
 * @returns {Promise<boolean>} True if order exists
 */
async function hasOrderBeenCreated(userId, cartUpdatedAt) {
    try {
        // Check if any order was created after cart was last updated
        // This prevents sending email if user already completed purchase
        const ordersResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: {
                $or: [
                    { customerEmail: userId },
                    { 'customer.email': userId },
                    { userId: userId }
                ],
                createdAt: { $gte: cartUpdatedAt }
            }
        });
        
        // If orders exist created after cart update, user likely completed purchase
        return ordersResult.success && ordersResult.data && Array.isArray(ordersResult.data) && ordersResult.data.length > 0;
    } catch (error) {
        console.error('Error checking orders:', error);
        return false; // If error, assume no order (safer to send email)
    }
}

/**
 * Process abandoned cart and send email
 * @param {object} cart - Cart object
 * @returns {Promise<object>} Result object
 */
async function processAbandonedCart(cart) {
    try {
        const userId = cart.userId;
        
        // Check if email was already sent
        if (wasEmailSent(cart)) {
            return {
                success: false,
                skipped: true,
                reason: 'Email already sent'
            };
        }
        
        // Check if order was created
        const orderExists = await hasOrderBeenCreated(userId, cart.updatedAt);
        if (orderExists) {
            return {
                success: false,
                skipped: true,
                reason: 'Order already created'
            };
        }
        
        // Get customer email
        const customerEmail = await getCustomerEmail(userId);
        if (!customerEmail) {
            return {
                success: false,
                skipped: true,
                reason: 'No customer email found'
            };
        }
        
        // Get customer name
        const customerName = await getCustomerName(userId);
        
        // Format cart data
        const formattedItems = formatCartItemsForEmail(cart.items);
        const cartTotal = formatCartTotal(cart.totals);
        const cartUrl = generateCartUrl(userId);
        
        // Send email
        const emailResult = await emailService.sendAbandonedCartEmail(
            customerEmail,
            customerName,
            formattedItems,
            cartTotal,
            cartUrl
        );
        
        if (emailResult.success) {
            // Mark email as sent
            await markEmailAsSent(userId);
            
            console.log(`✅ Abandoned cart email sent to ${customerEmail} for cart ${userId}`);
            
            return {
                success: true,
                emailSent: true,
                customerEmail: customerEmail,
                messageId: emailResult.messageId
            };
        } else {
            console.error(`❌ Failed to send abandoned cart email to ${customerEmail}:`, emailResult.error);
            
            return {
                success: false,
                emailSent: false,
                error: emailResult.error
            };
        }
    } catch (error) {
        console.error('Error processing abandoned cart:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Find and process all abandoned carts
 * @returns {Promise<object>} Summary of processing
 */
async function processAbandonedCarts() {
    try {
        console.log('🛒 [ABANDONED CART] Starting abandoned cart check...');
        
        const now = new Date();
        const cutoffTime = new Date(now - ABANDONED_CART_TIMEOUT);
        
        // Find all carts that:
        // 1. Have items (not empty)
        // 2. Were last updated more than 30 minutes ago
        // 3. Haven't had email sent yet
        const cartsResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: {
                'items.0': { $exists: true }, // Has at least one item
                updatedAt: { $lt: cutoffTime.toISOString() },
                $or: [
                    { abandonedCartEmailSent: { $exists: false } },
                    { abandonedCartEmailSent: false }
                ]
            }
        });
        
        if (!cartsResult.success) {
            console.error('❌ [ABANDONED CART] Failed to fetch carts:', cartsResult);
            return {
                success: false,
                error: 'Failed to fetch carts'
            };
        }
        
        const carts = cartsResult.data || [];
        
        if (!Array.isArray(carts)) {
            // If single cart returned
            const cartsArray = cartsResult.data ? [cartsResult.data] : [];
            return await processCartsArray(cartsArray);
        }
        
        return await processCartsArray(carts);
    } catch (error) {
        console.error('❌ [ABANDONED CART] Error processing abandoned carts:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Process array of carts
 * @param {array} carts - Array of cart objects
 * @returns {Promise<object>} Summary of processing
 */
async function processCartsArray(carts) {
    const results = {
        total: carts.length,
        processed: 0,
        sent: 0,
        skipped: 0,
        errors: 0,
        details: []
    };
    
    for (const cart of carts) {
        // Double-check cart is abandoned
        if (!isCartAbandoned(cart)) {
            results.skipped++;
            results.details.push({
                userId: cart.userId,
                status: 'skipped',
                reason: 'Not abandoned (within 30 minutes)'
            });
            continue;
        }
        
        const result = await processAbandonedCart(cart);
        
        if (result.success && result.emailSent) {
            results.sent++;
        } else if (result.skipped) {
            results.skipped++;
        } else {
            results.errors++;
        }
        
        results.processed++;
        results.details.push({
            userId: cart.userId,
            status: result.success ? 'sent' : (result.skipped ? 'skipped' : 'error'),
            reason: result.reason || result.error
        });
    }
    
    console.log(`🛒 [ABANDONED CART] Processed ${results.processed} carts: ${results.sent} sent, ${results.skipped} skipped, ${results.errors} errors`);
    
    return {
        success: true,
        ...results
    };
}

module.exports = {
    processAbandonedCarts,
    processAbandonedCart,
    isCartAbandoned,
    formatCartItemsForEmail,
    formatCartTotal,
    generateCartUrl
};

