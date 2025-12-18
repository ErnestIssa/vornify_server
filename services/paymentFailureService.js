const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('./emailService');

const db = getDBInstance();

// Payment failure reminder settings
const PAYMENT_RETRY_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds

// Store active timers (in-memory, will be lost on restart - but that's okay)
const activeTimers = new Map();

/**
 * Generate payment retry URL
 * @param {string} orderId - Order ID
 * @param {string} paymentIntentId - Stripe payment intent ID
 * @returns {string} Payment retry URL
 */
function generatePaymentRetryUrl(orderId, paymentIntentId) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://peakmode.se';
    // Include both orderId and paymentIntentId for frontend to handle retry
    return `${frontendUrl}/checkout?orderId=${orderId}&retry=${paymentIntentId}`;
}

/**
 * Get customer email from order
 * @param {object} order - Order object
 * @returns {string|null} Customer email or null
 */
function getCustomerEmailFromOrder(order) {
    if (!order) return null;
    
    return order.customer?.email || 
           order.customerEmail || 
           null;
}

/**
 * Get customer name from order
 * @param {object} order - Order object
 * @returns {string} Customer name or default
 */
function getCustomerNameFromOrder(order) {
    if (!order) return 'Valued Customer';
    
    return order.customer?.name || 
           `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() ||
           order.customerName ||
           'Valued Customer';
}

/**
 * Check if payment was successful after failure
 * @param {string} orderId - Order ID
 * @param {string} failedAt - Timestamp when payment failed
 * @returns {Promise<boolean>} True if payment succeeded after failure
 */
async function hasPaymentSucceeded(orderId, failedAt) {
    try {
        const orderResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!orderResult.success || !orderResult.data) {
            return false;
        }
        
        const order = orderResult.data;
        
        // Check if payment status changed to succeeded after failure
        if (order.paymentStatus === 'succeeded') {
            // Check if payment was confirmed after the failure time
            const paymentConfirmed = order.timeline?.find(entry => 
                entry.status === 'Payment Confirmed' && 
                new Date(entry.timestamp) > new Date(failedAt)
            );
            
            return !!paymentConfirmed;
        }
        
        return false;
    } catch (error) {
        console.error('Error checking payment status:', error);
        return false; // If error, assume no payment (safer to send email)
    }
}

/**
 * Mark payment failure email as sent
 * @param {string} orderId - Order ID
 * @returns {Promise<boolean>} True if marked successfully
 */
async function markEmailAsSent(orderId) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: {
                    paymentFailedEmailSent: true,
                    paymentFailedEmailSentAt: new Date().toISOString()
                }
            }
        });
        
        return result.success;
    } catch (error) {
        console.error('Error marking payment failure email as sent:', error);
        return false;
    }
}

/**
 * Check if payment failure email was already sent
 * @param {object} order - Order object
 * @returns {boolean} True if email was already sent
 */
function wasEmailSent(order) {
    return order.paymentFailedEmailSent === true;
}

/**
 * Process payment failure and schedule reminder email
 * @param {string} orderId - Order ID
 * @param {string} paymentIntentId - Stripe payment intent ID
 * @param {object} order - Order object (optional, will fetch if not provided)
 * @returns {Promise<object>} Result object
 */
async function schedulePaymentFailureEmail(orderId, paymentIntentId, order = null) {
    try {
        // Fetch order if not provided
        if (!order) {
            const orderResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--read',
                data: { orderId }
            });
            
            if (!orderResult.success || !orderResult.data) {
                return {
                    success: false,
                    error: 'Order not found'
                };
            }
            
            order = orderResult.data;
        }
        
        // Check if email was already sent
        if (wasEmailSent(order)) {
            console.log(`⏭️ [PAYMENT FAILURE] Email already sent for order ${orderId}`);
            return {
                success: false,
                skipped: true,
                reason: 'Email already sent'
            };
        }
        
        // Get customer email
        const customerEmail = getCustomerEmailFromOrder(order);
        if (!customerEmail) {
            console.warn(`⚠️ [PAYMENT FAILURE] No customer email for order ${orderId}`);
            return {
                success: false,
                skipped: true,
                reason: 'No customer email found'
            };
        }
        
        // Get customer name
        const customerName = getCustomerNameFromOrder(order);
        
        // Generate retry URL
        const paymentRetryUrl = generatePaymentRetryUrl(orderId, paymentIntentId);
        
        // Store failure timestamp
        const failedAt = new Date().toISOString();
        
        // Clear any existing timer for this order
        if (activeTimers.has(orderId)) {
            clearTimeout(activeTimers.get(orderId));
        }
        
        // Schedule email to be sent after 10 minutes
        const timer = setTimeout(async () => {
            try {
                // Check if payment succeeded in the meantime
                const paymentSucceeded = await hasPaymentSucceeded(orderId, failedAt);
                
                if (paymentSucceeded) {
                    console.log(`✅ [PAYMENT FAILURE] Payment succeeded for order ${orderId}, skipping email`);
                    activeTimers.delete(orderId);
                    return;
                }
                
                // Double-check order status
                const orderCheck = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'orders',
                    command: '--read',
                    data: { orderId }
                });
                
                if (orderCheck.success && orderCheck.data) {
                    const currentOrder = orderCheck.data;
                    
                    // Check if payment succeeded
                    if (currentOrder.paymentStatus === 'succeeded') {
                        console.log(`✅ [PAYMENT FAILURE] Payment succeeded for order ${orderId}, skipping email`);
                        activeTimers.delete(orderId);
                        return;
                    }
                    
                    // Check if email was already sent
                    if (currentOrder.paymentFailedEmailSent) {
                        console.log(`⏭️ [PAYMENT FAILURE] Email already sent for order ${orderId}`);
                        activeTimers.delete(orderId);
                        return;
                    }
                    
                    // Send email
                    const emailResult = await emailService.sendPaymentFailedEmail(
                        customerEmail,
                        customerName,
                        orderId,
                        paymentRetryUrl
                    );
                    
                    if (emailResult.success) {
                        // Mark email as sent
                        await markEmailAsSent(orderId);
                        
                        console.log(`✅ [PAYMENT FAILURE] Payment failure email sent to ${customerEmail} for order ${orderId}`, {
                            messageId: emailResult.messageId,
                            timestamp: emailResult.timestamp
                        });
                    } else {
                        console.error(`❌ [PAYMENT FAILURE] Failed to send email to ${customerEmail}:`, emailResult.error);
                    }
                }
                
                activeTimers.delete(orderId);
            } catch (error) {
                console.error(`❌ [PAYMENT FAILURE] Error processing payment failure email for order ${orderId}:`, error);
                activeTimers.delete(orderId);
            }
        }, PAYMENT_RETRY_TIMEOUT);
        
        // Store timer
        activeTimers.set(orderId, timer);
        
        console.log(`⏰ [PAYMENT FAILURE] Scheduled payment failure email for order ${orderId} (will send in 10 minutes)`);
        
        return {
            success: true,
            scheduled: true,
            orderId: orderId,
            willSendAt: new Date(Date.now() + PAYMENT_RETRY_TIMEOUT).toISOString()
        };
    } catch (error) {
        console.error('Error scheduling payment failure email:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Cancel scheduled payment failure email
 * @param {string} orderId - Order ID
 * @returns {boolean} True if timer was cancelled
 */
function cancelScheduledEmail(orderId) {
    if (activeTimers.has(orderId)) {
        clearTimeout(activeTimers.get(orderId));
        activeTimers.delete(orderId);
        console.log(`🚫 [PAYMENT FAILURE] Cancelled scheduled email for order ${orderId}`);
        return true;
    }
    return false;
}

/**
 * Process pending payment failure emails (for recovery after server restart)
 * This checks for orders with failed payments that need reminder emails
 * @returns {Promise<object>} Summary of processing
 */
async function processPendingPaymentFailures() {
    try {
        console.log('💳 [PAYMENT FAILURE] Checking for pending payment failure emails...');
        
        const now = new Date();
        const cutoffTime = new Date(now - PAYMENT_RETRY_TIMEOUT);
        
        // Find orders that:
        // 1. Have payment status 'failed'
        // 2. Failed more than 10 minutes ago
        // 3. Haven't had reminder email sent
        // 4. Payment hasn't succeeded
        const ordersResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: {
                paymentStatus: 'failed',
                updatedAt: { $lt: cutoffTime.toISOString() },
                $or: [
                    { paymentFailedEmailSent: { $exists: false } },
                    { paymentFailedEmailSent: false }
                ]
            }
        });
        
        if (!ordersResult.success) {
            console.error('❌ [PAYMENT FAILURE] Failed to fetch orders:', ordersResult);
            return {
                success: false,
                error: 'Failed to fetch orders'
            };
        }
        
        const orders = Array.isArray(ordersResult.data) ? ordersResult.data : (ordersResult.data ? [ordersResult.data] : []);
        
        const results = {
            total: orders.length,
            processed: 0,
            sent: 0,
            skipped: 0,
            errors: 0
        };
        
        for (const order of orders) {
            // Double-check payment hasn't succeeded
            if (order.paymentStatus === 'succeeded') {
                results.skipped++;
                continue;
            }
            
            // Get payment intent ID from order
            const paymentIntentId = order.paymentIntentId;
            if (!paymentIntentId) {
                results.skipped++;
                continue;
            }
            
            // Send email immediately (10 minutes already passed)
            const customerEmail = getCustomerEmailFromOrder(order);
            if (!customerEmail) {
                results.skipped++;
                continue;
            }
            
            const customerName = getCustomerNameFromOrder(order);
            const paymentRetryUrl = generatePaymentRetryUrl(order.orderId, paymentIntentId);
            
            const emailResult = await emailService.sendPaymentFailedEmail(
                customerEmail,
                customerName,
                order.orderId,
                paymentRetryUrl
            );
            
            if (emailResult.success) {
                await markEmailAsSent(order.orderId);
                results.sent++;
                console.log(`✅ [PAYMENT FAILURE] Sent pending reminder email for order ${order.orderId}`);
            } else {
                results.errors++;
                console.error(`❌ [PAYMENT FAILURE] Failed to send email for order ${order.orderId}:`, emailResult.error);
            }
            
            results.processed++;
        }
        
        console.log(`💳 [PAYMENT FAILURE] Processed ${results.processed} pending orders: ${results.sent} sent, ${results.skipped} skipped, ${results.errors} errors`);
        
        return {
            success: true,
            ...results
        };
    } catch (error) {
        console.error('❌ [PAYMENT FAILURE] Error processing pending payment failures:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    schedulePaymentFailureEmail,
    cancelScheduledEmail,
    processPendingPaymentFailures,
    generatePaymentRetryUrl
};

