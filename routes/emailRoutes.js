const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');

/**
 * POST /api/email/send
 * Generic email sending endpoint using dynamic templates
 * 
 * Body:
 * {
 *   "to": "recipient@example.com",
 *   "subject": "Subject Line",
 *   "templateId": "d-xxxxxxxxxxxxx",
 *   "dynamicData": { ... }
 * }
 */
router.post('/send', async (req, res) => {
    try {
        const { to, subject, templateId, dynamicData } = req.body;

        // Validate required fields
        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        if (!templateId) {
            return res.status(400).json({
                success: false,
                error: 'Template ID is required'
            });
        }

        // Send email
        const result = await emailService.sendCustomEmail(
            to,
            subject,
            templateId,
            dynamicData || {}
        );

        // Return response based on result
        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Email send error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/welcome
 * Send welcome email to new user
 * 
 * Body:
 * {
 *   "to": "user@example.com",
 *   "name": "John Doe"
 * }
 */
router.post('/welcome', async (req, res) => {
    try {
        const { to, name } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        const result = await emailService.sendWelcomeEmail(to, name);

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Welcome email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/order-confirmation
 * Send order confirmation email (ADMIN/TESTING ONLY)
 * 
 * ⚠️ WARNING: This endpoint should ONLY be used for testing/admin purposes.
 * Order confirmation emails are automatically sent via Stripe webhook after payment success.
 * 
 * This endpoint verifies payment status before sending to prevent emails for unpaid orders.
 * 
 * Body:
 * {
 *   "to": "customer@example.com",
 *   "name": "John Doe",
 *   "orderDetails": {
 *     "orderId": "PM123456",
 *     "orderDate": "2025-10-08",
 *     "items": [...],
 *     "totals": { "total": 500 },
 *     "shippingAddress": { ... }
 *   }
 * }
 */
router.post('/order-confirmation', async (req, res) => {
    try {
        const { to, name, orderDetails } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        if (!orderDetails) {
            return res.status(400).json({
                success: false,
                error: 'Order details are required'
            });
        }

        // CRITICAL: Verify payment status before sending email
        // Order confirmation emails should ONLY be sent for paid orders
        if (orderDetails.orderId) {
            try {
                const getDBInstance = require('../vornifydb/dbInstance');
                const db = getDBInstance();
                
                // Fetch order from database to verify payment status
                const orderResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'orders',
                    command: '--read',
                    data: { orderId: orderDetails.orderId }
                });

                if (orderResult.success && orderResult.data) {
                    const order = Array.isArray(orderResult.data) ? orderResult.data[0] : orderResult.data;
                    
                    // Verify payment status - ONLY send if payment succeeded
                    if (order.paymentStatus !== 'succeeded') {
                        return res.status(400).json({
                            success: false,
                            error: 'Order confirmation email can only be sent for paid orders',
                            errorCode: 'ORDER_NOT_PAID',
                            paymentStatus: order.paymentStatus,
                            message: `Order ${orderDetails.orderId} payment status is '${order.paymentStatus}', not 'succeeded'. Email cannot be sent.`
                        });
                    }

                    // Check if email was already sent (prevent duplicates)
                    if (order.emailSent === true) {
                        return res.status(400).json({
                            success: false,
                            error: 'Order confirmation email has already been sent',
                            errorCode: 'EMAIL_ALREADY_SENT',
                            message: `Order ${orderDetails.orderId} confirmation email was already sent. Use Stripe webhook for automatic sending.`
                        });
                    }
                } else {
                    // Order not found - allow sending but log warning (for testing scenarios)
                    console.warn(`⚠️ [EMAIL ROUTE] Order ${orderDetails.orderId} not found in database. Proceeding with email send (testing scenario?).`);
                }
            } catch (dbError) {
                console.error('Failed to verify order payment status:', dbError);
                // For testing scenarios, allow email but log error
                // In production, you might want to fail here
                console.warn('⚠️ [EMAIL ROUTE] Could not verify payment status, proceeding with caution (testing scenario?)');
            }
        } else {
            // No orderId provided - this is a testing scenario
            console.warn('⚠️ [EMAIL ROUTE] No orderId provided in orderDetails. This endpoint should only be used for testing/admin purposes.');
        }

        // Get language from orderDetails if provided
        const language = orderDetails.language || 'en';

        const result = await emailService.sendOrderConfirmationEmail(
            to,
            name,
            orderDetails,
            language
        );

        if (result.success) {
            // Mark email as sent in the order if orderId is provided
            if (orderDetails.orderId) {
                try {
                    const getDBInstance = require('../vornifydb/dbInstance');
                    const db = getDBInstance();
                    
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'orders',
                        command: '--update',
                        data: {
                            filter: { orderId: orderDetails.orderId },
                            update: { emailSent: true }
                        }
                    });
                } catch (dbError) {
                    console.error('Failed to update email sent flag:', dbError);
                    // Don't fail the email if database update fails
                }
            }
            
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Order confirmation email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/password-reset
 * Send password reset email
 * 
 * Body:
 * {
 *   "to": "user@example.com",
 *   "resetLink": "https://peakmode.se/reset-password?token=xxx"
 * }
 */
router.post('/password-reset', async (req, res) => {
    try {
        const { to, resetLink } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        if (!resetLink) {
            return res.status(400).json({
                success: false,
                error: 'Reset link is required'
            });
        }

        const result = await emailService.sendPasswordResetEmail(to, resetLink);

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Password reset email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/order-processing
 * Send order processing notification
 * 
 * Body:
 * {
 *   "to": "customer@example.com",
 *   "orderDetails": { ... }
 * }
 */
router.post('/order-processing', async (req, res) => {
    try {
        const { to, orderDetails } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        if (!orderDetails) {
            return res.status(400).json({
                success: false,
                error: 'Order details are required'
            });
        }

        const result = await emailService.sendOrderProcessingEmail(to, orderDetails);

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Order processing email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/shipping-notification
 * Send shipping notification
 * 
 * Body:
 * {
 *   "to": "customer@example.com",
 *   "orderDetails": {
 *     "orderId": "PM123456",
 *     "trackingNumber": "ABC123",
 *     "trackingUrl": "https://...",
 *     ...
 *   }
 * }
 */
router.post('/shipping-notification', async (req, res) => {
    try {
        const { to, orderDetails } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        if (!orderDetails) {
            return res.status(400).json({
                success: false,
                error: 'Order details are required'
            });
        }

        const result = await emailService.sendShippingNotificationEmail(to, orderDetails);

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Shipping notification email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/delivery-confirmation
 * Send delivery confirmation
 * 
 * Body:
 * {
 *   "to": "customer@example.com",
 *   "orderDetails": { ... }
 * }
 */
router.post('/delivery-confirmation', async (req, res) => {
    try {
        const { to, orderDetails } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        if (!orderDetails) {
            return res.status(400).json({
                success: false,
                error: 'Order details are required'
            });
        }

        const result = await emailService.sendDeliveryConfirmationEmail(to, orderDetails);

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Delivery confirmation email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/review-request
 * Send review request
 * 
 * Body:
 * {
 *   "to": "customer@example.com",
 *   "orderDetails": { ... }
 * }
 */
router.post('/review-request', async (req, res) => {
    try {
        const { to, orderDetails } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        if (!orderDetails) {
            return res.status(400).json({
                success: false,
                error: 'Order details are required'
            });
        }

        const result = await emailService.sendReviewRequestEmail(to, orderDetails);

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Review request email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/newsletter-welcome
 * Send newsletter welcome email with discount code
 * 
 * Body:
 * {
 *   "to": "subscriber@example.com",
 *   "name": "John Doe",
 *   "discountCode": "PEAK10-ABC123"
 * }
 */
router.post('/newsletter-welcome', async (req, res) => {
    try {
        const { to, name, discountCode } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        const result = await emailService.sendNewsletterWelcomeEmail(
            to,
            name,
            discountCode
        );

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Newsletter welcome email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/discount-reminder
 * Send discount reminder email
 * 
 * Body:
 * {
 *   "to": "subscriber@example.com",
 *   "name": "John Doe",
 *   "discountCode": "PEAK10-ABC123"
 * }
 */
router.post('/discount-reminder', async (req, res) => {
    try {
        const { to, name, discountCode } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        const result = await emailService.sendDiscountReminderEmail(
            to,
            name,
            discountCode
        );

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Discount reminder email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/account-setup
 * Send account setup confirmation email
 * 
 * Body:
 * {
 *   "to": "user@example.com",
 *   "name": "John Doe",
 *   "hubUrl": "https://peakmode.se/hub/dashboard"
 * }
 */
router.post('/account-setup', async (req, res) => {
    try {
        const { to, name, hubUrl } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        const result = await emailService.sendAccountSetupEmail(to, name, hubUrl);

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Account setup email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/verify-email
 * Send email verification email
 * 
 * Body:
 * {
 *   "to": "user@example.com",
 *   "name": "John Doe",
 *   "verificationLink": "https://peakmode.se/verify?token=xxx"
 * }
 */
router.post('/verify-email', async (req, res) => {
    try {
        const { to, name, verificationLink } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        if (!verificationLink) {
            return res.status(400).json({
                success: false,
                error: 'Verification link is required'
            });
        }

        const result = await emailService.sendEmailVerificationEmail(to, name, verificationLink);

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Email verification error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/password-reset-success
 * Send password reset success confirmation
 * 
 * Body:
 * {
 *   "to": "user@example.com",
 *   "name": "John Doe"
 * }
 */
router.post('/password-reset-success', async (req, res) => {
    try {
        const { to, name } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        const result = await emailService.sendPasswordResetSuccessEmail(to, name);

        if (result.success) {
            return res.status(200).json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        console.error('Password reset success email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/email/support-confirmation
 * Send support confirmation email
 */
router.post('/support-confirmation', async (req, res) => {
    try {
        const { to, firstName, ticketId } = req.body;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Recipient email address is required'
            });
        }

        const result = await emailService.sendSupportConfirmationEmail(to, firstName, ticketId);
        return res.status(result.success ? 200 : 500).json(result);

    } catch (error) {
        console.error('Support confirmation email error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * GET /api/email/verify
 * Verify SendGrid connection and configuration
 */
router.get('/verify', async (req, res) => {
    try {
        const apiKeyConfigured = !!process.env.SENDGRID_API_KEY;
        const fromEmail = process.env.EMAIL_FROM || 'support@peakmode.se';
        
        // Check if template IDs are configured
        const orderConfirmationTemplate = process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID || process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_EN;
        const newsletterTemplate = process.env.SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID;
        
        const isConnected = await emailService.verifyConnection();
        
        return res.status(200).json({
            success: isConnected && apiKeyConfigured,
            configured: {
                apiKey: apiKeyConfigured,
                fromEmail: fromEmail,
                orderConfirmationTemplate: !!orderConfirmationTemplate,
                newsletterTemplate: !!newsletterTemplate
            },
            templateIds: {
                orderConfirmation: orderConfirmationTemplate ? orderConfirmationTemplate.substring(0, 20) + '...' : 'Not configured',
                newsletter: newsletterTemplate ? newsletterTemplate.substring(0, 20) + '...' : 'Not configured'
            },
            message: isConnected && apiKeyConfigured
                ? 'SendGrid API is properly configured' 
                : 'SendGrid API configuration issues detected. Please check environment variables.',
            warnings: [
                !apiKeyConfigured ? 'SENDGRID_API_KEY is not set' : null,
                !orderConfirmationTemplate ? 'SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID is not set' : null,
                !newsletterTemplate ? 'SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID is not set' : null
            ].filter(Boolean)
        });

    } catch (error) {
        console.error('Email verification error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router;

