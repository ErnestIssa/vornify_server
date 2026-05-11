const express = require('express');
const emailService = require('../services/emailService');
const getDBInstance = require('../vornifydb/dbInstance');
const crypto = require('crypto');

const router = express.Router();
const db = getDBInstance();
const { devLog } = require('../core/logging/devConsole');
const { logger } = require('../core/logging/logger');

/**
 * Generate unique discount code for welcome popup subscribers
 * Format: PEAK10-XXXXXX
 */
function generateDiscountCode() {
    const randomString = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `PEAK10-${randomString}`;
}

/**
 * POST /api/subscribers/subscribe
 * Unified subscription endpoint - backend controls all email logic
 * 
 * Frontend only sends: { email, source, wantsNewsletter?, wantsMarketing?, wantsDrops? }
 * Backend decides which email to send based on source and flags
 * 
 * Sources:
 * - welcome_popup: Only source that sends discount email
 * - checkout: Updates flags, sends confirmation emails (no discount)
 * - footer_drops: Sets wantsDrops=true, sends confirmation email (no discount)
 */
router.post('/subscribe', async (req, res) => {
    try {
        devLog('[SUBSCRIBERS] subscribe', { keys: req.body ? Object.keys(req.body) : [] });
        
        const { email, name, source, wantsNewsletter, wantsMarketing, wantsDrops } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        // Validate source - only 3 allowed sources
        if (!source || !['welcome_popup', 'checkout', 'footer_drops'].includes(source)) {
            return res.status(400).json({
                success: false,
                error: 'Valid source is required (welcome_popup, checkout, or footer_drops)'
            });
        }

        // Normalize email
        const normalizedEmail = email.trim().toLowerCase();
        const now = new Date().toISOString();

        // Check if subscriber already exists
        devLog('[SUBSCRIBERS] lookup', { emailHash: crypto.createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 12) });
        const existingResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: { email: normalizedEmail }
        });
        // Check if we have actual data (not just an empty array)
        const hasActualData = existingResult.success && 
            existingResult.data && 
            (Array.isArray(existingResult.data) ? existingResult.data.length > 0 : true);
        
        devLog('[SUBSCRIBERS] read result', {
            success: existingResult.success,
            hasActualData
        });

        let subscriber;
        let isNewSubscriber = false;

        if (hasActualData) {
            // EXISTING SUBSCRIBER - Update preferences
            const dataArray = Array.isArray(existingResult.data) ? existingResult.data : [existingResult.data];
            subscriber = dataArray.length > 0 ? dataArray[0] : null;
            
            if (!subscriber) {
                logger.error('subscribers_existing_row_invalid', { hasData: !!existingResult.data });
                return res.status(500).json({
                    success: false,
                    error: 'Subscriber data is invalid'
                });
            }
            
            devLog('[SUBSCRIBERS] updating existing', { source, wantsNewsletter: subscriber.wantsNewsletter, wantsDrops: subscriber.wantsDrops });

            // Store original preferences to detect changes
            const originalPreferences = {
                wantsNewsletter: subscriber.wantsNewsletter || false,
                wantsMarketing: subscriber.wantsMarketing || false,
                wantsDrops: subscriber.wantsDrops || false
            };

            const updates = {
                updatedAt: now
            };

            // Update name if provided
            if (name && name.trim()) {
                updates.name = name.trim();
            }

            // Determine new preference values
            let newWantsNewsletter = originalPreferences.wantsNewsletter;
            let newWantsMarketing = originalPreferences.wantsMarketing;
            let newWantsDrops = originalPreferences.wantsDrops;

            // Handle each source type
            if (source === 'welcome_popup') {
                // Welcome popup: Set wantsMarketing = true
                newWantsMarketing = true;
                updates.wantsMarketing = true;
            } else if (source === 'checkout') {
                // Checkout: Update flags based on what frontend sent
                if (wantsNewsletter !== undefined) {
                    newWantsNewsletter = wantsNewsletter;
                    updates.wantsNewsletter = wantsNewsletter;
                }
                if (wantsMarketing !== undefined) {
                    newWantsMarketing = wantsMarketing;
                    updates.wantsMarketing = wantsMarketing;
                }
                if (wantsDrops !== undefined) {
                    newWantsDrops = wantsDrops;
                    updates.wantsDrops = wantsDrops;
                }
            } else if (source === 'footer_drops') {
                // Footer drops: Set wantsDrops = true
                newWantsDrops = true;
                updates.wantsDrops = true;
            }

            // Calculate preference changes for email logic
            subscriber.preferencesChanged = {
                wantsNewsletter: newWantsNewsletter !== originalPreferences.wantsNewsletter,
                wantsMarketing: newWantsMarketing !== originalPreferences.wantsMarketing,
                wantsDrops: newWantsDrops !== originalPreferences.wantsDrops
            };
            subscriber.isExistingSubscriber = true;

            // Update subscriber in database
            const updateResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--update',
                data: {
                    filter: { email: normalizedEmail },
                    update: updates
                }
            });

            if (!updateResult.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to update subscriber preferences'
                });
            }

            // Get updated subscriber
            const updatedResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--read',
                data: { email: normalizedEmail }
            });

            // Preserve preferencesChanged flag before overwriting subscriber
            const savedPreferencesChanged = subscriber.preferencesChanged;
            const savedIsExistingSubscriber = subscriber.isExistingSubscriber;

            subscriber = updatedResult.success && updatedResult.data
                ? (Array.isArray(updatedResult.data) ? updatedResult.data[0] : updatedResult.data)
                : subscriber;
            
            // Restore flags after database read
            subscriber.isExistingSubscriber = savedIsExistingSubscriber;
            subscriber.preferencesChanged = savedPreferencesChanged;

        } else {
            // NEW SUBSCRIBER - Create record
            isNewSubscriber = true;
            devLog('[SUBSCRIBERS] creating new subscriber', { source });

            subscriber = {
                email: normalizedEmail,
                name: name ? name.trim() : '',
                wantsNewsletter: false,
                wantsMarketing: false,
                wantsDrops: false,
                welcomeDiscountSent: false,
                unsubscribed: false,
                createdAt: now,
                updatedAt: now
            };

            // Set initial flags based on source
            if (source === 'welcome_popup') {
                subscriber.wantsMarketing = true;
            } else if (source === 'checkout') {
                subscriber.wantsNewsletter = wantsNewsletter || false;
                subscriber.wantsMarketing = wantsMarketing || false;
                subscriber.wantsDrops = wantsDrops || false;
            } else if (source === 'footer_drops') {
                subscriber.wantsDrops = true;
            }

            // Create subscriber record
            const createResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--create',
                data: subscriber
            });

            if (!createResult.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create subscriber record'
                });
            }

            // Get created subscriber (with _id)
            const createdResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--read',
                data: { email: normalizedEmail }
            });

            subscriber = createdResult.success && createdResult.data
                ? (Array.isArray(createdResult.data) ? createdResult.data[0] : createdResult.data)
                : subscriber;
            
            // Mark as new subscriber for email logic
            subscriber.isExistingSubscriber = false;
            subscriber.preferencesChanged = null;
        }

        // ============================================
        // BACKEND CONTROLS EMAIL LOGIC (Frontend never decides)
        // ============================================

        const subscriberName = subscriber.name || name || 'Peak Mode Member';
        let emailsSent = [];

        if (source === 'welcome_popup') {
            // ============================================
            // WELCOME POPUP: Only source that sends discount email
            // ALWAYS send welcome email when resubscribing (if they have a discount code)
            // ============================================

            if (isNewSubscriber) {
                // NEW SUBSCRIBER - Generate discount code and send welcome email
                let discountCode = generateDiscountCode();
                
                // Store discount code in database
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'subscribers',
                        command: '--update',
                        data: {
                            filter: { email: normalizedEmail },
                            update: {
                                discountCode: discountCode,
                                discountCodeCreatedAt: new Date().toISOString(),
                                discountCodeExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
                                discountCodeUsed: false,
                                discountReminderSent: false,
                                welcomeDiscountSent: true
                            }
                        }
                    });

                // Send welcome email with discount code
                try {
                    const emailResult = await emailService.sendNewsletterWelcomeEmail(
                        normalizedEmail,
                        subscriberName,
                        discountCode
                    );

                    if (emailResult.success) {
                        emailsSent.push('welcome_discount');
                        devLog('[SUBSCRIBERS] welcome discount sent (new)');
                    } else {
                        logger.error('subscribers_welcome_discount_email_failed_new', { error: emailResult.error });
                    }
                } catch (emailError) {
                    logger.error('subscribers_welcome_discount_email_exception_new', { message: emailError.message });
                }

                // Update subscriber object with new discount code
                subscriber.discountCode = discountCode;
                subscriber.discountCodeExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

            } else {
                // EXISTING SUBSCRIBER RESUBSCRIBING - Check discount code status and send appropriate email
                if (subscriber.discountCode) {
                    // Check if code is used or expired
                    const isCodeUsed = subscriber.discountCodeUsed === true;
                    const isCodeExpired = subscriber.discountCodeExpiresAt 
                        ? new Date(subscriber.discountCodeExpiresAt) < new Date()
                        : false;
                    
                    if (isCodeUsed || isCodeExpired) {
                        // Code is used or expired - send used/expired notification
                        try {
                            const emailResult = await emailService.sendUsedExpiredDiscountNotificationEmail(
                                normalizedEmail,
                                subscriberName
                            );

                            if (emailResult.success) {
                                emailsSent.push('used_expired_discount_notification');
                                devLog('[SUBSCRIBERS] used/expired notification sent');
                            } else {
                                logger.error('subscribers_used_expired_notify_failed', { error: emailResult.error });
                            }
                        } catch (emailError) {
                            logger.error('subscribers_used_expired_notify_exception', { message: emailError.message });
                        }
                    } else {
                        // Code is valid - send discount code update email
                        try {
                            const emailResult = await emailService.sendDiscountCodeUpdateEmail(
                                normalizedEmail,
                                subscriberName,
                                subscriber.discountCode
                            );

                            if (emailResult.success) {
                                emailsSent.push('discount_reminder');
                                devLog('[SUBSCRIBERS] discount reminder sent');
                            } else {
                                logger.error('subscribers_discount_reminder_failed', { error: emailResult.error });
                            }
                        } catch (emailError) {
                            logger.error('subscribers_discount_reminder_exception', { message: emailError.message });
                        }
                    }
                } else {
                    // Existing subscriber but no discount code - generate one
                    const discountCode = generateDiscountCode();
                    
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'subscribers',
                        command: '--update',
                        data: {
                            filter: { email: normalizedEmail },
                            update: {
                                discountCode: discountCode,
                                discountCodeExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                                discountCodeUsed: false,
                                welcomeDiscountSent: true
                            }
                        }
                    });

                    try {
                        const emailResult = await emailService.sendNewsletterWelcomeEmail(
                            normalizedEmail,
                            subscriberName,
                            discountCode
                        );

                        if (emailResult.success) {
                            emailsSent.push('welcome_discount');
                            devLog('[SUBSCRIBERS] welcome discount sent (existing path)');
                        } else {
                            logger.error('subscribers_welcome_discount_resend_failed', { error: emailResult.error });
                        }
                    } catch (emailError) {
                        logger.error('subscribers_welcome_discount_resend_exception', { message: emailError.message });
                    }

                    subscriber.discountCode = discountCode;
                    subscriber.discountCodeExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
                }
            }

        } else if (source === 'checkout') {
            // ============================================
            // CHECKOUT: Send confirmation emails ONLY if preferences changed (NO DISCOUNT)
            // ============================================

            // Only send emails if preferences actually changed
            if (isNewSubscriber || (subscriber.preferencesChanged && (subscriber.preferencesChanged.wantsNewsletter || subscriber.preferencesChanged.wantsMarketing || subscriber.preferencesChanged.wantsDrops))) {
                // Send newsletter confirmation if wantsNewsletter is true AND (new subscriber OR preference changed)
                if (subscriber.wantsNewsletter && (isNewSubscriber || (subscriber.preferencesChanged && subscriber.preferencesChanged.wantsNewsletter))) {
                    try {
                        const emailResult = await emailService.sendNewsletterConfirmationEmail(
                            normalizedEmail,
                            subscriberName
                        );

                        if (emailResult.success) {
                            emailsSent.push('newsletter_confirmation');
                            devLog('[SUBSCRIBERS] newsletter confirmation sent');
                        } else {
                            logger.error('subscribers_newsletter_confirm_failed', { error: emailResult.error });
                        }
                    } catch (emailError) {
                        logger.error('subscribers_newsletter_confirm_exception', { message: emailError.message });
                    }
                }

                // Send marketing confirmation if wantsMarketing is true AND (new subscriber OR preference changed)
                if (subscriber.wantsMarketing && (isNewSubscriber || (subscriber.preferencesChanged && subscriber.preferencesChanged.wantsMarketing))) {
                    try {
                        const emailResult = await emailService.sendMarketingConfirmationEmail(
                            normalizedEmail,
                            subscriberName
                        );

                        if (emailResult.success) {
                            emailsSent.push('marketing_confirmation');
                            devLog('[SUBSCRIBERS] marketing confirmation sent');
                        } else {
                            logger.error('subscribers_marketing_confirm_failed', { error: emailResult.error });
                        }
                    } catch (emailError) {
                        logger.error('subscribers_marketing_confirm_exception', { message: emailError.message });
                    }
                }
            } else {
                // No preferences changed - don't send any emails
                devLog('[SUBSCRIBERS] no preference changes');
            }

        } else if (source === 'footer_drops') {
            // ============================================
            // FOOTER DROPS: Send confirmation email ONLY if wantsDrops was not already true (NO DISCOUNT)
            // ============================================

            // Only send email if this is a new subscriber OR wantsDrops preference changed
            if (isNewSubscriber || subscriber.preferencesChanged?.wantsDrops) {
                try {
                    const emailResult = await emailService.sendDropsConfirmationEmail(
                        normalizedEmail,
                        subscriberName
                    );

                    if (emailResult.success) {
                        emailsSent.push('drops_confirmation');
                        devLog('[SUBSCRIBERS] drops confirmation sent');
                    } else {
                        logger.error('subscribers_drops_confirm_failed', { error: emailResult.error });
                    }
                } catch (emailError) {
                    logger.error('subscribers_drops_confirm_exception', { message: emailError.message });
                }
            } else {
                // Already subscribed to drops - don't send duplicate email
                devLog('[SUBSCRIBERS] drops already subscribed');
            }
        }

        // Return response
        return res.json({
            success: true,
            isNewSubscriber: isNewSubscriber,
            emailsSent: emailsSent,
            message: emailsSent.length > 0 
                ? 'Subscription successful. Check your email for confirmation.' 
                : 'Subscription preferences updated.',
            data: {
                email: normalizedEmail,
                wantsNewsletter: subscriber.wantsNewsletter || false,
                wantsMarketing: subscriber.wantsMarketing || false,
                wantsDrops: subscriber.wantsDrops || false,
                discountCode: subscriber.discountCode || null,
                discountCodeExpiresAt: subscriber.discountCodeExpiresAt || null
            }
        });

    } catch (error) {
        logger.error('subscribers_subscribe_error', { message: error.message });
        devLog(error.stack);
        devLog('[SUBSCRIBERS] body keys on error', req.body ? Object.keys(req.body) : []);
        res.status(500).json({
            success: false,
            error: 'Failed to process subscription',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * POST /api/subscribers/update-preferences
 * Update subscriber preferences (used by checkout)
 */
router.post('/update-preferences', async (req, res) => {
    try {
        const { email, wantsNewsletter, wantsMarketing, wantsDrops } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const updates = {
            updatedAt: new Date().toISOString()
        };

        if (wantsNewsletter !== undefined) updates.wantsNewsletter = wantsNewsletter;
        if (wantsMarketing !== undefined) updates.wantsMarketing = wantsMarketing;
        if (wantsDrops !== undefined) updates.wantsDrops = wantsDrops;

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--update',
            data: {
                filter: { email: normalizedEmail },
                update: updates
            }
        });

        if (!updateResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to update preferences'
            });
        }

        res.json({
            success: true,
            message: 'Preferences updated successfully'
        });

    } catch (error) {
        logger.error('subscribers_update_prefs_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to update preferences',
            details: error.message
        });
    }
});

/**
 * POST /api/subscribers/unsubscribe
 * Unsubscribe from all emails
 */
router.post('/unsubscribe', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--update',
            data: {
                filter: { email: normalizedEmail },
                update: {
                    unsubscribed: true,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to unsubscribe'
            });
        }

        res.json({
            success: true,
            message: 'Successfully unsubscribed'
        });

    } catch (error) {
        logger.error('subscribers_unsubscribe_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to unsubscribe',
            details: error.message
        });
    }
});

/**
 * POST /api/subscribers/validate-discount
 * Validate a discount code
 * IMPORTANT: Use discount service for validation
 */
router.post('/validate-discount', async (req, res) => {
    try {
        const { discountCode } = req.body;
        const discountService = require('../services/discountService');
        const { ErrorCodes } = require('../core/errors/codes');

        if (!discountCode) {
            return res.status(400).json({
                success: false,
                valid: false,
                code: ErrorCodes.DISCOUNT_INVALID,
                error: 'Discount code is required',
                userMessage: discountService.discountUserMessage(ErrorCodes.DISCOUNT_INVALID)
            });
        }

        // Use discount service for validation
        const validation = await discountService.validateDiscountCode(discountCode);

        if (!validation.success) {
            return res.status(500).json({
                success: false,
                valid: false,
                code: validation.errorCode || ErrorCodes.DISCOUNT_UNAVAILABLE,
                error: validation.error || 'Failed to validate discount code',
                userMessage:
                    validation.userMessage ||
                    discountService.discountUserMessage(validation.errorCode || ErrorCodes.DISCOUNT_UNAVAILABLE),
                details: validation.details,
                requestId: req.requestId || req.headers['x-request-id'] || null
            });
        }

        if (!validation.valid) {
            return res.json({
                success: true,
                valid: false,
                code: validation.errorCode || ErrorCodes.DISCOUNT_INVALID,
                message: validation.error || 'Invalid discount code',
                userMessage: validation.userMessage || discountService.discountUserMessage(validation.errorCode)
            });
        }

        res.json({
            success: true,
            valid: true,
            discountCode: validation.discountCode,
            discountPercentage: validation.discountPercentage,
            expiresAt: validation.expiresAt,
            message: validation.message || 'Discount code is valid'
        });

    } catch (error) {
        logger.error('subscribers_validate_discount_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to validate discount code',
            details: error.message
        });
    }
});

/**
 * POST /api/subscribers/use-discount
 * Mark discount code as used
 */
router.post('/use-discount', async (req, res) => {
    try {
        const { discountCode } = req.body;
        const discountService = require('../services/discountService');
        const { ErrorCodes } = require('../core/errors/codes');

        if (!discountCode) {
            return res.status(400).json({
                success: false,
                code: ErrorCodes.DISCOUNT_INVALID,
                error: 'Discount code is required'
            });
        }

        const markResult = await discountService.markDiscountCodeAsUsed(discountCode, null);

        if (!markResult.success) {
            const status = markResult.errorCode === ErrorCodes.DISCOUNT_ALREADY_USED ? 409 : 500;
            return res.status(status).json({
                success: false,
                code: markResult.errorCode || ErrorCodes.DISCOUNT_UNAVAILABLE,
                error: markResult.error || 'Failed to mark discount code as used',
                userMessage:
                    status === 409
                        ? discountService.discountUserMessage(ErrorCodes.DISCOUNT_ALREADY_USED)
                        : discountService.discountUserMessage(markResult.errorCode || ErrorCodes.DISCOUNT_UNAVAILABLE),
                conflict: markResult.conflict === true,
                requestId: req.requestId || req.headers['x-request-id'] || null
            });
        }

        res.json({
            success: true,
            message: markResult.idempotent === true ? 'Discount code already marked as used' : 'Discount code marked as used'
        });

    } catch (error) {
        logger.error('subscribers_use_discount_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to mark discount code as used',
            details: error.message
        });
    }
});

/**
 * GET /api/subscribers/:email
 * Get subscriber information
 */
router.get('/:email', async (req, res) => {
    try {
        const { email } = req.params;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: { email: normalizedEmail }
        });

        if (!result.success || !result.data) {
            return res.status(404).json({
                success: false,
                error: 'Subscriber not found'
            });
        }

        const subscriber = Array.isArray(result.data) ? result.data[0] : result.data;

        res.json({
            success: true,
            data: {
                email: subscriber.email,
                name: subscriber.name || '',
                wantsNewsletter: subscriber.wantsNewsletter || false,
                wantsMarketing: subscriber.wantsMarketing || false,
                wantsDrops: subscriber.wantsDrops || false,
                welcomeDiscountSent: subscriber.welcomeDiscountSent || false,
                unsubscribed: subscriber.unsubscribed || false,
                discountCode: subscriber.discountCode || null,
                discountCodeExpiresAt: subscriber.discountCodeExpiresAt || null,
                discountCodeUsed: subscriber.discountCodeUsed || false,
                createdAt: subscriber.createdAt,
                updatedAt: subscriber.updatedAt
            }
        });

    } catch (error) {
        logger.error('subscribers_get_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to get subscriber information',
            details: error.message
        });
    }
});

module.exports = router;
