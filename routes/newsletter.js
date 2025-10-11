const express = require('express');
const { v4: uuidv4 } = require('uuid');
const emailService = require('../services/emailService');
const VortexDB = require('../vornifydb/vornifydb');

const router = express.Router();
const db = new VortexDB();

// Generate unique discount code
const generateDiscountCode = () => {
    const randomString = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `PEAK10-${randomString}`;
};

// Subscribe to newsletter
router.post('/subscribe', async (req, res) => {
    try {
        const { email, name } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email is required' 
            });
        }

        // Generate unique discount code
        const discountCode = generateDiscountCode();
        
        // Check if email already exists
        const existingSubscriber = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--read',
            data: { filter: { email: email } }
        });

        if (existingSubscriber.success && existingSubscriber.data) {
            return res.status(400).json({
                success: false,
                error: 'Email already subscribed'
            });
        }

        // Create subscriber record
        const subscriberData = {
            email: email,
            name: name || '',
            status: 'active',
            source: req.body.source || 'website',
            discountCode: discountCode,
            isUsed: false,
            subscribedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() // 14 days
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
        const emailResult = await emailService.sendNewsletterWelcomeEmail(
            subscriberData.email,
            subscriberData.name,
            subscriberData.discountCode
        );
        
        if (!emailResult.success) {
            console.error('Failed to send welcome email:', emailResult.error);
        }

        res.json({
            success: true,
            message: 'Successfully subscribed to newsletter',
            discountCode: discountCode,
            emailSent: emailResult.success
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
                error: 'Discount code is required' 
            });
        }

        // Find discount code
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--read',
            data: { filter: { discountCode: discountCode } }
        });

        if (!result.success || !result.data) {
            return res.status(404).json({
                success: false,
                error: 'Invalid discount code'
            });
        }

        const subscriber = result.data;

        // Check if code is used
        if (subscriber.isUsed) {
            return res.status(400).json({
                success: false,
                error: 'Discount code already used'
            });
        }

        // Check if code is expired
        if (new Date() > new Date(subscriber.expiresAt)) {
            return res.status(400).json({
                success: false,
                error: 'Discount code has expired'
            });
        }

        res.json({
            success: true,
            valid: true,
            discountValue: 10,
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

        // Find and update discount code
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--update',
            data: {
                filter: { discountCode: discountCode },
                update: { 
                    isUsed: true,
                    usedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            return res.status(404).json({
                success: false,
                error: 'Invalid discount code'
            });
        }

        res.json({
            success: true,
            message: 'Discount code used successfully'
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
