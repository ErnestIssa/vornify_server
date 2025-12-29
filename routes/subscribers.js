const express = require('express');
const emailService = require('../services/emailService');
const getDBInstance = require('../vornifydb/dbInstance');
const crypto = require('crypto');

const router = express.Router();
const db = getDBInstance();

/**
 * Generate unique discount code for popup subscribers
 * Format: PEAK10-XXXXXX
 */
function generateDiscountCode() {
    const randomString = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `PEAK10-${randomString}`;
}

/**
 * Get default preferences based on subscription source
 */
function getDefaultsForSource(source) {
    switch (source) {
        case 'popup':
            return {
                wantsMarketing: true,  // Popup = marketing opt-in
                wantsNewsletter: false,
                wantsDrops: false
            };
        case 'footer':
            return {
                wantsMarketing: false,
                wantsNewsletter: false,
                wantsDrops: true  // Footer = drops notifications
            };
        case 'checkout':
            return {
                wantsMarketing: false,  // User explicitly checks boxes
                wantsNewsletter: false,
                wantsDrops: false
            };
        case 'hub':
            return {
                wantsMarketing: false,
                wantsNewsletter: true,  // Hub = newsletter content
                wantsDrops: false
            };
        case 'newsletter':
            return {
                wantsMarketing: false,
                wantsNewsletter: true,
                wantsDrops: false
            };
        default:
            return {
                wantsMarketing: false,
                wantsNewsletter: true,
                wantsDrops: false
            };
    }
}

/**
 * POST /api/subscribers/subscribe
 * Unified subscription endpoint - handles all subscription sources
 * 
 * Body:
 * {
 *   "email": "user@example.com",
 *   "name": "John Doe", // Optional
 *   "source": "popup" | "footer" | "checkout" | "hub" | "newsletter",
 *   "wantsMarketing": boolean, // Optional, defaults based on source
 *   "wantsNewsletter": boolean, // Optional, defaults based on source
 *   "wantsDrops": boolean // Optional, defaults based on source
 * }
 */
router.post('/subscribe', async (req, res) => {
    try {
        const { email, name, source, wantsMarketing, wantsNewsletter, wantsDrops } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        if (!source || !['popup', 'footer', 'checkout', 'hub', 'newsletter'].includes(source)) {
            return res.status(400).json({
                success: false,
                error: 'Valid source is required (popup, footer, checkout, hub, or newsletter)'
            });
        }

        // Normalize email
        const normalizedEmail = email.trim().toLowerCase();

        // Get defaults for source
        const defaults = getDefaultsForSource(source);

        // Check if subscriber already exists
        const existingResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: { email: normalizedEmail }
        });

        const now = new Date().toISOString();

        if (existingResult.success && existingResult.data) {
            // EXISTING SUBSCRIBER - Update preferences and resend welcome email if they have a discount code
            const existing = Array.isArray(existingResult.data) ? existingResult.data[0] : existingResult.data;
            
            console.log(`✅ [SUBSCRIBERS] Updating existing subscriber: ${normalizedEmail} from source: ${source}`);

            const updates = {
                updatedAt: now
            };

            // Update preferences based on source and provided values
            if (source === 'popup') {
                // Popup = wants marketing (for welcome offer)
                updates.wantsMarketing = true;
            } else if (source === 'footer') {
                // Footer = wants drops notifications
                updates.wantsDrops = true;
            } else if (source === 'checkout') {
                // Checkout = use provided preferences (or defaults)
                updates.wantsMarketing = wantsMarketing !== undefined ? wantsMarketing : defaults.wantsMarketing;
                updates.wantsNewsletter = wantsNewsletter !== undefined ? wantsNewsletter : defaults.wantsNewsletter;
                updates.wantsDrops = wantsDrops !== undefined ? wantsDrops : defaults.wantsDrops;
            } else if (source === 'hub') {
                // Hub = wants newsletter content
                updates.wantsNewsletter = true;
            } else if (source === 'newsletter') {
                // Newsletter = wants newsletter content
                updates.wantsNewsletter = true;
            }

            // Update name if provided
            if (name && name.trim()) {
                updates.name = name.trim();
            }

            // Update source (keep latest source, or could be array in future)
            updates.source = source;

            // Send welcome email again if subscriber has a discount code (same code they received initially)
            let emailSent = false;
            const existingDiscountCode = existing.discountCode || null;
            
            if (existingDiscountCode) {
                // Resend welcome email with existing discount code (same code they had initially)
                try {
                    const emailResult = await emailService.sendNewsletterWelcomeEmail(
                        normalizedEmail,
                        name || existing.name || 'Peak Mode Member',
                        existingDiscountCode
                    );

                    if (emailResult.success) {
                        emailSent = true;
                        console.log(`✅ [SUBSCRIBERS] Welcome email resent to existing subscriber: ${normalizedEmail} with existing code: ${existingDiscountCode}`);
                    } else {
                        console.error(`❌ [SUBSCRIBERS] Failed to resend welcome email to ${normalizedEmail}:`, emailResult.error);
                    }
                } catch (emailError) {
                    console.error(`❌ [SUBSCRIBERS] Exception resending welcome email to ${normalizedEmail}:`, emailError);
                }
            }

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

            // Get updated subscriber to return discount code if exists
            const updatedResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--read',
                data: { email: normalizedEmail }
            });

            const updatedSubscriber = updatedResult.success && updatedResult.data
                ? (Array.isArray(updatedResult.data) ? updatedResult.data[0] : updatedResult.data)
                : existing;

            return res.json({
                success: true,
                isNewSubscriber: false,
                alreadySubscribed: true,
                discountCode: existingDiscountCode,
                welcomeSent: emailSent, // Indicates if email was resent
                message: existingDiscountCode 
                    ? 'Welcome back! Here\'s your discount code again.' 
                    : 'Preferences updated successfully',
                data: {
                    email: normalizedEmail,
                    wantsMarketing: updates.wantsMarketing !== undefined ? updates.wantsMarketing : existing.wantsMarketing,
                    wantsNewsletter: updates.wantsNewsletter !== undefined ? updates.wantsNewsletter : existing.wantsNewsletter,
                    wantsDrops: updates.wantsDrops !== undefined ? updates.wantsDrops : existing.wantsDrops,
                    source: source,
                    discountCode: existingDiscountCode,
                    discountCodeExpiresAt: existing.discountCodeExpiresAt || null
                }
            });

        } else {
            // NEW SUBSCRIBER
            console.log(`✅ [SUBSCRIBERS] Creating new subscriber: ${normalizedEmail} from source: ${source}`);

            const newSubscriber = {
                email: normalizedEmail,
                name: name ? name.trim() : '',
                source: source,
                wantsMarketing: wantsMarketing !== undefined ? wantsMarketing : defaults.wantsMarketing,
                wantsNewsletter: wantsNewsletter !== undefined ? wantsNewsletter : defaults.wantsNewsletter,
                wantsDrops: wantsDrops !== undefined ? wantsDrops : defaults.wantsDrops,
                welcomeSent: false,
                unsubscribed: false,
                createdAt: now,
                updatedAt: now
            };

            let discountCode = null;
            let emailSent = false;

            // Only send welcome email for popup source
            if (source === 'popup') {
                discountCode = generateDiscountCode();
                newSubscriber.discountCode = discountCode;
                newSubscriber.discountCodeExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days
                newSubscriber.discountCodeUsed = false;

                // Send welcome email with discount code
                try {
                    const emailResult = await emailService.sendNewsletterWelcomeEmail(
                        normalizedEmail,
                        name || 'Peak Mode Member',
                        discountCode
                    );

                    if (emailResult.success) {
                        newSubscriber.welcomeSent = true;
                        emailSent = true;
                        console.log(`✅ [SUBSCRIBERS] Welcome email sent to ${normalizedEmail}`);
                    } else {
                        console.error(`❌ [SUBSCRIBERS] Failed to send welcome email to ${normalizedEmail}:`, emailResult.error);
                    }
                } catch (emailError) {
                    console.error(`❌ [SUBSCRIBERS] Exception sending welcome email to ${normalizedEmail}:`, emailError);
                }
            }

            // Create subscriber record
            const createResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--create',
                data: newSubscriber
            });

            if (!createResult.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create subscriber record'
                });
            }

            return res.json({
                success: true,
                isNewSubscriber: true,
                alreadySubscribed: false,
                discountCode: discountCode,
                welcomeSent: emailSent,
                message: source === 'popup' 
                    ? 'Welcome to Peak Mode! Here\'s your 10% discount code.'
                    : 'Subscription successful',
                data: {
                    email: normalizedEmail,
                    name: newSubscriber.name,
                    source: source,
                    wantsMarketing: newSubscriber.wantsMarketing,
                    wantsNewsletter: newSubscriber.wantsNewsletter,
                    wantsDrops: newSubscriber.wantsDrops,
                    discountCode: discountCode,
                    discountCodeExpiresAt: newSubscriber.discountCodeExpiresAt || null
                }
            });
        }

    } catch (error) {
        console.error('❌ [SUBSCRIBERS] Subscription error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/subscribers/update-preferences
 * Update subscriber preferences (used by checkout)
 * 
 * Body:
 * {
 *   "email": "user@example.com",
 *   "wantsMarketing": boolean,
 *   "wantsNewsletter": boolean,
 *   "wantsDrops": boolean // Optional
 * }
 */
router.post('/update-preferences', async (req, res) => {
    try {
        const { email, wantsMarketing, wantsNewsletter, wantsDrops } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Check if subscriber exists
        const existingResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: { email: normalizedEmail }
        });

        if (!existingResult.success || !existingResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Subscriber not found. Please subscribe first.'
            });
        }

        const updates = {
            updatedAt: new Date().toISOString()
        };

        // Update only provided preferences
        if (wantsMarketing !== undefined) {
            updates.wantsMarketing = wantsMarketing;
        }
        if (wantsNewsletter !== undefined) {
            updates.wantsNewsletter = wantsNewsletter;
        }
        if (wantsDrops !== undefined) {
            updates.wantsDrops = wantsDrops;
        }

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
            message: 'Preferences updated successfully',
            data: {
                email: normalizedEmail,
                ...updates
            }
        });

    } catch (error) {
        console.error('❌ [SUBSCRIBERS] Update preferences error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/subscribers/unsubscribe
 * Unsubscribe from all emails (global unsubscribe)
 * 
 * Body:
 * {
 *   "email": "user@example.com"
 * }
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

        // Check if subscriber exists
        const existingResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: { email: normalizedEmail }
        });

        if (!existingResult.success || !existingResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Subscriber not found'
            });
        }

        // Update unsubscribe flag
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
            message: 'Successfully unsubscribed from all emails'
        });

    } catch (error) {
        console.error('❌ [SUBSCRIBERS] Unsubscribe error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/subscribers/validate-discount
 * Validate discount code (for checkout)
 * 
 * Body:
 * {
 *   "discountCode": "PEAK10-XXXXXX"
 * }
 */
router.post('/validate-discount', async (req, res) => {
    try {
        const { discountCode } = req.body;

        if (!discountCode) {
            return res.status(400).json({
                success: false,
                valid: false,
                error: 'Discount code is required'
            });
        }

        const normalizedCode = discountCode.trim().toUpperCase();

        // Find subscriber by discount code
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--read',
            data: { discountCode: normalizedCode }
        });

        if (!result.success || !result.data) {
            return res.json({
                success: false,
                valid: false,
                error: 'Discount code not found'
            });
        }

        const subscriber = Array.isArray(result.data) ? result.data[0] : result.data;

        // Check if code is used
        if (subscriber.discountCodeUsed) {
            return res.json({
                success: false,
                valid: false,
                error: 'This discount code has already been used',
                usedAt: subscriber.usedAt || null
            });
        }

        // Check if code is expired (14 days from createdAt or discountCodeExpiresAt)
        const expiresAt = subscriber.discountCodeExpiresAt 
            ? new Date(subscriber.discountCodeExpiresAt)
            : new Date(new Date(subscriber.createdAt).getTime() + (14 * 24 * 60 * 60 * 1000));
        
        const now = new Date();
        if (now > expiresAt) {
            // Mark as expired
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--update',
                data: {
                    filter: { discountCode: normalizedCode },
                    update: {
                        discountCodeUsed: true,
                        updatedAt: new Date().toISOString()
                    }
                }
            });

            return res.json({
                success: false,
                valid: false,
                error: 'This discount code has expired (14 day limit)',
                expiredAt: expiresAt.toISOString()
            });
        }

        // Code is valid!
        const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        res.json({
            success: true,
            valid: true,
            discountValue: 10, // 10% discount
            discountCode: normalizedCode,
            email: subscriber.email,
            expiresAt: expiresAt.toISOString(),
            daysRemaining: daysRemaining,
            message: 'Discount code is valid'
        });

    } catch (error) {
        console.error('❌ [SUBSCRIBERS] Validate discount error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/subscribers/use-discount
 * Mark discount code as used (called after successful order with discount)
 * 
 * Body:
 * {
 *   "discountCode": "PEAK10-XXXXXX"
 * }
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

        const normalizedCode = discountCode.trim().toUpperCase();

        // Update discount code as used
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'subscribers',
            command: '--update',
            data: {
                filter: { discountCode: normalizedCode },
                update: {
                    discountCodeUsed: true,
                    usedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            return res.json({
                success: false,
                error: 'Discount code not found or already used'
            });
        }

        console.log(`✅ [SUBSCRIBERS] Discount code marked as used: ${normalizedCode}`);

        res.json({
            success: true,
            message: 'Discount code marked as used',
            discountCode: normalizedCode
        });

    } catch (error) {
        console.error('❌ [SUBSCRIBERS] Use discount error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * GET /api/subscribers/:email
 * Get subscriber information and preferences
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
            subscriber: {
                email: subscriber.email,
                name: subscriber.name || '',
                source: subscriber.source || 'website',
                wantsMarketing: subscriber.wantsMarketing || false,
                wantsNewsletter: subscriber.wantsNewsletter || false,
                wantsDrops: subscriber.wantsDrops || false,
                welcomeSent: subscriber.welcomeSent || false,
                unsubscribed: subscriber.unsubscribed || false,
                discountCode: subscriber.discountCode || null,
                discountCodeUsed: subscriber.discountCodeUsed || false,
                discountCodeExpiresAt: subscriber.discountCodeExpiresAt || null,
                createdAt: subscriber.createdAt,
                updatedAt: subscriber.updatedAt
            }
        });

    } catch (error) {
        console.error('❌ [SUBSCRIBERS] Get subscriber error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router;

