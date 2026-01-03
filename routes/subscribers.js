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
        console.log('📥 [SUBSCRIBERS] Subscribe endpoint called');
        console.log('📥 [SUBSCRIBERS] Request body:', JSON.stringify(req.body, null, 2));
        
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
        console.log('🔍 [SUBSCRIBERS] Checking if subscriber exists:', normalizedEmail);
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
        
        console.log('🔍 [SUBSCRIBERS] Database query result:', { 
            success: existingResult.success, 
            hasData: !!existingResult.data,
            isArray: Array.isArray(existingResult.data),
            arrayLength: Array.isArray(existingResult.data) ? existingResult.data.length : 'N/A',
            hasActualData: hasActualData
        });

        let subscriber;
        let isNewSubscriber = false;

        if (hasActualData) {
            // EXISTING SUBSCRIBER - Update preferences
            const dataArray = Array.isArray(existingResult.data) ? existingResult.data : [existingResult.data];
            subscriber = dataArray.length > 0 ? dataArray[0] : null;
            
            if (!subscriber) {
                console.error('❌ [SUBSCRIBERS] Existing subscriber data is empty or invalid');
                console.error('❌ [SUBSCRIBERS] Data structure:', JSON.stringify(existingResult.data, null, 2));
                return res.status(500).json({
                    success: false,
                    error: 'Subscriber data is invalid'
                });
            }
            
            console.log(`✅ [SUBSCRIBERS] Updating existing subscriber: ${normalizedEmail} from source: ${source}`);
            console.log(`🔍 [SUBSCRIBERS] Subscriber data:`, { 
                email: subscriber.email, 
                wantsNewsletter: subscriber.wantsNewsletter,
                wantsMarketing: subscriber.wantsMarketing,
                wantsDrops: subscriber.wantsDrops 
            });

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
                            discountCodeExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
                            discountCodeUsed: false,
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
                        console.log(`✅ [SUBSCRIBERS] Welcome discount email sent to NEW subscriber ${normalizedEmail} with code: ${discountCode}`);
                    } else {
                        console.error(`❌ [SUBSCRIBERS] Failed to send welcome discount email to ${normalizedEmail}:`, emailResult.error);
                    }
                } catch (emailError) {
                    console.error(`❌ [SUBSCRIBERS] Exception sending welcome discount email to ${normalizedEmail}:`, emailError);
                }

                // Update subscriber object with new discount code
                subscriber.discountCode = discountCode;
                subscriber.discountCodeExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

            } else {
                // EXISTING SUBSCRIBER RESUBSCRIBING - ALWAYS resend welcome email with existing discount code
                if (subscriber.discountCode) {
                    try {
                        const emailResult = await emailService.sendNewsletterWelcomeEmail(
                            normalizedEmail,
                            subscriberName,
                            subscriber.discountCode
                        );

                        if (emailResult.success) {
                            emailsSent.push('welcome_discount_resent');
                            console.log(`✅ [SUBSCRIBERS] Welcome discount email resent to EXISTING subscriber ${normalizedEmail} with existing code: ${subscriber.discountCode}`);
                        } else {
                            console.error(`❌ [SUBSCRIBERS] Failed to resend welcome discount email to ${normalizedEmail}:`, emailResult.error);
                        }
                    } catch (emailError) {
                        console.error(`❌ [SUBSCRIBERS] Exception resending welcome discount email to ${normalizedEmail}:`, emailError);
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
                            console.log(`✅ [SUBSCRIBERS] Welcome discount email sent to ${normalizedEmail} with new code: ${discountCode}`);
                        } else {
                            console.error(`❌ [SUBSCRIBERS] Failed to send welcome discount email to ${normalizedEmail}:`, emailResult.error);
                        }
                    } catch (emailError) {
                        console.error(`❌ [SUBSCRIBERS] Exception sending welcome discount email to ${normalizedEmail}:`, emailError);
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
                            console.log(`✅ [SUBSCRIBERS] Newsletter confirmation email sent to ${normalizedEmail} (preference changed)`);
                        } else {
                            console.error(`❌ [SUBSCRIBERS] Failed to send newsletter confirmation email to ${normalizedEmail}:`, emailResult.error);
                        }
                    } catch (emailError) {
                        console.error(`❌ [SUBSCRIBERS] Exception sending newsletter confirmation email to ${normalizedEmail}:`, emailError);
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
                            console.log(`✅ [SUBSCRIBERS] Marketing confirmation email sent to ${normalizedEmail} (preference changed)`);
                        } else {
                            console.error(`❌ [SUBSCRIBERS] Failed to send marketing confirmation email to ${normalizedEmail}:`, emailResult.error);
                        }
                    } catch (emailError) {
                        console.error(`❌ [SUBSCRIBERS] Exception sending marketing confirmation email to ${normalizedEmail}:`, emailError);
                    }
                }
            } else {
                // No preferences changed - don't send any emails
                console.log(`ℹ️  [SUBSCRIBERS] No preferences changed for ${normalizedEmail} - skipping confirmation emails`);
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
                        console.log(`✅ [SUBSCRIBERS] Drops confirmation email sent to ${normalizedEmail} (preference changed or new subscriber)`);
                    } else {
                        console.error(`❌ [SUBSCRIBERS] Failed to send drops confirmation email to ${normalizedEmail}:`, emailResult.error);
                    }
                } catch (emailError) {
                    console.error(`❌ [SUBSCRIBERS] Exception sending drops confirmation email to ${normalizedEmail}:`, emailError);
                }
            } else {
                // Already subscribed to drops - don't send duplicate email
                console.log(`ℹ️  [SUBSCRIBERS] ${normalizedEmail} already subscribed to drops - skipping confirmation email`);
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
        console.error('❌ [SUBSCRIBERS] Error stack:', error.stack);
        console.error('❌ [SUBSCRIBERS] Request body:', JSON.stringify(req.body, null, 2));
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
