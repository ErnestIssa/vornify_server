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
 * Send order confirmation email
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

        const result = await emailService.sendOrderConfirmationEmail(
            to,
            name,
            orderDetails
        );

        if (result.success) {
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
 * GET /api/email/verify
 * Verify SendGrid connection
 */
router.get('/verify', async (req, res) => {
    try {
        const isConnected = await emailService.verifyConnection();
        
        return res.status(200).json({
            success: isConnected,
            message: isConnected 
                ? 'SendGrid API is properly configured' 
                : 'SendGrid API configuration failed'
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

