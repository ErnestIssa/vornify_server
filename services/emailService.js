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
        this.supportInboxEmail = process.env.SUPPORT_INBOX_EMAIL || 'support@peakmode.se';
        this.supportSenderName = process.env.SUPPORT_INBOX_NAME || 'Peak Mode Support';
        this.adminNotificationEmail = process.env.ADMIN_EMAIL || process.env.ADMIN_SUPPORT_EMAIL || null;
    }

    /**
     * Send a generic email using SendGrid dynamic template
     * @param {string} to - Recipient email address
     * @param {string} subject - Email subject
     * @param {string} templateId - SendGrid template ID
     * @param {object} dynamicData - Dynamic template data
     * @returns {Promise<object>} Result object with success status
     */
    async sendCustomEmail(to, subject, templateId, dynamicData) {
        try {
            // Check if SendGrid API key is configured
            if (!process.env.SENDGRID_API_KEY) {
                const errorMsg = 'SENDGRID_API_KEY is not configured in environment variables';
                console.error('❌ SendGrid Error:', errorMsg);
                return {
                    success: false,
                    error: 'Email service not configured',
                    details: errorMsg
                };
            }

            if (!to) {
                throw new Error('Recipient email address is required');
            }

            if (!templateId || (templateId.startsWith('d-') && templateId.includes('template_id'))) {
                // Warn if using placeholder template ID
                console.warn(`⚠️ Warning: Using placeholder template ID: ${templateId}. Please set proper SendGrid template ID in environment variables.`);
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

            console.log(`📧 Attempting to send email to ${to} using template ${templateId.substring(0, 20)}...`);
            
            const response = await sgMail.send(msg);
            
            console.log(`✅ Email sent successfully to ${to}`, {
                messageId: response[0]?.headers?.['x-message-id'],
                statusCode: response[0]?.statusCode
            });
            
            return {
                success: true,
                message: 'Email sent successfully',
                messageId: response[0]?.headers?.['x-message-id'],
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            const errorDetails = error.response?.body || error.message;
            console.error('❌ SendGrid Error Details:', {
                message: error.message,
                code: error.code,
                response: error.response?.body,
                statusCode: error.response?.statusCode,
                to: to,
                templateId: templateId
            });
            
            // Provide more helpful error messages
            let userFriendlyError = 'Failed to send email';
            if (error.response?.body?.errors) {
                const firstError = error.response.body.errors[0];
                userFriendlyError = firstError.message || userFriendlyError;
                
                // Handle specific SendGrid errors
                if (firstError.field === 'template_id') {
                    userFriendlyError = 'Invalid email template configuration. Please contact support.';
                } else if (error.response.statusCode === 401) {
                    userFriendlyError = 'Email service authentication failed. Please check API key configuration.';
                } else if (error.response.statusCode === 403) {
                    userFriendlyError = 'Email service authorization failed. Please check API permissions.';
                }
            }
            
            return {
                success: false,
                error: userFriendlyError,
                details: errorDetails,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Verify SendGrid connection
     * @returns {Promise<boolean>} True if connection is valid
     */
    async verifyConnection() {
        try {
            if (!process.env.SENDGRID_API_KEY) {
                return false;
            }
            // Test connection by checking API key format (basic validation)
            // In production, you might want to make a test API call
            return !!process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY.length > 0;
        } catch (error) {
            console.error('❌ SendGrid connection verification error:', error);
            return false;
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
     * @param {string} language - Language code (en or sv), defaults to 'en'
     * @returns {Promise<object>} Result object
     */
    async sendOrderConfirmationEmail(to, name, orderDetails, language = 'en') {
        try {
            // Get language-specific template ID or fallback to default
            const languageTemplates = {
                'en': process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_EN || process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID || 'd-order_confirmation_template_id',
                'sv': process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID_SV || process.env.SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID || 'd-order_confirmation_template_id'
            };
            
            const templateId = languageTemplates[language] || languageTemplates['en'];
            
            // Calculate correct total from multiple possible sources
            const orderTotal = orderDetails.totals?.total || 
                              orderDetails.total || 
                              (orderDetails.items ? orderDetails.items.reduce((sum, item) => sum + (item.price * item.quantity), 0) : 0);
            
            // Get currency from order
            const currency = (orderDetails.currency || 
                             orderDetails.baseCurrency || 
                             'SEK').toUpperCase();
            
            // Currency symbols and display formats
            const currencyFormats = {
                'SEK': { symbol: 'SEK', display: 'SEK' },
                'EUR': { symbol: '€', display: 'EUR' },
                'DKK': { symbol: 'kr', display: 'DKK' },
                'NOK': { symbol: 'kr', display: 'NOK' },
                'PLN': { symbol: 'zł', display: 'PLN' },
                'CZK': { symbol: 'Kč', display: 'CZK' },
                'HUF': { symbol: 'Ft', display: 'HUF' },
                'BGN': { symbol: 'лв', display: 'BGN' },
                'RON': { symbol: 'lei', display: 'RON' },
                'USD': { symbol: '$', display: 'USD' },
                'GBP': { symbol: '£', display: 'GBP' }
            };
            
            const currencyFormat = currencyFormats[currency] || { symbol: currency, display: currency };
            const currencySymbol = currencyFormat.display;
            
            // Format order items as structured data
            const formattedItems = this.formatOrderItemsForEmail(orderDetails.items || [], currency);
            
            // Format address as plain text
            const formattedAddress = this.formatAddressForEmail(orderDetails.shippingAddress || orderDetails.customer);
            
            // Language-specific subject
            const subjects = {
                'en': `Order Confirmation - ${orderDetails.orderId}`,
                'sv': `Orderbekräftelse - ${orderDetails.orderId}`
            };
            const subject = subjects[language] || subjects['en'];
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                order_number: orderDetails.orderId || 'N/A',
                order_date: orderDetails.orderDate || orderDetails.createdAt || new Date().toISOString(),
                order_total: `${orderTotal} ${currencySymbol}`,
                order_currency: currency,
                order_currency_symbol: currencyFormat.symbol,
                order_items: formattedItems,
                order_items_count: formattedItems.length,
                shipping_address: formattedAddress,
                order_status_url: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/track-order?orderId=${orderDetails.orderId}`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear(),
                language: language
            };

            const result = await this.sendCustomEmail(
                to,
                subject,
                templateId,
                dynamicData
            );

            // Log communication if email was sent successfully
            if (result.success && orderDetails.customer?.email) {
                await this.logCommunication(orderDetails.customer.email, {
                    type: 'email',
                    subject: `Order Confirmation - ${orderDetails.orderId}`,
                    content: 'Order confirmation email sent',
                    status: 'sent'
                });
            }

            return result;

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
     * Send order processing email
     * @param {string} to - Recipient email address
     * @param {object} orderDetails - Order details
     * @returns {Promise<object>} Result object
     */
    async sendOrderProcessingEmail(to, orderDetails) {
        try {
            const templateId = process.env.SENDGRID_ORDER_PROCESSING_TEMPLATE_ID || 'd-order_processing_template_id';
            
            const orderCurrency = (orderDetails.currency || orderDetails.baseCurrency || 'SEK').toUpperCase();
            const formattedItems = this.formatOrderItemsForEmail(orderDetails.items || [], orderCurrency);
            const formattedAddress = this.formatAddressForEmail(orderDetails.shippingAddress || orderDetails.customer);
            
            const dynamicData = {
                customer_name: orderDetails.customer?.name || 'Valued Customer',
                order_number: orderDetails.orderId,
                order_items: formattedItems,
                order_items_count: formattedItems.length,
                order_total: `${orderDetails.totals?.total || 0} ${orderCurrency}`,
                shipping_address: formattedAddress,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `Your Order ${orderDetails.orderId} is Being Processed`,
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
            
            const orderCurrency = (orderDetails.currency || orderDetails.baseCurrency || 'SEK').toUpperCase();
            const formattedItems = this.formatOrderItemsForEmail(orderDetails.items || [], orderCurrency);
            const formattedAddress = this.formatAddressForEmail(orderDetails.shippingAddress || orderDetails.customer);
            
            const dynamicData = {
                customer_name: orderDetails.customer?.name || 'Valued Customer',
                order_number: orderDetails.orderId,
                tracking_number: orderDetails.trackingNumber || 'N/A',
                tracking_url: orderDetails.trackingUrl || '#',
                order_items: formattedItems,
                order_items_count: formattedItems.length,
                shipping_address: formattedAddress,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `Your Order ${orderDetails.orderId} Has Shipped`,
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
            
            const orderCurrency = (orderDetails.currency || orderDetails.baseCurrency || 'SEK').toUpperCase();
            const formattedItems = this.formatOrderItemsForEmail(orderDetails.items || [], orderCurrency);
            const formattedAddress = this.formatAddressForEmail(orderDetails.shippingAddress || orderDetails.customer);
            
            const dynamicData = {
                customer_name: orderDetails.customer?.name || 'Valued Customer',
                order_number: orderDetails.orderId,
                order_items: formattedItems,
                order_items_count: formattedItems.length,
                shipping_address: formattedAddress,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `Your Order ${orderDetails.orderId} Has Been Delivered`,
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
                review_url: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/review?orderId=${orderDetails.orderId}`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `How Was Your Order?`,
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
     * Send newsletter welcome email with discount code
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
                'Your Discount Code Awaits',
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
     * @param {string} name - User name
     * @param {string} hubUrl - Hub dashboard URL
     * @returns {Promise<object>} Result object
     */
    async sendAccountSetupEmail(to, name, hubUrl) {
        try {
            const templateId = process.env.SENDGRID_ACCOUNT_SETUP_TEMPLATE_ID || 'd-account_setup_template_id';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                hub_url: hubUrl || `${process.env.FRONTEND_URL || 'https://peakmode.se'}/hub/dashboard`,
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
     * @param {string} name - User name
     * @param {string} verificationLink - Email verification link
     * @returns {Promise<object>} Result object
     */
    async sendEmailVerificationEmail(to, name, verificationLink) {
        try {
            const templateId = process.env.SENDGRID_EMAIL_VERIFICATION_TEMPLATE_ID || 'd-email_verification_template_id';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                verification_link: verificationLink,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Verify Your Email Address',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Email verification error:', error);
            return {
                success: false,
                error: 'Failed to send email verification',
                details: error.message
            };
        }
    }

    /**
     * Send password reset success confirmation
     * @param {string} to - Recipient email address
     * @param {string} name - User name
     * @returns {Promise<object>} Result object
     */
    async sendPasswordResetSuccessEmail(to, name) {
        try {
            const templateId = process.env.SENDGRID_PASSWORD_RESET_SUCCESS_TEMPLATE_ID || 'd-password_reset_success_template_id';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                website_url: 'https://peakmode.se',
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
     * Send support confirmation email
     * @param {string} to - Recipient email address
     * @param {string} firstName - User first name
     * @param {string} ticketId - Support ticket ID
     * @returns {Promise<object>} Result object
     */
    async sendSupportConfirmationEmail(to, firstName, ticketId) {
        try {
            const templateId = process.env.SENDGRID_SUPPORT_CONFIRMATION_TEMPLATE_ID || 'd-support_confirmation_template_id';
            
            const dynamicData = {
                customer_name: firstName || 'Valued Customer',
                ticket_id: ticketId || 'N/A',
                support_url: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/support`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `Support Request Received - ${ticketId}`,
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Support confirmation email error:', error);
            return {
                success: false,
                error: 'Failed to send support confirmation email',
                details: error.message
            };
        }
    }

    /**
     * Format order items for email template (structured data, not HTML)
     * @param {Array} items - Order items array
     * @param {string} currency - Currency code
     * @returns {Array} Formatted items array
     */
    formatOrderItemsForEmail(items, currency = 'SEK') {
        if (!items || !Array.isArray(items)) return [];
        
        return items.map(item => ({
            name: item.name || 'Product',
            variant: item.variant ? `${item.variant.color || ''}, ${item.variant.size || ''}`.trim().replace(/^,\s*|,\s*$/g, '') : '',
            quantity: item.quantity || 1,
            price: item.price || 0,
            total: (item.price || 0) * (item.quantity || 1),
            currency: currency
        }));
    }

    /**
     * Format address for email template (plain text, not HTML)
     * @param {object} address - Address object
     * @returns {string} Formatted address string
     */
    formatAddressForEmail(address) {
        if (!address) return 'No address provided';
        
        const parts = [];
        if (address.name) parts.push(address.name);
        if (address.street || address.address1) parts.push(address.street || address.address1);
        if (address.address2) parts.push(address.address2);
        if (address.city) {
            const cityLine = [address.city];
            if (address.postalCode || address.postal_code) {
                cityLine.unshift(address.postalCode || address.postal_code);
            }
            parts.push(cityLine.join(' '));
        }
        if (address.country || address.countryCode) parts.push(address.country || address.countryCode);
        
        return parts.join('\n');
    }

    /**
     * Log communication to database (if needed)
     * @param {string} email - Email address
     * @param {object} communication - Communication details
     * @returns {Promise<void>}
     */
    async logCommunication(email, communication) {
        try {
            // This is a placeholder - implement database logging if needed
            // For now, just log to console
            console.log(`📝 Communication logged: ${email}`, communication);
            
            // If you need to save to database, uncomment and implement:
            /*
            const getDBInstance = require('../vornifydb/dbInstance');
            const db = getDBInstance();
            
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'communications',
                command: '--create',
                data: {
                    email: email,
                    ...communication,
                    timestamp: new Date().toISOString()
                }
            });
            */
        } catch (error) {
            console.error('Failed to log communication:', error);
            // Don't throw - logging failures shouldn't break email sending
        }
    }
}

// Export singleton instance
module.exports = new EmailService();

