const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');

/**
 * POST /api/email/verify/test
 * Test email sending to a specific address
 * This endpoint allows testing email delivery with real email addresses
 */
router.post('/test', async (req, res) => {
    try {
        const { email, emailType = 'order-confirmation' } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email address is required for testing'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email address format'
            });
        }

        console.log(`🧪 Testing email delivery to ${email} (type: ${emailType})`);

        let result;
        const testData = {
            orderId: 'TEST-' + Date.now(),
            orderDate: new Date().toISOString(),
            items: [
                { name: 'Test Product', quantity: 1, price: 100 }
            ],
            totals: { total: 100 },
            shippingAddress: {
                street: 'Test Street 123',
                city: 'Stockholm',
                postalCode: '11363',
                country: 'SE'
            },
            customer: {
                name: 'Test Customer',
                email: email
            }
        };

        switch (emailType) {
            case 'order-confirmation':
                result = await emailService.sendOrderConfirmationEmail(
                    email,
                    'Test Customer',
                    testData,
                    'en'
                );
                break;

            case 'newsletter-welcome':
                result = await emailService.sendNewsletterWelcomeEmail(
                    email,
                    'Test Customer',
                    'TEST10-OFF'
                );
                break;

            case 'password-reset':
                result = await emailService.sendPasswordResetEmail(
                    email,
                    'https://peakmode.se/reset-password?token=test-token'
                );
                break;

            case 'shipping-notification':
                result = await emailService.sendShippingNotificationEmail(
                    email,
                    { ...testData, trackingNumber: 'TEST123', trackingUrl: 'https://tracking.test' }
                );
                break;

            case 'delivery-confirmation':
                result = await emailService.sendDeliveryConfirmationEmail(
                    email,
                    testData
                );
                break;

            default:
                return res.status(400).json({
                    success: false,
                    error: `Unknown email type: ${emailType}. Supported types: order-confirmation, newsletter-welcome, password-reset, shipping-notification, delivery-confirmation`
                });
        }

        if (result.success) {
            console.log(`✅ Test email sent successfully to ${email}`);
            return res.status(200).json({
                success: true,
                message: `Test ${emailType} email sent successfully to ${email}`,
                emailType: emailType,
                recipient: email,
                messageId: result.messageId,
                timestamp: result.timestamp
            });
        } else {
            console.error(`❌ Failed to send test email to ${email}:`, result.error);
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to send test email',
                details: result.details,
                emailType: emailType,
                recipient: email
            });
        }

    } catch (error) {
        console.error('Email test error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error during email test',
            details: error.message
        });
    }
});

/**
 * GET /api/email/verify/status
 * Get email service status and configuration
 */
router.get('/status', async (req, res) => {
    try {
        const apiKeyConfigured = !!process.env.SENDGRID_API_KEY;
        const fromEmail = process.env.EMAIL_FROM || 'support@peakmode.se';
        
        // Check all template IDs
        const templates = {
            orderConfirmation: {
                en: process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_EN || process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID,
                sv: process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_SV || process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID
            },
            newsletterWelcome: process.env.SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID,
            passwordReset: process.env.SENDGRID_PASSWORD_RESET_TEMPLATE_ID,
            orderProcessing: process.env.SENDGRID_ORDER_PROCESSING_TEMPLATE_ID,
            shippingNotification: process.env.SENDGRID_SHIPPING_NOTIFICATION_TEMPLATE_ID,
            deliveryConfirmation: process.env.SENDGRID_DELIVERY_CONFIRMATION_TEMPLATE_ID,
            reviewRequest: process.env.SENDGRID_REVIEW_REQUEST_TEMPLATE_ID,
            accountSetup: process.env.SENDGRID_ACCOUNT_SETUP_TEMPLATE_ID,
            emailVerification: process.env.SENDGRID_EMAIL_VERIFICATION_TEMPLATE_ID,
            passwordResetSuccess: process.env.SENDGRID_PASSWORD_RESET_SUCCESS_TEMPLATE_ID,
            supportConfirmation: process.env.SENDGRID_SUPPORT_CONFIRMATION_TEMPLATE_ID
        };

        const isConnected = await emailService.verifyConnection();

        const warnings = [];
        if (!apiKeyConfigured) warnings.push('SENDGRID_API_KEY is not set');
        if (!templates.orderConfirmation.en) warnings.push('Order confirmation template (EN) is not configured');
        if (!templates.newsletterWelcome) warnings.push('Newsletter welcome template is not configured');

        return res.status(200).json({
            success: isConnected && apiKeyConfigured,
            configured: {
                apiKey: apiKeyConfigured,
                fromEmail: fromEmail,
                supportInbox: process.env.SUPPORT_INBOX_EMAIL || 'support@peakmode.se',
                connection: isConnected
            },
            templates: Object.keys(templates).reduce((acc, key) => {
                const value = templates[key];
                if (typeof value === 'object') {
                    acc[key] = {
                        en: !!value.en,
                        sv: !!value.sv
                    };
                } else {
                    acc[key] = !!value;
                }
                return acc;
            }, {}),
            warnings: warnings,
            message: isConnected && apiKeyConfigured
                ? 'Email service is properly configured' 
                : 'Email service configuration issues detected'
        });

    } catch (error) {
        console.error('Email status check error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router;

