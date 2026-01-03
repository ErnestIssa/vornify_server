const express = require('express');
const emailService = require('../services/emailService');
const getDBInstance = require('../vornifydb/dbInstance');

const router = express.Router();
const db = getDBInstance();

/**
 * LEGACY ENDPOINT - Redirects to new unified subscriber system
 * This endpoint is kept for backward compatibility but redirects to /api/subscribers/subscribe
 * 
 * OLD STRUCTURE (newsletter_subscribers):
 * - status, source, isUsed, subscribedAt, expiresAt, isPrivate
 * 
 * NEW STRUCTURE (subscribers):
 * - wantsNewsletter, wantsMarketing, wantsDrops, welcomeDiscountSent, unsubscribed
 * - discountCode, discountCodeExpiresAt, discountCodeUsed
 * - createdAt, updatedAt
 */
router.post('/subscribe', async (req, res) => {
    try {
        const { email, name, source } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        // Map old source to new source
        let newSource = 'welcome_popup'; // Default to welcome_popup for legacy calls
        if (source === 'footer' || source === 'footer_drops') {
            newSource = 'footer_drops';
        } else if (source === 'checkout') {
            newSource = 'checkout';
        }

        // Use new unified subscriber system
        // This will create/update in 'subscribers' collection with new structure
        const normalizedEmail = email.trim().toLowerCase();
        const now = new Date().toISOString();

        // Check if subscriber exists in NEW collection
        const existingResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: { email: normalizedEmail }
        });

        let subscriber;
        let isNewSubscriber = false;

        if (existingResult.success && existingResult.data) {
            // EXISTING SUBSCRIBER - Update
            subscriber = Array.isArray(existingResult.data) ? existingResult.data[0] : existingResult.data;
            
            const updates = {
                updatedAt: now
            };

            if (name && name.trim()) {
                updates.name = name.trim();
            }

            if (newSource === 'welcome_popup') {
                updates.wantsMarketing = true;
            } else if (newSource === 'footer_drops') {
                updates.wantsDrops = true;
            }

            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--update',
                data: {
                    filter: { email: normalizedEmail },
                    update: updates
                }
            });

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
            // NEW SUBSCRIBER - Create with new structure
            isNewSubscriber = true;

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

            if (newSource === 'welcome_popup') {
                subscriber.wantsMarketing = true;
            } else if (newSource === 'footer_drops') {
                subscriber.wantsDrops = true;
            }

            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--create',
                data: subscriber
            });

            // Get created subscriber
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

        // Handle welcome popup discount email
        const subscriberName = subscriber.name || name || 'Peak Mode Member';
        let discountCode = subscriber.discountCode;
        let emailSent = false;

        if (newSource === 'welcome_popup') {
            if (!subscriber.welcomeDiscountSent) {
                // Generate discount code
                if (!discountCode) {
                    const randomString = Math.random().toString(36).substring(2, 8).toUpperCase();
                    discountCode = `PEAK10-${randomString}`;
                    
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'subscribers',
                        command: '--update',
                        data: {
                            filter: { email: normalizedEmail },
                            update: {
                                discountCode: discountCode,
                                discountCodeExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                                discountCodeUsed: false
                            }
                        }
                    });
                }

                // Send welcome email
                try {
                    const emailResult = await emailService.sendNewsletterWelcomeEmail(
                        normalizedEmail,
                        subscriberName,
                        discountCode
                    );

                    if (emailResult.success) {
                        emailSent = true;
                        await db.executeOperation({
                            database_name: 'peakmode',
                            collection_name: 'subscribers',
                            command: '--update',
                            data: {
                                filter: { email: normalizedEmail },
                                update: { welcomeDiscountSent: true }
                            }
                        });
                    }
                } catch (emailError) {
                    console.error('Email error:', emailError);
                }
            } else if (discountCode) {
                // Resend with existing code
                try {
                    const emailResult = await emailService.sendNewsletterWelcomeEmail(
                        normalizedEmail,
                        subscriberName,
                        discountCode
                    );
                    if (emailResult.success) emailSent = true;
                } catch (emailError) {
                    console.error('Email error:', emailError);
                }
            }
        }

        // Return response in legacy format for backward compatibility
        return res.json({
            success: true,
            message: emailSent ? 'Welcome email sent!' : 'Subscription successful',
            discountCode: discountCode || null,
            emailSent: emailSent,
            data: {
                email: normalizedEmail,
                name: subscriber.name || '',
                wantsNewsletter: subscriber.wantsNewsletter || false,
                wantsMarketing: subscriber.wantsMarketing || false,
                wantsDrops: subscriber.wantsDrops || false,
                discountCode: discountCode,
                discountCodeExpiresAt: subscriber.discountCodeExpiresAt || null
            }
        });

    } catch (error) {
        console.error('❌ [NEWSLETTER] Subscription error:', error);
        console.error('❌ [NEWSLETTER] Error stack:', error.stack);
        console.error('❌ [NEWSLETTER] Request body:', req.body);
        res.status(500).json({
            success: false,
            error: 'Failed to process subscription',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// All other legacy endpoints redirect to new system or return deprecation notice
router.get('/subscribers', async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'This endpoint is deprecated. Use /api/subscribers/:email instead.',
        message: 'Please update your frontend to use the new unified subscriber system at /api/subscribers'
    });
});

router.post('/validate-discount', async (req, res) => {
    // Redirect to new endpoint
    res.status(410).json({
        success: false,
        error: 'This endpoint is deprecated. Use /api/subscribers/validate-discount instead.',
        message: 'Please update your frontend to use the new unified subscriber system at /api/subscribers'
    });
});

router.post('/use-discount', async (req, res) => {
    // Redirect to new endpoint
    res.status(410).json({
        success: false,
        error: 'This endpoint is deprecated. Use /api/subscribers/use-discount instead.',
        message: 'Please update your frontend to use the new unified subscriber system at /api/subscribers'
    });
});

router.get('/analytics', async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'This endpoint is deprecated.',
        message: 'Please update your frontend to use the new unified subscriber system at /api/subscribers'
    });
});

module.exports = router;
