const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('./emailService');
const db = getDBInstance();

// Abandoned checkout detection settings
const ABANDONED_CHECKOUT_TIMEOUT_1 = 10 * 60 * 1000; // 10 minutes for first email
const ABANDONED_CHECKOUT_TIMEOUT_2 = 20 * 60 * 1000; // 20 minutes (10 + 10) for second email

/**
 * Format cart items for email
 * @param {array} cartItems - Cart items array
 * @returns {array} Formatted items array
 */
function formatCartItemsForEmail(cartItems) {
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
        return [];
    }
    
    return cartItems.map(item => ({
        name: item.name || 'Product',
        quantity: item.quantity || 1,
        displayPrice: `${(item.price || 0) * (item.quantity || 1)} SEK`
    }));
}

/**
 * Generate checkout recovery URL
 * This URL should take the user back to checkout with their abandoned cart restored
 * @param {string} checkoutId - Checkout ID
 * @returns {string} Checkout recovery URL
 */
function generateCheckoutUrl(checkoutId) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://peakmode.se';
    // Frontend should handle ?recover=checkoutId and call GET /api/checkout/recover/:checkoutId
    return `${frontendUrl}/checkout?recover=${checkoutId}`;
}

/**
 * Process abandoned checkout and send email
 * @param {object} checkout - Abandoned checkout object
 * @param {number} timeoutMinutes - Minutes since checkout was created
 * @returns {Promise<object>} Result object
 */
async function processAbandonedCheckout(checkout, timeoutMinutes) {
    try {
        // Check if checkout is completed
        if (checkout.status === 'completed') {
            return {
                success: false,
                skipped: true,
                reason: 'Checkout already completed'
            };
        }

        // Determine which email to send
        const isFirstEmail = !checkout.emailSent || checkout.emailSent === false;
        const isSecondEmail = checkout.emailSent === true && !checkout.secondEmailSent;
        
        // Check timing for first email (10 minutes)
        if (isFirstEmail && timeoutMinutes < 10) {
            return {
                success: false,
                skipped: true,
                reason: `Not yet 10 minutes (${timeoutMinutes} minutes elapsed)`
            };
        }
        
        // Check timing for second email (20 minutes total, 10 minutes after first)
        if (isSecondEmail && timeoutMinutes < 20) {
            return {
                success: false,
                skipped: true,
                reason: `Not yet 20 minutes for second email (${timeoutMinutes} minutes elapsed)`
            };
        }
        
        // If both emails sent, skip
        if (checkout.emailSent === true && checkout.secondEmailSent === true) {
            return {
                success: false,
                skipped: true,
                reason: 'Both emails already sent'
            };
        }

        const customerEmail = checkout.email;
        if (!customerEmail) {
            return {
                success: false,
                skipped: true,
                reason: 'No email in checkout'
            };
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

        // Format cart data
        const formattedItems = formatCartItemsForEmail(checkout.cart);
        const cartTotal = `${checkout.total || 0} SEK`;
        const cartUrl = generateCheckoutUrl(checkout.id);

        console.log(`📧 [ABANDONED CHECKOUT] Preparing to send email for checkout ${checkout.id}:`, {
            email: customerEmail,
            name: customerName,
            itemsCount: formattedItems.length,
            cartTotal: cartTotal,
            cartUrl: cartUrl
        });

        // Send email
        const emailResult = await emailService.sendAbandonedCartEmail(
            customerEmail,
            customerName,
            formattedItems,
            cartTotal,
            cartUrl
        );

        if (emailResult.success) {
            // Mark appropriate email as sent
            const updateData = {
                updatedAt: new Date().toISOString()
            };
            
            if (isFirstEmail) {
                updateData.emailSent = true;
                updateData.emailSentAt = new Date().toISOString();
                updateData.firstEmailSentAt = new Date().toISOString();
            } else if (isSecondEmail) {
                updateData.secondEmailSent = true;
                updateData.secondEmailSentAt = new Date().toISOString();
            }
            
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'abandoned_checkouts',
                command: '--update',
                data: {
                    filter: { id: checkout.id },
                    update: updateData
                }
            });
            
            const emailType = isFirstEmail ? 'first' : 'second';
            console.log(`✅ [ABANDONED CHECKOUT] ${emailType.charAt(0).toUpperCase() + emailType.slice(1)} email sent successfully to ${customerEmail} for checkout ${checkout.id}`, {
                emailType: emailType,
                messageId: emailResult.messageId,
                timestamp: emailResult.timestamp,
                itemsCount: formattedItems.length,
                cartTotal: cartTotal,
                minutesElapsed: timeoutMinutes
            });
            
            return {
                success: true,
                emailSent: true,
                emailType: emailType,
                customerEmail: customerEmail,
                messageId: emailResult.messageId
            };
        } else {
            console.error(`❌ [ABANDONED CHECKOUT] Failed to send email to ${customerEmail} for checkout ${checkout.id}:`, {
                error: emailResult.error,
                details: emailResult.details,
                itemsCount: formattedItems.length
            });
            
            return {
                success: false,
                emailSent: false,
                error: emailResult.error
            };
        }
    } catch (error) {
        console.error('❌ [ABANDONED CHECKOUT] Error processing abandoned checkout:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Find and process all abandoned checkouts
 * @returns {Promise<object>} Summary of processing
 */
async function processAbandonedCheckouts() {
    try {
        console.log('🛒 [ABANDONED CHECKOUT] Starting abandoned checkout check...');
        
        const now = new Date();
        const cutoffTime1 = new Date(now - ABANDONED_CHECKOUT_TIMEOUT_1); // 10 minutes ago
        const cutoffTime2 = new Date(now - ABANDONED_CHECKOUT_TIMEOUT_2); // 20 minutes ago

        // Find all checkouts that:
        // 1. Status is 'pending' (not completed)
        // 2. Created more than 10 minutes ago (for first email) OR 20 minutes ago (for second email)
        // 3. First email not sent OR second email not sent
        const checkoutsResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--read',
            data: {
                status: 'pending',
                $or: [
                    // First email: created > 10 mins ago, emailSent = false
                    {
                        createdAt: { $lt: cutoffTime1.toISOString() },
                        $or: [
                            { emailSent: { $exists: false } },
                            { emailSent: false }
                        ]
                    },
                    // Second email: created > 20 mins ago, emailSent = true, secondEmailSent = false
                    {
                        createdAt: { $lt: cutoffTime2.toISOString() },
                        emailSent: true,
                        $or: [
                            { secondEmailSent: { $exists: false } },
                            { secondEmailSent: false }
                        ]
                    }
                ]
            }
        });

        if (!checkoutsResult.success) {
            console.error('❌ [ABANDONED CHECKOUT] Failed to fetch checkouts:', checkoutsResult);
            return {
                success: false,
                error: 'Failed to fetch checkouts'
            };
        }

        const checkouts = checkoutsResult.data || [];
        const checkoutsArray = Array.isArray(checkouts) ? checkouts : [checkouts];

        const results = {
            total: checkoutsArray.length,
            processed: 0,
            sent: 0,
            skipped: 0,
            errors: 0,
            details: []
        };
        
        for (const checkout of checkoutsArray) {
            // Calculate minutes since checkout was created
            const createdAt = new Date(checkout.createdAt);
            const minutesElapsed = Math.floor((now - createdAt) / (60 * 1000));
            
            const result = await processAbandonedCheckout(checkout, minutesElapsed);
            
            if (result.success && result.emailSent) {
                results.sent++;
            } else if (result.skipped) {
                results.skipped++;
            } else {
                results.errors++;
            }
            
            results.processed++;
            results.details.push({
                checkoutId: checkout.id,
                email: checkout.email,
                status: result.success ? 'sent' : (result.skipped ? 'skipped' : 'error'),
                reason: result.reason || result.error,
                emailType: result.emailType || null,
                minutesElapsed: minutesElapsed
            });
        }
        
        console.log(`🛒 [ABANDONED CHECKOUT] Processed ${results.processed} checkouts: ${results.sent} sent, ${results.skipped} skipped, ${results.errors} errors`);
        
        return {
            success: true,
            ...results
        };
    } catch (error) {
        console.error('❌ [ABANDONED CHECKOUT] Error processing abandoned checkouts:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    processAbandonedCheckouts,
    processAbandonedCheckout,
    formatCartItemsForEmail,
    generateCheckoutUrl
};

