const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('./emailService');
const crypto = require('crypto');
const { devLog, devWarn } = require('../core/logging/devConsole');
const { logger } = require('../core/logging/logger');

const db = getDBInstance();

// Payment failure email delays
const PAYMENT_FAILURE_EMAIL_DELAY_1 = 10 * 60 * 1000; // 10 minutes for first email
const PAYMENT_FAILURE_EMAIL_DELAY_2 = 20 * 60 * 1000; // 20 minutes for second email (10 minutes after first)

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
    devLog('[PAYMENT FAILURE] saveFailedCheckout', {
        hasPaymentIntent: !!paymentIntent,
        hasOrder: !!order,
        paymentIntentId: paymentIntent?.id || null,
        orderId: order?.orderId || null,
        hasCustomerEmail: !!(order?.customer?.email || order?.customerEmail)
    });

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
                logger.warn('payment_failure_customer_email_lookup_failed', { message: error.message });
            }
        }
        
        if (!customerEmail) {
            logger.warn('payment_failure_no_customer_email', {
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
            secondEmailSent: false,
            paymentIntentId: paymentIntent.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Only add optional fields if they have values
        // Try to get orderId from order first, then from payment intent metadata
        const orderId = order.orderId || paymentIntent.metadata?.orderId || null;
        if (orderId) failedCheckout.orderId = orderId;
        if (order.customer && typeof order.customer === 'object' && Object.keys(order.customer).length > 0) {
            failedCheckout.customer = order.customer;
        }
        if (order.shippingAddress && typeof order.shippingAddress === 'object' && Object.keys(order.shippingAddress).length > 0) {
            failedCheckout.shippingAddress = order.shippingAddress;
        }
        if (order.shippingMethod && typeof order.shippingMethod === 'object' && Object.keys(order.shippingMethod).length > 0) {
            failedCheckout.shippingMethod = order.shippingMethod;
        }

        devLog('[PAYMENT FAILURE] saving failed checkout', {
            id: failedCheckout.id,
            total: failedCheckout.total,
            itemsCount: cartItems.length
        });

        // Save to failed_checkouts collection
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'failed_checkouts',
            command: '--create',
            data: failedCheckout
        });

        devLog('[PAYMENT FAILURE] save result', {
            success: saveResult.success,
            status: saveResult.status,
            message: saveResult.message,
            hasData: Boolean(saveResult.data)
        });

        // Check both success and status (VornifyDB may use either)
        const isSuccess = saveResult.success === true || saveResult.status === true || saveResult.success !== false;

        if (isSuccess) {
            devLog('[PAYMENT FAILURE] saved', { id: failedCheckout.id });

            return {
                success: true,
                retryToken: retryToken,
                failedCheckoutId: failedCheckout.id
            };
        } else {
            logger.error('payment_failure_save_failed_checkout_failed', {
                success: saveResult.success,
                status: saveResult.status,
                message: saveResult.message,
                error: saveResult.error
            });
            return {
                success: false,
                error: 'Failed to save failed checkout',
                details: saveResult.message || saveResult.error || 'Unknown database error'
            };
        }
    } catch (error) {
        logger.error('payment_failure_save_failed_checkout_exception', { message: error.message });
        devWarn(error.stack);
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
        logger.error('payment_failure_get_by_token_error', { message: error.message });
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
        logger.error('payment_failure_mark_completed_error', { message: error.message });
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
        devLog('[PAYMENT FAILURE] processing pending failures');
        
        const now = new Date();

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
            logger.error('payment_failure_fetch_failed_checkouts_failed', { error: checkoutsResult?.error || null });
            return {
                success: false,
                error: 'Failed to fetch failed checkouts'
            };
        }

        const checkouts = checkoutsResult.data || [];
        const checkoutsArray = Array.isArray(checkouts) ? checkouts : (checkouts ? [checkouts] : []);

        // Filter checkouts in memory for eligibility
        // Separate into first email (10 minutes) and second email (20 minutes) eligible checkouts
        const firstEmailCheckouts = [];
        const secondEmailCheckouts = [];
        
        checkoutsArray.forEach(checkout => {
            // Must be failed status
            if (checkout.status !== 'failed') return;
            
            // Must have email
            if (!checkout.email) return;
            
            const createdAt = new Date(checkout.createdAt);
            const minutesElapsed = Math.floor((now - createdAt) / (60 * 1000));
            
            // First email: not sent yet, created more than 10 minutes ago
            if (!checkout.emailSent && minutesElapsed >= 10) {
                firstEmailCheckouts.push(checkout);
            }
            // Second email: first email sent, second not sent, created more than 20 minutes ago
            else if (checkout.emailSent && !checkout.secondEmailSent && minutesElapsed >= 20) {
                secondEmailCheckouts.push(checkout);
            }
        });
        
        const eligibleCheckouts = [...firstEmailCheckouts, ...secondEmailCheckouts];

        devLog('[PAYMENT FAILURE] eligible', { total: checkoutsArray.length, eligible: eligibleCheckouts.length });

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
            
            // Determine if this is first or second email
            const isSecondEmail = checkout.emailSent === true && !checkout.secondEmailSent;
            const emailType = isSecondEmail ? 'second' : 'first';

            // Get order number - try checkout.orderId, then payment intent metadata
            let orderNumber = checkout.orderId || 'N/A';
            if (orderNumber === 'N/A' && checkout.paymentIntentId) {
                try {
                    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                    const paymentIntent = await stripe.paymentIntents.retrieve(checkout.paymentIntentId);
                    orderNumber = paymentIntent.metadata?.orderId || 'N/A';
                } catch (error) {
                    logger.warn('payment_failure_pi_orderid_lookup_failed', { message: error.message });
                }
            }

            // Send email
            const emailResult = await emailService.sendPaymentFailedEmail(
                customerEmail,
                customerName,
                orderNumber,
                paymentRetryUrl
            );

            if (emailResult.success) {
                // Mark appropriate email as sent
                const updateData = {
                    updatedAt: new Date().toISOString()
                };
                
                if (isSecondEmail) {
                    updateData.secondEmailSent = true;
                    updateData.secondEmailSentAt = new Date().toISOString();
                } else {
                    updateData.emailSent = true;
                    updateData.emailSentAt = new Date().toISOString();
                }
                
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'failed_checkouts',
                    command: '--update',
                    data: {
                        filter: { id: checkout.id },
                        update: updateData
                    }
                });

                results.sent++;
                devLog('[PAYMENT FAILURE] email sent', { type: emailType, failedCheckoutId: checkout.id });
            } else {
                results.errors++;
                logger.error('payment_failure_email_send_failed', {
                    type: emailType,
                    failedCheckoutId: checkout.id,
                    error: emailResult.error
                });
            }

            results.processed++;
        }

        devLog('[PAYMENT FAILURE] processed', results);

        return {
            success: true,
            ...results
        };
    } catch (error) {
        logger.error('payment_failure_process_pending_error', { message: error.message });
        devWarn(error.stack);
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
