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
        // Try multiple ways to get customer email
        let customerEmail = order.customer?.email || 
                           order.customerEmail || 
                           paymentIntent.receipt_email ||
                           paymentIntent.metadata?.customerEmail ||
                           null;
        
        // If still no email, try to get from payment intent customer
        if (!customerEmail && paymentIntent.customer) {
            try {
                const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                const customer = await stripe.customers.retrieve(paymentIntent.customer);
                customerEmail = customer.email || null;
            } catch (error) {
                console.warn('⚠️ [PAYMENT FAILURE] Could not retrieve customer email from Stripe:', error.message);
            }
        }
        
        if (!customerEmail) {
            console.warn('⚠️ [PAYMENT FAILURE] No customer email found in order or payment intent, cannot save failed checkout', {
                hasOrderCustomer: !!order.customer,
                hasOrderCustomerEmail: !!order.customerEmail,
                hasReceiptEmail: !!paymentIntent.receipt_email,
                hasMetadataEmail: !!paymentIntent.metadata?.customerEmail,
                hasStripeCustomer: !!paymentIntent.customer
            });
            return {
                success: false,
                error: 'No customer email found in order or payment intent'
            };
        }

        const retryToken = generateRetryToken();
        
        // Extract cart items from order
        const cartItems = order.items || [];
        
        // Calculate total from order
        const total = order.totals?.total || order.total || (paymentIntent.amount / 100);

        // Build failed checkout object, only including fields with values (avoid null)
        const failedCheckout = {
            id: `failed_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            email: customerEmail.toLowerCase().trim(),
            cart: Array.isArray(cartItems) ? cartItems : [],
            total: typeof total === 'number' ? total : 0,
            status: 'failed',
            retryToken: retryToken,
            emailSent: false,
            paymentIntentId: paymentIntent.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Only add optional fields if they have values
        if (order.orderId) failedCheckout.orderId = order.orderId;
        if (order.customer && typeof order.customer === 'object' && Object.keys(order.customer).length > 0) {
            failedCheckout.customer = order.customer;
        }
        if (order.shippingAddress && typeof order.shippingAddress === 'object' && Object.keys(order.shippingAddress).length > 0) {
            failedCheckout.shippingAddress = order.shippingAddress;
        }
        if (order.shippingMethod && typeof order.shippingMethod === 'object' && Object.keys(order.shippingMethod).length > 0) {
            failedCheckout.shippingMethod = order.shippingMethod;
        }

        // Log before save for debugging
        console.log('💾 [PAYMENT FAILURE] Attempting to save failed checkout:', {
            id: failedCheckout.id,
            email: failedCheckout.email,
            total: failedCheckout.total,
            itemsCount: cartItems.length,
            retryToken: retryToken
        });

        // Save to failed_checkouts collection
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'failed_checkouts',
            command: '--create',
            data: failedCheckout
        });

        // Log result for debugging
        console.log('💾 [PAYMENT FAILURE] Database save result:', {
            success: saveResult.success,
            status: saveResult.status,
            message: saveResult.message,
            error: saveResult.error,
            data: saveResult.data ? 'present' : 'missing'
        });

        // Check both success and status (VornifyDB may use either)
        const isSuccess = saveResult.success === true || saveResult.status === true || saveResult.success !== false;

        if (isSuccess) {
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
            console.error('❌ [PAYMENT FAILURE] Failed to save failed checkout:', {
                success: saveResult.success,
                status: saveResult.status,
                message: saveResult.message,
                error: saveResult.error,
                fullResult: JSON.stringify(saveResult, null, 2)
            });
            return {
                success: false,
                error: 'Failed to save failed checkout',
                details: saveResult.message || saveResult.error || 'Unknown database error'
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

        // Find all failed checkouts (VornifyDB doesn't support complex queries)
        // We'll filter in memory for eligibility
        const checkoutsResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'failed_checkouts',
            command: '--read',
            data: {
                status: 'failed'
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
        const checkoutsArray = Array.isArray(checkouts) ? checkouts : (checkouts ? [checkouts] : []);

        // Filter checkouts in memory for eligibility
        const eligibleCheckouts = checkoutsArray.filter(checkout => {
            // Must be failed status
            if (checkout.status !== 'failed') return false;
            
            // Email must not be sent
            if (checkout.emailSent === true) return false;
            
            // Must have email
            if (!checkout.email) return false;
            
            // Must be created more than 3 minutes ago
            const createdAt = new Date(checkout.createdAt);
            const minutesElapsed = Math.floor((now - createdAt) / (60 * 1000));
            if (minutesElapsed < 3) return false;
            
            return true;
        });

        console.log(`💳 [PAYMENT FAILURE] Found ${checkoutsArray.length} failed checkouts, ${eligibleCheckouts.length} eligible for emails`);

        const results = {
            total: eligibleCheckouts.length,
            processed: 0,
            sent: 0,
            skipped: 0,
            errors: 0
        };

        for (const checkout of eligibleCheckouts) {

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
