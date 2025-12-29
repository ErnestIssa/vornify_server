const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('./emailService');
const crypto = require('crypto');

const db = getDBInstance();

// Payment failure email delay (3 minutes)
const PAYMENT_FAILURE_EMAIL_DELAY = 3 * 60 * 1000; // 3 minutes in milliseconds

/**
 * Generate unique retry token
 * @returns {string} UUID retry token
 */
function generateRetryToken() {
    return crypto.randomUUID();
}

/**
 * Generate payment retry URL using retry token
 * @param {string} retryToken - Retry token
 * @returns {string} Payment retry URL
 */
function generatePaymentRetryUrl(retryToken) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://peakmode.se';
    return `${frontendUrl}/retry-payment/${retryToken}`;
}

/**
 * Save failed checkout to database
 * @param {object} paymentIntent - Stripe payment intent object
 * @param {object} order - Order object
 * @returns {Promise<object>} Result object with retryToken
 */
async function saveFailedCheckout(paymentIntent, order) {
    try {
        const customerEmail = order.customer?.email || order.customerEmail;
        if (!customerEmail) {
            console.warn('⚠️ [PAYMENT FAILURE] No customer email in order, cannot save failed checkout');
            return {
                success: false,
                error: 'No customer email found'
            };
        }

        const retryToken = generateRetryToken();
        
        // Extract cart items from order
        const cartItems = order.items || [];
        
        // Calculate total from order
        const total = order.totals?.total || order.total || (paymentIntent.amount / 100);

        const failedCheckout = {
            id: `failed_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            email: customerEmail.toLowerCase().trim(),
            cart: cartItems,
            total: total,
            status: 'failed',
            retryToken: retryToken,
            emailSent: false,
            orderId: order.orderId || null,
            paymentIntentId: paymentIntent.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            // Store customer information from order
            customer: order.customer || null,
            // Store shipping address from order
            shippingAddress: order.shippingAddress || null,
            // Store shipping method from order
            shippingMethod: order.shippingMethod || null
        };

        // Save to failed_checkouts collection
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'failed_checkouts',
            command: '--create',
            data: failedCheckout
        });

        if (saveResult.success) {
            console.log(`✅ [PAYMENT FAILURE] Failed checkout saved:`, {
                id: failedCheckout.id,
                email: failedCheckout.email,
                retryToken: retryToken,
                total: total,
                itemsCount: cartItems.length
            });

            return {
                success: true,
                retryToken: retryToken,
                failedCheckoutId: failedCheckout.id
            };
        } else {
            console.error('❌ [PAYMENT FAILURE] Failed to save failed checkout:', saveResult);
            return {
                success: false,
                error: 'Failed to save failed checkout'
            };
        }
    } catch (error) {
        console.error('❌ [PAYMENT FAILURE] Error saving failed checkout:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get failed checkout by retry token
 * @param {string} retryToken - Retry token
 * @returns {Promise<object|null>} Failed checkout object or null
 */
async function getFailedCheckoutByToken(retryToken) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'failed_checkouts',
            command: '--read',
            data: { retryToken: retryToken }
        });

        if (result.success && result.data) {
            return Array.isArray(result.data) ? result.data[0] : result.data;
        }

        return null;
    } catch (error) {
        console.error('❌ [PAYMENT FAILURE] Error getting failed checkout by token:', error);
        return null;
    }
}

/**
 * Mark failed checkout as completed
 * @param {string} retryToken - Retry token
 * @returns {Promise<boolean>} True if marked successfully
 */
async function markFailedCheckoutCompleted(retryToken) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'failed_checkouts',
            command: '--update',
            data: {
                filter: { retryToken: retryToken },
                update: {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });

        return result.success;
    } catch (error) {
        console.error('❌ [PAYMENT FAILURE] Error marking failed checkout as completed:', error);
        return false;
    }
}

/**
 * Process pending failed checkouts and send emails
 * Runs every minute, sends email for checkouts failed more than 3 minutes ago
 * @returns {Promise<object>} Summary of processing
 */
async function processPendingPaymentFailures() {
    try {
        console.log('💳 [PAYMENT FAILURE] Checking for pending payment failures...');
        
        const now = new Date();
        const cutoffTime = new Date(now - PAYMENT_FAILURE_EMAIL_DELAY); // 3 minutes ago

        // Find failed checkouts that:
        // 1. Status is 'failed'
        // 2. Created more than 3 minutes ago
        // 3. Email not sent yet
        const checkoutsResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'failed_checkouts',
            command: '--read',
            data: {
                status: 'failed',
                createdAt: { $lt: cutoffTime.toISOString() },
                $or: [
                    { emailSent: { $exists: false } },
                    { emailSent: false }
                ]
            }
        });

        if (!checkoutsResult.success) {
            console.error('❌ [PAYMENT FAILURE] Failed to fetch failed checkouts:', checkoutsResult);
            return {
                success: false,
                error: 'Failed to fetch failed checkouts'
            };
        }

        const checkouts = checkoutsResult.data || [];
        const checkoutsArray = Array.isArray(checkouts) ? checkouts : [checkouts];

        const results = {
            total: checkoutsArray.length,
            processed: 0,
            sent: 0,
            skipped: 0,
            errors: 0
        };

        for (const checkout of checkoutsArray) {
            // Double-check status (might have been completed)
            if (checkout.status !== 'failed') {
                results.skipped++;
                continue;
            }

            // Check if email was already sent
            if (checkout.emailSent === true) {
                results.skipped++;
                continue;
            }

            const customerEmail = checkout.email;
            if (!customerEmail) {
                results.skipped++;
                continue;
            }

            // Get customer name (try to get from customers collection)
            let customerName = 'Valued Customer';
            try {
                const customerResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'customers',
                    command: '--read',
                    data: { email: customerEmail }
                });

                if (customerResult.success && customerResult.data) {
                    const customer = customerResult.data;
                    customerName = customer.name || 
                                  `${customer.firstName || ''} ${customer.lastName || ''}`.trim() ||
                                  'Valued Customer';
                }
            } catch (error) {
                // Use default name if customer lookup fails
            }

            // Generate retry URL
            const paymentRetryUrl = generatePaymentRetryUrl(checkout.retryToken);

            // Send email
            const emailResult = await emailService.sendPaymentFailedEmail(
                customerEmail,
                customerName,
                checkout.orderId || 'N/A',
                paymentRetryUrl
            );

            if (emailResult.success) {
                // Mark email as sent
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'failed_checkouts',
                    command: '--update',
                    data: {
                        filter: { id: checkout.id },
                        update: {
                            emailSent: true,
                            emailSentAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        }
                    }
                });

                results.sent++;
                console.log(`✅ [PAYMENT FAILURE] Payment failure email sent to ${customerEmail}`, {
                    failedCheckoutId: checkout.id,
                    retryToken: checkout.retryToken,
                    messageId: emailResult.messageId,
                    timestamp: emailResult.timestamp
                });
            } else {
                results.errors++;
                console.error(`❌ [PAYMENT FAILURE] Failed to send email to ${customerEmail}:`, {
                    failedCheckoutId: checkout.id,
                    error: emailResult.error
                });
            }

            results.processed++;
        }

        console.log(`💳 [PAYMENT FAILURE] Processed ${results.processed} failed checkouts: ${results.sent} sent, ${results.skipped} skipped, ${results.errors} errors`);

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
    saveFailedCheckout,
    getFailedCheckoutByToken,
    markFailedCheckoutCompleted,
    processPendingPaymentFailures,
    generatePaymentRetryUrl
};
