const emailService = require('./emailService');
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

/**
 * Process discount reminder for a single subscriber
 * Sends reminder email if code is unused and was created 7+ days ago
 */
async function processDiscountReminder(subscriber) {
    try {
        // Check if subscriber has a discount code
        if (!subscriber.discountCode) {
            return {
                success: false,
                skipped: true,
                reason: 'No discount code'
            };
        }

        // Check if code is already used
        if (subscriber.discountCodeUsed === true) {
            return {
                success: false,
                skipped: true,
                reason: 'Discount code already used'
            };
        }

        // Check if code is expired
        if (subscriber.discountCodeExpiresAt) {
            const expiresAt = new Date(subscriber.discountCodeExpiresAt);
            if (expiresAt < new Date()) {
                return {
                    success: false,
                    skipped: true,
                    reason: 'Discount code expired'
                };
            }
        }

        // Check if reminder was already sent
        if (subscriber.discountReminderSent === true) {
            return {
                success: false,
                skipped: true,
                reason: 'Discount reminder already sent'
            };
        }

        // Check if code was created 7+ days ago
        // Use discountCodeCreatedAt if available, otherwise use createdAt (for backward compatibility)
        // For new subscribers, discountCode is created at the same time as the subscriber record
        const codeCreatedAt = subscriber.discountCodeCreatedAt || subscriber.createdAt;
        
        if (!codeCreatedAt) {
            return {
                success: false,
                skipped: true,
                reason: 'No code creation date found'
            };
        }

        const createdAt = new Date(codeCreatedAt);
        const now = new Date();
        const daysSinceCreation = (now - createdAt) / (1000 * 60 * 60 * 24);

        if (daysSinceCreation < 7) {
            return {
                success: false,
                skipped: true,
                reason: `Code created ${daysSinceCreation.toFixed(1)} days ago (need 7+ days)`
            };
        }

        // Get subscriber name
        const subscriberName = subscriber.name || 'Peak Mode Member';
        const subscriberEmail = subscriber.email;

        console.log(`📧 [DISCOUNT REMINDER] Sending reminder to ${subscriberEmail} (code created ${daysSinceCreation.toFixed(1)} days ago)`);

        // Send discount reminder email
        const emailResult = await emailService.sendDiscountReminderEmail(
            subscriberEmail,
            subscriberName,
            subscriber.discountCode
        );

        if (emailResult.success) {
            // Mark reminder as sent
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--update',
                data: {
                    filter: { email: subscriberEmail },
                    update: {
                        discountReminderSent: true,
                        updatedAt: new Date().toISOString()
                    }
                }
            });

            console.log(`✅ [DISCOUNT REMINDER] Reminder sent to ${subscriberEmail} with code: ${subscriber.discountCode}`);

            return {
                success: true,
                sent: true,
                email: subscriberEmail,
                code: subscriber.discountCode
            };
        } else {
            console.error(`❌ [DISCOUNT REMINDER] Failed to send reminder to ${subscriberEmail}:`, emailResult.error);
            return {
                success: false,
                error: emailResult.error,
                email: subscriberEmail
            };
        }

    } catch (error) {
        console.error(`❌ [DISCOUNT REMINDER] Error processing reminder for ${subscriber.email}:`, error);
        return {
            success: false,
            error: error.message,
            email: subscriber.email
        };
    }
}

/**
 * Process all eligible subscribers for discount reminders
 * Runs periodically to check for subscribers with unused codes created 7+ days ago
 */
async function processDiscountReminders() {
    try {
        console.log('📧 [DISCOUNT REMINDER] Starting discount reminder check...');

        // Fetch all subscribers with discount codes
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: {} // Get all subscribers, we'll filter in memory
        });

        if (!result.success || !result.data) {
            console.log('📧 [DISCOUNT REMINDER] No subscribers found or database error');
            return {
                success: true,
                processed: 0,
                sent: 0,
                skipped: 0,
                errors: 0
            };
        }

        const subscribers = Array.isArray(result.data) ? result.data : [result.data];
        
        // Filter eligible subscribers in memory
        const eligibleSubscribers = subscribers.filter(sub => {
            // Must have discount code
            if (!sub.discountCode) return false;

            // Must not be used
            if (sub.discountCodeUsed === true) return false;

            // Must not have reminder sent already
            if (sub.discountReminderSent === true) return false;

            // Must have createdAt date
            if (!sub.createdAt) return false;

            // Must not be expired
            if (sub.discountCodeExpiresAt) {
                const expiresAt = new Date(sub.discountCodeExpiresAt);
                if (expiresAt < new Date()) return false;
            }

            // Must be 7+ days old (use discountCodeCreatedAt if available, otherwise createdAt)
            const codeCreatedAt = sub.discountCodeCreatedAt || sub.createdAt;
            if (!codeCreatedAt) return false;
            
            const createdAt = new Date(codeCreatedAt);
            const now = new Date();
            const daysSinceCreation = (now - createdAt) / (1000 * 60 * 60 * 24);
            
            return daysSinceCreation >= 7;
        });

        console.log(`📧 [DISCOUNT REMINDER] Found ${eligibleSubscribers.length} eligible subscribers (out of ${subscribers.length} total)`);

        // Process each eligible subscriber
        let sent = 0;
        let skipped = 0;
        let errors = 0;

        for (const subscriber of eligibleSubscribers) {
            const result = await processDiscountReminder(subscriber);
            
            if (result.success && result.sent) {
                sent++;
            } else if (result.skipped) {
                skipped++;
            } else {
                errors++;
            }
        }

        console.log(`📧 [DISCOUNT REMINDER] Processed ${eligibleSubscribers.length} subscribers: ${sent} sent, ${skipped} skipped, ${errors} errors`);

        return {
            success: true,
            processed: eligibleSubscribers.length,
            sent,
            skipped,
            errors
        };

    } catch (error) {
        console.error('❌ [DISCOUNT REMINDER] Error processing discount reminders:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    processDiscountReminders,
    processDiscountReminder
};

