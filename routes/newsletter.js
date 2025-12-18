const express = require('express');
const { v4: uuidv4 } = require('uuid');
const emailService = require('../services/emailService');
const getDBInstance = require('../vornifydb/dbInstance');

const router = express.Router();
const db = getDBInstance();

// Generate unique discount code
const generateDiscountCode = () => {
    const randomString = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `PEAK10-${randomString}`;
};

// Subscribe to newsletter
router.post('/subscribe', async (req, res) => {
    try {
        const { email, name, source } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email is required' 
            });
        }

        // 1. NORMALIZE EMAIL (trim + lowercase)
        const normalizedEmail = email.trim().toLowerCase();
        
        // 2. Check if email already exists (with normalized email)
        const existingSubscriber = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--read',
            data: { filter: { email: normalizedEmail } }
        });

        if (existingSubscriber.success && existingSubscriber.data) {
            // User already subscribed - return their existing discount code
            const subscriber = existingSubscriber.data;
            
            // Check if code expired (14 days from subscribedAt)
            const subscribedDate = new Date(subscriber.subscribedAt);
            const daysSince = (Date.now() - subscribedDate.getTime()) / (1000 * 60 * 60 * 24);
            const codeExpired = daysSince > 14;
            const daysRemaining = codeExpired ? 0 : Math.ceil(14 - daysSince);
            
            console.log(`✅ [NEWSLETTER] Email already subscribed: ${normalizedEmail}, returning existing code: ${subscriber.discountCode}`);
            
            // Return consistent structure with all fields
            return res.json({
                success: true,
                message: "You're already a Peak Mode member! Here's your discount code.",
                data: {
                    email: subscriber.email,
                    name: subscriber.name || name || '',
                    discountCode: subscriber.discountCode,
                    isNewSubscriber: false,
                    alreadySubscribed: true,
                    isUsed: subscriber.isUsed || false,
                    expired: codeExpired,
                    daysRemaining: daysRemaining,
                    expiresAt: subscriber.expiresAt,
                    subscribedAt: subscriber.subscribedAt,
                    status: subscriber.status || 'active',
                    // Additional info for frontend
                    subscriptionStatus: 'existing',
                    codeStatus: codeExpired ? 'expired' : (subscriber.isUsed ? 'used' : 'active'),
                    messageType: 'already_subscribed' // For frontend to show different UI
                }
            });
        }

        // 3. Create NEW subscriber (email doesn't exist)
        const discountCode = generateDiscountCode();

        // Create subscriber record with NORMALIZED email
        const subscriberData = {
            email: normalizedEmail,  // Use normalized email
            name: name || '',
            status: 'active',
            source: source || 'website',
            discountCode: discountCode,
            isUsed: false,
            expired: false,
            subscribedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
            usedAt: null,
            expiredAt: null
        };

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--create',
            data: subscriberData
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to create subscriber record'
            });
        }

        // Send welcome email with discount code
        let emailResult = { success: false, error: 'Email not sent' };
        let emailSent = false;
        
        try {
            console.log('📧 [NEWSLETTER] Attempting to send welcome email to:', subscriberData.email);
            
            // Verify SendGrid is configured
            const isConfigured = await emailService.verifyConnection();
            if (!isConfigured) {
                console.error('❌ [NEWSLETTER] SendGrid is not properly configured');
                emailResult = {
                    success: false,
                    error: 'Email service not configured',
                    details: 'SENDGRID_API_KEY is missing or invalid'
                };
            } else {
                emailResult = await emailService.sendNewsletterWelcomeEmail(
                    subscriberData.email,
                    subscriberData.name || 'Peak Mode Member',
                    subscriberData.discountCode
                );
                
                emailSent = emailResult.success;
                
                if (!emailResult.success) {
                    console.error('❌ [NEWSLETTER] Failed to send welcome email:', {
                        email: subscriberData.email,
                        error: emailResult.error,
                        details: emailResult.details,
                        messageId: emailResult.messageId
                    });
                } else {
                    console.log(`✅ [NEWSLETTER] Welcome email sent successfully to ${subscriberData.email}`, {
                        messageId: emailResult.messageId,
                        timestamp: emailResult.timestamp
                    });
                }
            }
        } catch (emailError) {
            console.error('❌ [NEWSLETTER] Exception sending welcome email:', {
                email: subscriberData.email,
                error: emailError.message,
                stack: emailError.stack,
                details: emailError
            });
            emailResult = {
                success: false,
                error: emailError.message || 'Failed to send email',
                details: emailError.toString()
            };
        }

        // Calculate days remaining for new subscriber
        const daysRemaining = 14; // New codes are valid for 14 days
        
        res.json({
            success: true,
            message: 'Welcome to Peak Mode! Here\'s your 10% discount code.',
            data: {
                email: subscriberData.email,
                name: subscriberData.name,
                discountCode: subscriberData.discountCode,
                isNewSubscriber: true,
                alreadySubscribed: false,
                isUsed: subscriberData.isUsed || false,
                expired: false,
                daysRemaining: daysRemaining,
                expiresAt: subscriberData.expiresAt,
                subscribedAt: subscriberData.subscribedAt,
                status: subscriberData.status || 'active',
                emailSent: emailSent, // Include email sending status
                emailError: emailSent ? null : emailResult.error, // Include error if email failed
                // Additional info for frontend
                subscriptionStatus: 'new',
                codeStatus: 'active',
                messageType: 'new_subscription' // For frontend to show different UI
            }
        });

    } catch (error) {
        console.error('Newsletter subscription error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Send discount reminder (for admin use)
router.post('/send-reminder', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email is required' 
            });
        }

        // Get subscriber data
        const subscriberResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--read',
            data: { filter: { email: email } }
        });

        if (!subscriberResult.success || !subscriberResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Subscriber not found'
            });
        }

        const subscriberData = subscriberResult.data;

        // Check if discount code is still valid
        if (subscriberData.isUsed) {
            return res.status(400).json({
                success: false,
                error: 'Discount code already used'
            });
        }

        if (new Date() > new Date(subscriberData.expiresAt)) {
            return res.status(400).json({
                success: false,
                error: 'Discount code has expired'
            });
        }

        // Send reminder email
        const emailResult = await emailService.sendDiscountReminderEmail(
            subscriberData.email,
            subscriberData.name,
            subscriberData.discountCode
        );
        
        if (!emailResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to send reminder email'
            });
        }

        res.json({
            success: true,
            message: 'Discount reminder sent successfully'
        });

    } catch (error) {
        console.error('Discount reminder error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Validate discount code
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

        // Normalize discount code
        const normalizedCode = discountCode.trim().toUpperCase();

        // Find discount code
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--read',
            data: { filter: { discountCode: normalizedCode } }
        });

        if (!result.success || !result.data) {
            return res.json({
                success: false,
                valid: false,
                error: 'Discount code not found'
            });
        }

        const subscriber = result.data;

        // Check if code is used
        if (subscriber.isUsed) {
            return res.json({
                success: false,
                valid: false,
                error: 'This discount code has already been used',
                usedAt: subscriber.usedAt
            });
        }

        // Check if code is expired (14 days from subscribedAt)
        const subscribedDate = new Date(subscriber.subscribedAt);
        const daysSince = (Date.now() - subscribedDate.getTime()) / (1000 * 60 * 60 * 24);
        const expired = daysSince > 14;

        if (expired) {
            // Mark as expired in database
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'newsletter_subscribers',
                command: '--update',
                data: {
                    filter: { discountCode: normalizedCode },
                    update: {
                        expired: true,
                        expiredAt: new Date().toISOString()
                    }
                }
            });

            const expiryDate = new Date(subscribedDate.getTime() + (14 * 24 * 60 * 60 * 1000));
            
            return res.json({
                success: false,
                valid: false,
                error: 'This discount code has expired (14 day limit)',
                expiredAt: expiryDate.toISOString()
            });
        }

        // Code is valid!
        const expiresAt = new Date(subscribedDate.getTime() + (14 * 24 * 60 * 60 * 1000));
        const daysRemaining = Math.ceil(14 - daysSince);

        res.json({
            success: true,
            valid: true,
            discountValue: 10,
            discountCode: normalizedCode,
            email: subscriber.email,
            expiresAt: expiresAt.toISOString(),
            daysRemaining: daysRemaining,
            message: 'Discount code is valid'
        });

    } catch (error) {
        console.error('Discount validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Use discount code
router.post('/use-discount', async (req, res) => {
    try {
        const { discountCode } = req.body;

        if (!discountCode) {
            return res.status(400).json({ 
                success: false, 
                error: 'Discount code is required' 
            });
        }

        // Normalize discount code
        const normalizedCode = discountCode.trim().toUpperCase();

        // Find and update discount code
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--update',
            data: {
                filter: { discountCode: normalizedCode },
                update: { 
                    isUsed: true,
                    usedAt: new Date().toISOString(),
                    expired: false  // Once used, expiration doesn't matter
                }
            }
        });

        if (!updateResult.success) {
            return res.json({
                success: false,
                error: 'Discount code not found'
            });
        }

        console.log(`✅ Discount code marked as used: ${normalizedCode}`);

        res.json({
            success: true,
            message: 'Discount code marked as used',
            discountCode: normalizedCode
        });

    } catch (error) {
        console.error('Discount usage error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Get all subscribers (admin)
router.get('/subscribers', async (req, res) => {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--read',
            data: {}
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch subscribers'
            });
        }

        res.json({
            success: true,
            data: result.data
        });

    } catch (error) {
        console.error('Get subscribers error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Send bulk discount reminders
router.post('/send-bulk-reminders', async (req, res) => {
    try {
        const { emails } = req.body;

        if (!emails || !Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Emails array is required' 
            });
        }

        const results = [];
        let sent = 0;
        let failed = 0;

        for (const email of emails) {
            try {
                // Get subscriber data
                const subscriberResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'newsletter_subscribers',
                    command: '--read',
                    data: { filter: { email: email } }
                });

                if (!subscriberResult.success || !subscriberResult.data) {
                    results.push({ 
                        email, 
                        success: false, 
                        error: 'Subscriber not found' 
                    });
                    failed++;
                    continue;
                }

                const subscriberData = subscriberResult.data;

                // Check if discount code is still valid
                if (subscriberData.isUsed) {
                    results.push({ 
                        email, 
                        success: false, 
                        error: 'Discount code already used' 
                    });
                    failed++;
                    continue;
                }

                if (new Date() > new Date(subscriberData.expiresAt)) {
                    results.push({ 
                        email, 
                        success: false, 
                        error: 'Discount code expired' 
                    });
                    failed++;
                    continue;
                }

                // Send reminder email
                const emailResult = await emailService.sendDiscountReminderEmail(
                    subscriberData.email,
                    subscriberData.name,
                    subscriberData.discountCode
                );
                
                if (emailResult.success) {
                    results.push({ 
                        email, 
                        success: true 
                    });
                    sent++;
                } else {
                    results.push({ 
                        email, 
                        success: false, 
                        error: emailResult.error || 'Failed to send email' 
                    });
                    failed++;
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`Error sending reminder to ${email}:`, error);
                results.push({ 
                    email, 
                    success: false, 
                    error: error.message 
                });
                failed++;
            }
        }

        res.json({
            success: true,
            sent,
            failed,
            total: emails.length,
            results
        });

    } catch (error) {
        console.error('Bulk reminder error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Unsubscribe from newsletter
router.post('/unsubscribe', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email is required' 
            });
        }

        // Find and update subscriber status
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--update',
            data: {
                filter: { email: email },
                update: { 
                    status: 'unsubscribed',
                    unsubscribedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            return res.status(404).json({
                success: false,
                error: 'Subscriber not found'
            });
        }

        res.json({
            success: true,
            message: 'Successfully unsubscribed from newsletter'
        });

    } catch (error) {
        console.error('Unsubscribe error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Get newsletter analytics
router.get('/analytics', async (req, res) => {
    try {
        // Get all subscribers
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--read',
            data: {}
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch subscribers'
            });
        }

        const subscribers = Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);
        const now = new Date();

        // Calculate analytics
        const totalSubscribers = subscribers.length;
        const activeSubscribers = subscribers.filter(s => s.status !== 'unsubscribed').length;
        const unsubscribed = subscribers.filter(s => s.status === 'unsubscribed').length;
        const totalCodes = subscribers.filter(s => s.discountCode).length;
        const usedCodes = subscribers.filter(s => s.isUsed).length;
        const expiredCodes = subscribers.filter(s => 
            s.expiresAt && new Date(s.expiresAt) < now && !s.isUsed
        ).length;
        const activeCodes = totalCodes - usedCodes - expiredCodes;
        const conversionRate = totalCodes > 0 ? ((usedCodes / totalCodes) * 100).toFixed(2) : 0;

        // Get recent activity (last 30 days)
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const recentSubscribers = subscribers.filter(s => 
            s.subscribedAt && new Date(s.subscribedAt) > thirtyDaysAgo
        ).length;

        res.json({
            success: true,
            data: {
                totalSubscribers,
                activeSubscribers,
                unsubscribed,
                totalCodes,
                usedCodes,
                expiredCodes,
                activeCodes,
                conversionRate: parseFloat(conversionRate),
                recentSubscribers,
                last30Days: recentSubscribers
            }
        });

    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

module.exports = router;
