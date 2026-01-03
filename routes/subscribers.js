const express = require('express');
const emailService = require('../services/emailService');
const getDBInstance = require('../vornifydb/dbInstance');
const crypto = require('crypto');

const router = express.Router();
const db = getDBInstance();

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
        const existingResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: { email: normalizedEmail }
        });

        let subscriber;
        let isNewSubscriber = false;

        if (existingResult.success && existingResult.data) {
            // EXISTING SUBSCRIBER - Update preferences
            subscriber = Array.isArray(existingResult.data) ? existingResult.data[0] : existingResult.data;
            console.log(`✅ [SUBSCRIBERS] Updating existing subscriber: ${normalizedEmail} from source: ${source}`);

            const updates = {
                updatedAt: now
            };

            // Update name if provided
            if (name && name.trim()) {
                updates.name = name.trim();
            }

            // Handle each source type
            if (source === 'welcome_popup') {
                // Welcome popup: Set wantsMarketing = true
                updates.wantsMarketing = true;
            } else if (source === 'checkout') {
                // Checkout: Update flags based on what frontend sent
                if (wantsNewsletter !== undefined) updates.wantsNewsletter = wantsNewsletter;
                if (wantsMarketing !== undefined) updates.wantsMarketing = wantsMarketing;
                if (wantsDrops !== undefined) updates.wantsDrops = wantsDrops;
            } else if (source === 'footer_drops') {
                // Footer drops: Set wantsDrops = true
                updates.wantsDrops = true;
            }

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

            subscriber = updatedResult.success && updatedResult.data
                ? (Array.isArray(updatedResult.data) ? updatedResult.data[0] : updatedResult.data)
                : subscriber;

        } else {
            // NEW SUBSCRIBER - Create record
            isNewSubscriber = true;
            console.log(`✅ [SUBSCRIBERS] Creating new subscriber: ${normalizedEmail} from source: ${source}`);

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
        }

        // ============================================
        // BACKEND CONTROLS EMAIL LOGIC (Frontend never decides)
        // ============================================

        const subscriberName = subscriber.name || name || 'Peak Mode Member';
        let emailsSent = [];

        if (source === 'welcome_popup') {
            // ============================================
            // WELCOME POPUP: Only source that sends discount email
            // ============================================

            // Check if discount email should be sent
            if (!subscriber.welcomeDiscountSent) {
                // Generate discount code for new subscribers
                let discountCode = subscriber.discountCode;
                
                if (!discountCode) {
                    discountCode = generateDiscountCode();
                    
                    // Store discount code in database
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'subscribers',
                        command: '--update',
                        data: {
                            filter: { email: normalizedEmail },
                            update: {
                                discountCode: discountCode,
                                discountCodeExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
                                discountCodeUsed: false
                            }
                        }
                    });
                }

                // Send welcome email with discount code
                try {
                    const emailResult = await emailService.sendNewsletterWelcomeEmail(
                        normalizedEmail,
                        subscriberName,
                        discountCode
                    );

                    if (emailResult.success) {
                        emailsSent.push('welcome_discount');
                        
                        // Mark welcomeDiscountSent = true
                        await db.executeOperation({
                            database_name: 'peakmode',
                            collection_name: 'subscribers',
                            command: '--update',
                            data: {
                                filter: { email: normalizedEmail },
                                update: { welcomeDiscountSent: true }
                            }
                        });
                        
                        console.log(`✅ [SUBSCRIBERS] Welcome discount email sent to ${normalizedEmail} with code: ${discountCode}`);
                    } else {
                        console.error(`❌ [SUBSCRIBERS] Failed to send welcome discount email to ${normalizedEmail}:`, emailResult.error);
                    }
                } catch (emailError) {
                    console.error(`❌ [SUBSCRIBERS] Exception sending welcome discount email to ${normalizedEmail}:`, emailError);
                }
            } else {
                // Existing subscriber resubscribing via welcome popup - resend email with same code
                if (subscriber.discountCode) {
                    try {
                        const emailResult = await emailService.sendNewsletterWelcomeEmail(
                            normalizedEmail,
                            subscriberName,
                            subscriber.discountCode
                        );

                        if (emailResult.success) {
                            emailsSent.push('welcome_discount_resent');
                            console.log(`✅ [SUBSCRIBERS] Welcome discount email resent to ${normalizedEmail} with existing code: ${subscriber.discountCode}`);
                        } else {
                            console.error(`❌ [SUBSCRIBERS] Failed to resend welcome discount email to ${normalizedEmail}:`, emailResult.error);
                        }
                    } catch (emailError) {
                        console.error(`❌ [SUBSCRIBERS] Exception resending welcome discount email to ${normalizedEmail}:`, emailError);
                    }
                }
            }

        } else if (source === 'checkout') {
            // ============================================
            // CHECKOUT: Send confirmation emails based on flags (NO DISCOUNT)
            // ============================================

            // Send newsletter confirmation if wantsNewsletter is true
            if (subscriber.wantsNewsletter) {
                try {
                    const emailResult = await emailService.sendNewsletterConfirmationEmail(
                        normalizedEmail,
                        subscriberName
                    );

                    if (emailResult.success) {
                        emailsSent.push('newsletter_confirmation');
                        console.log(`✅ [SUBSCRIBERS] Newsletter confirmation email sent to ${normalizedEmail}`);
                    } else {
                        console.error(`❌ [SUBSCRIBERS] Failed to send newsletter confirmation email to ${normalizedEmail}:`, emailResult.error);
                    }
                } catch (emailError) {
                    console.error(`❌ [SUBSCRIBERS] Exception sending newsletter confirmation email to ${normalizedEmail}:`, emailError);
                }
            }

            // Send marketing confirmation if wantsMarketing is true
            if (subscriber.wantsMarketing) {
                try {
                    const emailResult = await emailService.sendMarketingConfirmationEmail(
                        normalizedEmail,
                        subscriberName
                    );

                    if (emailResult.success) {
                        emailsSent.push('marketing_confirmation');
                        console.log(`✅ [SUBSCRIBERS] Marketing confirmation email sent to ${normalizedEmail}`);
                    } else {
                        console.error(`❌ [SUBSCRIBERS] Failed to send marketing confirmation email to ${normalizedEmail}:`, emailResult.error);
                    }
                } catch (emailError) {
                    console.error(`❌ [SUBSCRIBERS] Exception sending marketing confirmation email to ${normalizedEmail}:`, emailError);
                }
            }

        } else if (source === 'footer_drops') {
            // ============================================
            // FOOTER DROPS: Send confirmation email (NO DISCOUNT)
            // ============================================

            try {
                const emailResult = await emailService.sendDropsConfirmationEmail(
                    normalizedEmail,
                    subscriberName
                );

                if (emailResult.success) {
                    emailsSent.push('drops_confirmation');
                    console.log(`✅ [SUBSCRIBERS] Drops confirmation email sent to ${normalizedEmail}`);
                } else {
                    console.error(`❌ [SUBSCRIBERS] Failed to send drops confirmation email to ${normalizedEmail}:`, emailResult.error);
                }
            } catch (emailError) {
                console.error(`❌ [SUBSCRIBERS] Exception sending drops confirmation email to ${normalizedEmail}:`, emailError);
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
        console.error('❌ [SUBSCRIBERS] Subscription error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process subscription',
            details: error.message
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
        console.error('❌ [SUBSCRIBERS] Update preferences error:', error);
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
        console.error('❌ [SUBSCRIBERS] Unsubscribe error:', error);
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
 */
router.post('/validate-discount', async (req, res) => {
    try {
        const { discountCode } = req.body;

        if (!discountCode) {
            return res.status(400).json({
                success: false,
                error: 'Discount code is required'
            });
        }

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: { discountCode: discountCode }
        });

        if (!result.success || !result.data) {
            return res.json({
                success: true,
                valid: false,
                message: 'Invalid discount code'
            });
        }

        const subscriber = Array.isArray(result.data) ? result.data[0] : result.data;

        // Check if code is used
        if (subscriber.discountCodeUsed) {
            return res.json({
                success: true,
                valid: false,
                message: 'Discount code has already been used'
            });
        }

        // Check if code is expired
        if (subscriber.discountCodeExpiresAt) {
            const expiresAt = new Date(subscriber.discountCodeExpiresAt);
            if (expiresAt < new Date()) {
                return res.json({
                    success: true,
                    valid: false,
                    message: 'Discount code has expired'
                });
            }
        }

        res.json({
            success: true,
            valid: true,
            message: 'Discount code is valid'
        });

    } catch (error) {
        console.error('❌ [SUBSCRIBERS] Validate discount error:', error);
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

        if (!discountCode) {
            return res.status(400).json({
                success: false,
                error: 'Discount code is required'
            });
        }

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--update',
            data: {
                filter: { discountCode: discountCode },
                update: {
                    discountCodeUsed: true,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to mark discount code as used'
            });
        }

        res.json({
            success: true,
            message: 'Discount code marked as used'
        });

    } catch (error) {
        console.error('❌ [SUBSCRIBERS] Use discount error:', error);
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
        console.error('❌ [SUBSCRIBERS] Get subscriber error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get subscriber information',
            details: error.message
        });
    }
});

module.exports = router;
