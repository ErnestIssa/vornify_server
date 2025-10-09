const sgMail = require('@sendgrid/mail');
require('dotenv').config();

/**
 * Clean SendGrid Email Service
 * Provides reusable email functions using SendGrid dynamic templates
 */
class EmailService {
    constructor() {
        // Initialize SendGrid with API key from environment variables
        const apiKey = process.env.SENDGRID_API_KEY;
        if (!apiKey) {
            console.warn('⚠️ SENDGRID_API_KEY not found in environment variables');
        } else {
            sgMail.setApiKey(apiKey);
            console.log('✅ SendGrid API initialized');
        }
        
        this.fromEmail = process.env.EMAIL_FROM || 'support@peakmode.se';
    }

    /**
     * Send a generic email using SendGrid dynamic template
     * @param {string} to - Recipient email address
     * @param {string} templateId - SendGrid template ID
     * @param {object} dynamicData - Dynamic template data
     * @returns {Promise<object>} Result object with success status
     */
    async sendCustomEmail(to, subject, templateId, dynamicData) {
        try {
            if (!to) {
                throw new Error('Recipient email address is required');
            }

            if (!templateId) {
                throw new Error('Template ID is required');
            }

            const msg = {
                to: to,
                from: this.fromEmail,
                templateId: templateId,
                dynamicTemplateData: dynamicData || {}
            };

            // Add subject if provided (though templates usually have their own subject)
            if (subject) {
                msg.subject = subject;
            }

            const response = await sgMail.send(msg);
            
            console.log(`✅ Email sent successfully to ${to}`);
            
            return {
                success: true,
                message: 'Email sent successfully',
                messageId: response[0].headers['x-message-id'],
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ SendGrid Error:', error.response?.body || error.message);
            
            return {
                success: false,
                error: 'Failed to send email',
                details: error.response?.body?.errors || error.message
            };
        }
    }

    /**
     * Send welcome email to new user
     * @param {string} to - Recipient email address
     * @param {string} name - Recipient name
     * @returns {Promise<object>} Result object
     */
    async sendWelcomeEmail(to, name) {
        try {
            // You should create this template in SendGrid dashboard
            const templateId = process.env.SENDGRID_WELCOME_TEMPLATE_ID || 'd-welcome_template_id';
            
            const dynamicData = {
                name: name || 'Valued Customer',
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Welcome to Peak Mode',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Welcome email error:', error);
            return {
                success: false,
                error: 'Failed to send welcome email',
                details: error.message
            };
        }
    }

    /**
     * Send order confirmation email
     * @param {string} to - Recipient email address
     * @param {string} name - Customer name
     * @param {object} orderDetails - Order details object
     * @returns {Promise<object>} Result object
     */
    async sendOrderConfirmationEmail(to, name, orderDetails) {
        try {
            // You should create this template in SendGrid dashboard
            const templateId = process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID || 'd-order_confirmation_template_id';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                order_number: orderDetails.orderId || 'N/A',
                order_date: orderDetails.orderDate || new Date().toISOString(),
                order_total: orderDetails.totals?.total || '0',
                order_items: orderDetails.items || [],
                shipping_address: this.formatAddress(orderDetails.shippingAddress),
                order_status_url: `https://peakmode.se/track-order?orderId=${orderDetails.orderId}`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `Order Confirmation - ${orderDetails.orderId}`,
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Order confirmation email error:', error);
            return {
                success: false,
                error: 'Failed to send order confirmation email',
                details: error.message
            };
        }
    }

    /**
     * Send password reset email
     * @param {string} to - Recipient email address
     * @param {string} resetLink - Password reset link
     * @returns {Promise<object>} Result object
     */
    async sendPasswordResetEmail(to, resetLink) {
        try {
            // You should create this template in SendGrid dashboard
            const templateId = process.env.SENDGRID_PASSWORD_RESET_TEMPLATE_ID || 'd-password_reset_template_id';
            
            const dynamicData = {
                reset_link: resetLink,
                expiry_hours: 24,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Password Reset Request',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Password reset email error:', error);
            return {
                success: false,
                error: 'Failed to send password reset email',
                details: error.message
            };
        }
    }

    /**
     * Send newsletter welcome email
     * @param {string} to - Recipient email address
     * @param {string} name - Subscriber name
     * @param {string} discountCode - Discount code
     * @returns {Promise<object>} Result object
     */
    async sendNewsletterWelcomeEmail(to, name, discountCode) {
        try {
            const templateId = process.env.SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID || 'd-newsletter_welcome_template_id';
            
            const dynamicData = {
                customer_name: name || 'Peak Mode Member',
                discount_code: discountCode,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Welcome to Peak Mode — Here\'s 10% OFF',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Newsletter welcome email error:', error);
            return {
                success: false,
                error: 'Failed to send newsletter welcome email',
                details: error.message
            };
        }
    }

    /**
     * Send order processing email
     * @param {string} to - Recipient email address
     * @param {object} orderDetails - Order details
     * @returns {Promise<object>} Result object
     */
    async sendOrderProcessingEmail(to, orderDetails) {
        try {
            const templateId = process.env.SENDGRID_ORDER_PROCESSING_TEMPLATE_ID || 'd-order_processing_template_id';
            
            const dynamicData = {
                customer_name: orderDetails.customer?.name || 'Valued Customer',
                order_number: orderDetails.orderId,
                order_items: orderDetails.items || [],
                order_total: orderDetails.totals?.total || '0',
                shipping_address: this.formatAddress(orderDetails.shippingAddress),
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `Your Order Is Being Processed - ${orderDetails.orderId}`,
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Order processing email error:', error);
            return {
                success: false,
                error: 'Failed to send order processing email',
                details: error.message
            };
        }
    }

    /**
     * Send shipping notification email
     * @param {string} to - Recipient email address
     * @param {object} orderDetails - Order details with tracking info
     * @returns {Promise<object>} Result object
     */
    async sendShippingNotificationEmail(to, orderDetails) {
        try {
            const templateId = process.env.SENDGRID_SHIPPING_NOTIFICATION_TEMPLATE_ID || 'd-shipping_notification_template_id';
            
            const dynamicData = {
                customer_name: orderDetails.customer?.name || 'Valued Customer',
                order_number: orderDetails.orderId,
                tracking_number: orderDetails.trackingNumber || 'N/A',
                tracking_url: orderDetails.trackingUrl || '#',
                estimated_delivery: orderDetails.estimatedDelivery || 'N/A',
                shipping_provider: orderDetails.shippingProvider || 'N/A',
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `Your Order Is on the Way! - ${orderDetails.orderId}`,
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Shipping notification email error:', error);
            return {
                success: false,
                error: 'Failed to send shipping notification email',
                details: error.message
            };
        }
    }

    /**
     * Send delivery confirmation email
     * @param {string} to - Recipient email address
     * @param {object} orderDetails - Order details
     * @returns {Promise<object>} Result object
     */
    async sendDeliveryConfirmationEmail(to, orderDetails) {
        try {
            const templateId = process.env.SENDGRID_DELIVERY_CONFIRMATION_TEMPLATE_ID || 'd-delivery_confirmation_template_id';
            
            const dynamicData = {
                customer_name: orderDetails.customer?.name || 'Valued Customer',
                order_number: orderDetails.orderId,
                order_items: orderDetails.items || [],
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `Your Order Has Arrived! - ${orderDetails.orderId}`,
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Delivery confirmation email error:', error);
            return {
                success: false,
                error: 'Failed to send delivery confirmation email',
                details: error.message
            };
        }
    }

    /**
     * Send review request email
     * @param {string} to - Recipient email address
     * @param {object} orderDetails - Order details
     * @returns {Promise<object>} Result object
     */
    async sendReviewRequestEmail(to, orderDetails) {
        try {
            const templateId = process.env.SENDGRID_REVIEW_REQUEST_TEMPLATE_ID || 'd-review_request_template_id';
            
            const dynamicData = {
                customer_name: orderDetails.customer?.name || 'Valued Customer',
                order_number: orderDetails.orderId,
                review_url: `https://peakmode.se/review?orderId=${orderDetails.orderId}`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `How Was Your Peak Mode Gear? - ${orderDetails.orderId}`,
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Review request email error:', error);
            return {
                success: false,
                error: 'Failed to send review request email',
                details: error.message
            };
        }
    }

    /**
     * Send discount reminder email
     * @param {string} to - Recipient email address
     * @param {string} name - Subscriber name
     * @param {string} discountCode - Discount code
     * @returns {Promise<object>} Result object
     */
    async sendDiscountReminderEmail(to, name, discountCode) {
        try {
            const templateId = process.env.SENDGRID_DISCOUNT_REMINDER_TEMPLATE_ID || 'd-discount_reminder_template_id';
            
            const dynamicData = {
                customer_name: name || 'Peak Mode Member',
                discount_code: discountCode,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Don\'t Miss Out — Your 10% OFF Is Waiting',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Discount reminder email error:', error);
            return {
                success: false,
                error: 'Failed to send discount reminder email',
                details: error.message
            };
        }
    }

    /**
     * Send account setup confirmation email
     * @param {string} to - Recipient email address
     * @param {string} name - Customer name
     * @param {string} hubUrl - Direct login/dashboard link
     * @returns {Promise<object>} Result object
     */
    async sendAccountSetupEmail(to, name, hubUrl) {
        try {
            const templateId = process.env.SENDGRID_ACCOUNT_SETUP_TEMPLATE_ID || 'd-6ddabc33045c47a3933e9bcf0d1a3501';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                hub_url: hubUrl || 'https://peakmode.se/hub/dashboard',
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Welcome to Peak Mode Hub',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Account setup email error:', error);
            return {
                success: false,
                error: 'Failed to send account setup email',
                details: error.message
            };
        }
    }

    /**
     * Send email verification email
     * @param {string} to - Recipient email address
     * @param {string} name - Customer name
     * @param {string} verificationLink - Email verification link
     * @returns {Promise<object>} Result object
     */
    async sendEmailVerificationEmail(to, name, verificationLink) {
        try {
            const templateId = process.env.SENDGRID_EMAIL_VERIFICATION_TEMPLATE_ID || 'd-7916d8a52f404e20b3c331bf12548582';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                verification_link: verificationLink,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Verify Your Peak Mode Email',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Email verification email error:', error);
            return {
                success: false,
                error: 'Failed to send email verification email',
                details: error.message
            };
        }
    }

    /**
     * Send password reset success confirmation email
     * @param {string} to - Recipient email address
     * @param {string} name - Customer name
     * @returns {Promise<object>} Result object
     */
    async sendPasswordResetSuccessEmail(to, name) {
        try {
            const templateId = process.env.SENDGRID_PASSWORD_RESET_SUCCESS_TEMPLATE_ID || 'd-ecb71179b34e463bb596a7e17892117d';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                reset_link: 'https://peakmode.se/reset-password',
                support_email: 'support@peakmode.se',
                website_url: 'https://peakmode.se',
                hub_login_url: 'https://peakmode.se/hub/auth',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Password Successfully Reset',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Password reset success email error:', error);
            return {
                success: false,
                error: 'Failed to send password reset success email',
                details: error.message
            };
        }
    }

    /**
     * Helper method to format address for email templates
     * @param {object} address - Address object
     * @returns {string} Formatted address string
     */
    formatAddress(address) {
        if (!address) return 'No address provided';
        
        return `${address.name || ''}<br>
${address.street || ''}<br>
${address.postalCode || ''} ${address.city || ''}<br>
${address.country || ''}`.trim();
    }

    /**
     * Verify SendGrid API connection
     * @returns {Promise<boolean>} True if connection is valid
     */
    async verifyConnection() {
        try {
            // SendGrid doesn't have a built-in verify method like nodemailer
            // We can check if the API key is set
            if (!process.env.SENDGRID_API_KEY) {
                console.error('❌ SENDGRID_API_KEY not configured');
                return false;
            }
            
            console.log('✅ SendGrid API key is configured');
            return true;
        } catch (error) {
            console.error('❌ SendGrid verification error:', error);
            return false;
        }
    }
}

// Export singleton instance
module.exports = new EmailService();

