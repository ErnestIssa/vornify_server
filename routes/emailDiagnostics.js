const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');

/**
 * GET /api/email/diagnostics
 * Comprehensive email service diagnostics endpoint
 */
router.get('/diagnostics', async (req, res) => {
    try {
        const diagnostics = {
            timestamp: new Date().toISOString(),
            sendGrid: {
                apiKeyConfigured: !!process.env.SENDGRID_API_KEY,
                apiKeyLength: process.env.SENDGRID_API_KEY ? process.env.SENDGRID_API_KEY.length : 0,
                apiKeyFormat: process.env.SENDGRID_API_KEY ? (process.env.SENDGRID_API_KEY.startsWith('SG.') ? 'valid' : 'invalid') : 'missing',
                fromEmail: process.env.EMAIL_FROM || 'support@peakmode.se',
                supportInbox: process.env.SUPPORT_INBOX_EMAIL || 'support@peakmode.se',
                connectionStatus: await emailService.verifyConnection()
            },
            templates: {
                orderConfirmation: {
                    en: !!process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_EN || !!process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID,
                    sv: !!process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_SV || !!process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID,
                    enId: process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_EN || process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID || 'not configured',
                    svId: process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_SV || process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID || 'not configured'
                },
                newsletterWelcome: {
                    configured: !!process.env.SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID,
                    templateId: process.env.SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID || 'not configured'
                },
                passwordReset: {
                    configured: !!process.env.SENDGRID_PASSWORD_RESET_TEMPLATE_ID,
                    templateId: process.env.SENDGRID_PASSWORD_RESET_TEMPLATE_ID || 'not configured'
                },
                orderProcessing: {
                    configured: !!process.env.SENDGRID_ORDER_PROCESSING_TEMPLATE_ID,
                    templateId: process.env.SENDGRID_ORDER_PROCESSING_TEMPLATE_ID || 'not configured'
                },
                shippingNotification: {
                    configured: !!process.env.SENDGRID_SHIPPING_NOTIFICATION_TEMPLATE_ID,
                    templateId: process.env.SENDGRID_SHIPPING_NOTIFICATION_TEMPLATE_ID || 'not configured'
                },
                deliveryConfirmation: {
                    configured: !!process.env.SENDGRID_DELIVERY_CONFIRMATION_TEMPLATE_ID,
                    templateId: process.env.SENDGRID_DELIVERY_CONFIRMATION_TEMPLATE_ID || 'not configured'
                },
                reviewRequest: {
                    configured: !!process.env.SENDGRID_REVIEW_REQUEST_TEMPLATE_ID,
                    templateId: process.env.SENDGRID_REVIEW_REQUEST_TEMPLATE_ID || 'not configured'
                }
            },
            issues: [],
            recommendations: []
        };

        // Check for issues
        if (!diagnostics.sendGrid.apiKeyConfigured) {
            diagnostics.issues.push('SENDGRID_API_KEY is not configured');
            diagnostics.recommendations.push('Set SENDGRID_API_KEY environment variable in Render dashboard');
        }

        if (!diagnostics.sendGrid.apiKeyFormat === 'invalid') {
            diagnostics.issues.push('SENDGRID_API_KEY format appears invalid (should start with "SG.")');
            diagnostics.recommendations.push('Verify SENDGRID_API_KEY is correct in Render dashboard');
        }

        if (!diagnostics.sendGrid.connectionStatus) {
            diagnostics.issues.push('SendGrid connection verification failed');
            diagnostics.recommendations.push('Check SENDGRID_API_KEY is valid and account is active');
        }

        if (!diagnostics.templates.orderConfirmation.en && !diagnostics.templates.orderConfirmation.sv) {
            diagnostics.issues.push('Order confirmation template is not configured');
            diagnostics.recommendations.push('Set SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_EN or SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID in environment variables');
        }

        if (!diagnostics.templates.newsletterWelcome.configured) {
            diagnostics.issues.push('Newsletter welcome template is not configured');
            diagnostics.recommendations.push('Set SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID in environment variables');
        }

        // Overall status
        diagnostics.status = diagnostics.issues.length === 0 ? 'healthy' : 'issues_detected';
        diagnostics.summary = diagnostics.issues.length === 0 
            ? 'Email service is properly configured' 
            : `${diagnostics.issues.length} issue(s) detected`;

        return res.status(200).json({
            success: true,
            diagnostics: diagnostics
        });

    } catch (error) {
        console.error('Email diagnostics error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to generate diagnostics',
            details: error.message
        });
    }
});

/**
 * POST /api/email/diagnostics/test
 * Test email sending with detailed logging
 */
router.post('/diagnostics/test', async (req, res) => {
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

        console.log(`🧪 [EMAIL DIAGNOSTICS] Testing email delivery to ${email} (type: ${emailType})`);

        // Check SendGrid configuration first
        const isConfigured = await emailService.verifyConnection();
        if (!isConfigured) {
            return res.status(500).json({
                success: false,
                error: 'SendGrid is not properly configured',
                details: 'SENDGRID_API_KEY is missing or invalid',
                configured: false
            });
        }

        // Test email sending
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

            default:
                return res.status(400).json({
                    success: false,
                    error: `Unknown email type: ${emailType}`,
                    supportedTypes: ['order-confirmation', 'newsletter-welcome']
                });
        }

        if (result.success) {
            console.log(`✅ [EMAIL DIAGNOSTICS] Test email sent successfully to ${email}`);
            return res.status(200).json({
                success: true,
                message: `Test ${emailType} email sent successfully`,
                emailType: emailType,
                recipient: email,
                messageId: result.messageId,
                statusCode: result.statusCode,
                timestamp: result.timestamp,
                configured: true
            });
        } else {
            console.error(`❌ [EMAIL DIAGNOSTICS] Failed to send test email to ${email}:`, result.error);
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to send test email',
                details: result.details,
                emailType: emailType,
                recipient: email,
                configured: true
            });
        }

    } catch (error) {
        console.error('Email diagnostics test error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error during email test',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;

