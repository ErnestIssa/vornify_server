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

            // Check if template ID is a placeholder
            const isPlaceholder = !templateId || (templateId.startsWith('d-') && templateId.includes('template_id'));
            
            const msg = {
                to: to,
                from: this.fromEmail
            };

            // Add subject (required for non-template emails)
            msg.subject = subject || 'Email from Peak Mode';

            // If template ID is a placeholder, send plain content instead
            if (isPlaceholder) {
                console.warn(`⚠️ Warning: Using placeholder template ID: ${templateId}. Sending plain text email instead.`);
                
                // Generate plain text and HTML content from dynamic data
                let textContent = '';
                let htmlContent = '';
                
                // Add greeting based on dynamic data
                if (dynamicData && dynamicData.customer_name) {
                    textContent = `Hello ${dynamicData.customer_name},\n\n`;
                    htmlContent = `<p>Hello ${dynamicData.customer_name},</p>`;
                } else {
                    textContent = 'Hello,\n\n';
                    htmlContent = '<p>Hello,</p>';
                }
                
                // Add main message based on subject/type
                if (subject && subject.includes('Support Request')) {
                    const ticketId = dynamicData?.ticket_id || 'N/A';
                    textContent += `Thank you for contacting Peak Mode Support. We have received your support request.\n\n`;
                    textContent += `Your ticket ID is: ${ticketId}\n\n`;
                    textContent += `We will review your message and respond within 24 hours.\n\n`;
                    
                    htmlContent += `<p>Thank you for contacting Peak Mode Support. We have received your support request.</p>`;
                    htmlContent += `<p><strong>Your ticket ID is:</strong> ${ticketId}</p>`;
                    htmlContent += `<p>We will review your message and respond within 24 hours.</p>`;
                } else {
                    // Generic message
                    textContent += subject || 'Thank you for contacting us.\n\n';
                    htmlContent += `<p>${subject || 'Thank you for contacting us.'}</p>`;
                }
                
                // Add additional dynamic data
                if (dynamicData) {
                    const excludeKeys = ['customer_name', 'ticket_id', 'subject', 'message'];
                    Object.entries(dynamicData).forEach(([key, value]) => {
                        if (!excludeKeys.includes(key) && value) {
                            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                            textContent += `${label}: ${value}\n`;
                            htmlContent += `<p><strong>${label}:</strong> ${value}</p>`;
                        }
                    });
                }
                
                // Add footer
                if (dynamicData?.support_url) {
                    textContent += `\nYou can view your support request at: ${dynamicData.support_url}\n\n`;
                    htmlContent += `<p><a href="${dynamicData.support_url}">View your support request</a></p>`;
                }
                
                textContent += `\nBest regards,\nPeak Mode Team`;
                htmlContent += `<p>Best regards,<br>Peak Mode Team</p>`;
                
                // Use plain text and HTML content instead of template
                msg.text = textContent;
                msg.html = htmlContent;
            } else {
                // Use template ID as normal
                msg.templateId = templateId;
                msg.dynamicTemplateData = dynamicData || {};
                console.log(`📧 Attempting to send email to ${to} using template ${templateId.substring(0, 20)}...`);
            }
            
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
            // Check multiple possible environment variable names (handle typos/variations)
            const templateId = process.env.SENDGRID_SUPPORT_CONFIRMATION_TEMPLATE_ID || 
                               process.env.SENDGRID_SUPPORT_COMFIRMATION_TEMPLATE_ID || // Handle typo: COMFIRMATION
                               process.env.SENDGRID_SUPPORT_CONFIRMATION_ID || // Handle missing _TEMPLATE
                               'd-support_confirmation_template_id';
            
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
     * Send drops confirmation email (for new drops subscriptions)
     * @param {string} to - Recipient email address
     * @param {string} name - Subscriber name
     * @returns {Promise<object>} Result object
     */
    async sendDropsConfirmationEmail(to, name) {
        try {
            const templateId = process.env.SENDGRID_DROPS_CONFIRMATION_TEMPLATE_ID || 'd-drops_confirmation_template_id';
            
            const dynamicData = {
                customer_name: name || 'Peak Mode Member',
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'You\'re Subscribed to New Drops!',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Drops confirmation email error:', error);
            return {
                success: false,
                error: 'Failed to send drops confirmation email',
                details: error.message
            };
        }
    }

    /**
     * Send discount code update email (for existing subscribers)
     * @param {string} to - Recipient email address
     * @param {string} name - Subscriber name
     * @param {string} discountCode - Discount code
     * @returns {Promise<object>} Result object
     */
    async sendDiscountCodeUpdateEmail(to, name, discountCode) {
        try {
            const templateId = process.env.SENDGRID_DISCOUNT_CODE_UPDATE_TEMPLATE_ID || 
                             process.env.SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID || 
                             'd-discount_code_update_template_id';
            
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
            console.error('❌ Discount code update email error:', error);
            return {
                success: false,
                error: 'Failed to send discount code update email',
                details: error.message
            };
        }
    }

    /**
     * Send used/expired discount notification email
     * @param {string} to - Recipient email address
     * @param {string} name - Subscriber name
     * @returns {Promise<object>} Result object
     */
    async sendUsedExpiredDiscountNotificationEmail(to, name) {
        try {
            const templateId = process.env.SENDGRID_USED_EXPIRED_DISCOUNT_TEMPLATE_ID || 
                             process.env.SENDGRID_DISCOUNT_REMINDER_TEMPLATE_ID || 
                             'd-used_expired_discount_template_id';
            
            const dynamicData = {
                customer_name: name || 'Peak Mode Member',
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Your Discount Code Has Expired',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Used/expired discount notification email error:', error);
            return {
                success: false,
                error: 'Failed to send used/expired discount notification email',
                details: error.message
            };
        }
    }

    /**
     * Send newsletter confirmation email
     * @param {string} to - Recipient email address
     * @param {string} name - Subscriber name
     * @returns {Promise<object>} Result object
     */
    async sendNewsletterConfirmationEmail(to, name) {
        try {
            const templateId = process.env.SENDGRID_NEWSLETTER_CONFIRMATION_TEMPLATE_ID || 
                             process.env.SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID || 
                             'd-newsletter_confirmation_template_id';
            
            const dynamicData = {
                customer_name: name || 'Peak Mode Member',
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'You\'re Subscribed to Our Newsletter!',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Newsletter confirmation email error:', error);
            return {
                success: false,
                error: 'Failed to send newsletter confirmation email',
                details: error.message
            };
        }
    }

    /**
     * Send marketing confirmation email
     * @param {string} to - Recipient email address
     * @param {string} name - Subscriber name
     * @returns {Promise<object>} Result object
     */
    async sendMarketingConfirmationEmail(to, name) {
        try {
            const templateId = process.env.SENDGRID_MARKETING_CONFIRMATION_TEMPLATE_ID || 
                             process.env.SENDGRID_NEWSLETTER_WELCOME_TEMPLATE_ID || 
                             'd-marketing_confirmation_template_id';
            
            const dynamicData = {
                customer_name: name || 'Peak Mode Member',
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Marketing Preferences Updated',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Marketing confirmation email error:', error);
            return {
                success: false,
                error: 'Failed to send marketing confirmation email',
                details: error.message
            };
        }
    }

    /**
     * Send payment failed email
     * @param {string} to - Recipient email address
     * @param {string} name - Customer name
     * @param {string} orderNumber - Order number
     * @param {string} retryUrl - Payment retry URL
     * @returns {Promise<object>} Result object
     */
    async sendPaymentFailedEmail(to, name, orderNumber, retryUrl) {
        try {
            const templateId = process.env.SENDGRID_PAYMENT_FAILED_TEMPLATE_ID || 'd-payment_failed_template_id';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                order_number: orderNumber || 'N/A',
                retry_url: retryUrl || `${process.env.FRONTEND_URL || 'https://peakmode.se'}/checkout`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `Payment Failed for Order ${orderNumber}`,
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Payment failed email error:', error);
            return {
                success: false,
                error: 'Failed to send payment failed email',
                details: error.message
            };
        }
    }

    /**
     * Send abandoned cart email
     * @param {string} to - Recipient email address
     * @param {string} name - Customer name
     * @param {Array} items - Cart items array
     * @param {number} total - Cart total
     * @param {string} cartUrl - Cart URL
     * @param {string} emailType - Email type: 'first' or 'second' (optional)
     * @returns {Promise<object>} Result object
     */
    async sendAbandonedCartEmail(to, name, items, total, cartUrl, emailType = 'first') {
        try {
            const templateId = emailType === 'second' 
                ? (process.env.SENDGRID_ABANDONED_CART_SECOND_TEMPLATE_ID || process.env.SENDGRID_ABANDONED_CART_TEMPLATE_ID || 'd-abandoned_cart_second_template_id')
                : (process.env.SENDGRID_ABANDONED_CART_TEMPLATE_ID || 'd-abandoned_cart_template_id');
            
            // Format items for email
            const formattedItems = this.formatOrderItemsForEmail(items || [], 'SEK');
            const currency = 'SEK';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                cart_items: formattedItems,
                cart_items_count: formattedItems.length,
                cart_total: `${total || 0} ${currency}`,
                cart_url: cartUrl || `${process.env.FRONTEND_URL || 'https://peakmode.se'}/cart`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            const subject = emailType === 'second' 
                ? 'Complete Your Purchase - Final Reminder'
                : 'You Left Items in Your Cart';

            return await this.sendCustomEmail(
                to,
                subject,
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Abandoned cart email error:', error);
            return {
                success: false,
                error: 'Failed to send abandoned cart email',
                details: error.message
            };
        }
    }

    /**
     * Send review confirmation email
     * @param {string} to - Recipient email address
     * @param {string} name - Customer name
     * @param {object} reviewDetails - Review details
     * @returns {Promise<object>} Result object
     */
    async sendReviewConfirmationEmail(to, name, reviewDetails) {
        try {
            const templateId = process.env.SENDGRID_REVIEW_CONFIRMATION_TEMPLATE_ID || 'd-review_confirmation_template_id';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                product_name: reviewDetails.productName || 'Your Purchase',
                rating: reviewDetails.rating || 5,
                review_url: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/products/${reviewDetails.productId}`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Thank You for Your Review!',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Review confirmation email error:', error);
            return {
                success: false,
                error: 'Failed to send review confirmation email',
                details: error.message
            };
        }
    }

    /**
     * Send support message to inbox (forward to admin)
     * @param {object} params - Parameters object
     * @param {string} params.fromEmail - Sender email
     * @param {string} params.fromName - Sender name
     * @param {string} params.subject - Email subject
     * @param {string} params.message - Message content
     * @param {string} params.ticketId - Ticket ID
     * @returns {Promise<object>} Result object
     */
    async sendSupportInboxEmail({ fromEmail, fromName, subject, message, ticketId }) {
        try {
            // Check multiple possible environment variable names (handle variations)
            const templateId = process.env.SENDGRID_SUPPORT_INBOX_TEMPLATE_ID || 
                               process.env.SENDGRID_SUPPORT_INBOX_ID || // Handle missing _TEMPLATE
                               'd-support_inbox_template_id';
            
            const dynamicData = {
                customer_name: fromName || 'Customer',
                customer_email: fromEmail,
                subject: subject,
                message: message,
                ticket_id: ticketId || 'N/A',
                support_url: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/support`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            // Send to support inbox
            const toEmail = this.supportInboxEmail || this.adminNotificationEmail || 'support@peakmode.se';

            return await this.sendCustomEmail(
                toEmail,
                `Support Request: ${subject} [${ticketId}]`,
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Support inbox email error:', error);
            return {
                success: false,
                error: 'Failed to send support inbox email',
                details: error.message
            };
        }
    }

    /**
     * Send support reply email to customer
     * @param {object} params - Parameters object
     * @param {string} params.to - Recipient email
     * @param {string} params.name - Customer name
     * @param {string} params.replyMessage - Reply message
     * @param {string} params.subject - Original subject
     * @param {string} params.ticketId - Ticket ID
     * @returns {Promise<object>} Result object
     */
    async sendSupportReplyEmail({ to, name, replyMessage, subject, ticketId }) {
        try {
            const templateId = process.env.SENDGRID_SUPPORT_REPLY_TEMPLATE_ID || 'd-support_reply_template_id';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                reply_message: replyMessage,
                original_subject: subject,
                ticket_id: ticketId || 'N/A',
                support_url: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/support`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                `Re: ${subject} [${ticketId}]`,
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Support reply email error:', error);
            return {
                success: false,
                error: 'Failed to send support reply email',
                details: error.message
            };
        }
    }

    /**
     * Send composed email from support@peakmode.se
     * @param {object} params - Parameters object
     * @param {string[]} params.recipients - Array of recipient email addresses
     * @param {string} params.subject - Email subject
     * @param {string} params.message - Email message content (HTML or plain text)
     * @param {Array} params.attachments - Optional array of attachment objects with {name, url, mimeType, size}
     * @param {string[]} params.cc - Optional CC recipients
     * @param {string[]} params.bcc - Optional BCC recipients
     * @returns {Promise<object>} Result object
     */
    async sendComposedEmail({ recipients, subject, message, attachments = [], cc = [], bcc = [] }) {
        try {
            // Validate required fields
            if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
                return {
                    success: false,
                    error: 'At least one recipient is required'
                };
            }

            if (!subject || !subject.trim()) {
                return {
                    success: false,
                    error: 'Subject is required'
                };
            }

            if (!message || !message.trim()) {
                return {
                    success: false,
                    error: 'Message is required'
                };
            }

            // Validate email addresses
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const allEmails = [...recipients, ...cc, ...bcc];
            const invalidEmails = allEmails.filter(email => !emailRegex.test(email));
            
            if (invalidEmails.length > 0) {
                return {
                    success: false,
                    error: `Invalid email addresses: ${invalidEmails.join(', ')}`
                };
            }

            // Prepare email message
            const msg = {
                to: recipients,
                from: {
                    email: 'support@peakmode.se',
                    name: 'Peak Mode Support'
                },
                subject: subject.trim(),
                html: message.trim(),
                text: message.trim().replace(/<[^>]*>/g, ''), // Strip HTML for plain text version
            };

            // Add CC if provided
            if (cc && cc.length > 0) {
                msg.cc = cc;
            }

            // Add BCC if provided
            if (bcc && bcc.length > 0) {
                msg.bcc = bcc;
            }

            // Handle attachments from Cloudinary URLs
            if (attachments && attachments.length > 0) {
                const https = require('https');
                const http = require('http');
                
                msg.attachments = await Promise.all(
                    attachments.map(async (attachment) => {
                        try {
                            const url = attachment.url || attachment.path || attachment.secure_url;
                            if (!url) {
                                console.warn(`⚠️ Attachment missing URL:`, attachment);
                                return null;
                            }

                            // Download file from Cloudinary URL
                            const fileContent = await new Promise((resolve, reject) => {
                                const protocol = url.startsWith('https') ? https : http;
                                protocol.get(url, (response) => {
                                    if (response.statusCode !== 200) {
                                        reject(new Error(`Failed to download attachment: ${response.statusCode}`));
                                        return;
                                    }
                                    
                                    const chunks = [];
                                    response.on('data', (chunk) => chunks.push(chunk));
                                    response.on('end', () => resolve(Buffer.concat(chunks)));
                                    response.on('error', reject);
                                }).on('error', reject);
                            });

                            // Convert to base64
                            const base64Content = fileContent.toString('base64');
                            
                            return {
                                content: base64Content,
                                filename: attachment.name || attachment.filename || 'attachment',
                                type: attachment.mimeType || attachment.type || 'application/octet-stream',
                                disposition: 'attachment'
                            };
                        } catch (error) {
                            console.error(`❌ Error processing attachment ${attachment.name}:`, error);
                            // Continue without this attachment rather than failing the entire email
                            return null;
                        }
                    })
                );

                // Filter out null attachments (failed downloads)
                msg.attachments = msg.attachments.filter(Boolean);
            }

            // Send email via SendGrid
            const response = await sgMail.send(msg);

            console.log(`✅ Composed email sent successfully to ${recipients.join(', ')}`, {
                messageId: response[0]?.headers?.['x-message-id'],
                statusCode: response[0]?.statusCode,
                recipients: recipients.length,
                cc: cc.length,
                bcc: bcc.length,
                attachments: msg.attachments?.length || 0
            });

            return {
                success: true,
                message: 'Email sent successfully',
                messageId: response[0]?.headers?.['x-message-id'],
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ Composed email error:', error);
            const errorDetails = error.response?.body || error.message;
            
            return {
                success: false,
                error: 'Failed to send composed email',
                details: errorDetails
            };
        }
    }

    /**
     * Send waitlist confirmation email
     * @param {string} to - Recipient email address
     * @param {string} name - Customer name
     * @param {string} earlyAccessCode - Early access code (optional)
     * @returns {Promise<object>} Result object
     */
    async sendWaitlistConfirmationEmail(to, name, earlyAccessCode = null) {
        try {
            const templateId = process.env.SENDGRID_WAITLIST_CONFIRMATION_TEMPLATE_ID || 'd-0bc36f5c95dc4f0a9a864a6ca90eb23d';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                early_access_code: earlyAccessCode || '',
                has_early_access_code: !!earlyAccessCode,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                earlyAccessCode ? 'Welcome to Peak Mode — You Have Early Access!' : 'Welcome to Peak Mode Waitlist!',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Waitlist confirmation email error:', error);
            return {
                success: false,
                error: 'Failed to send waitlist confirmation email',
                details: error.message
            };
        }
    }

    /**
     * Send private early access notification email (admin-triggered)
     * @param {string} to - Recipient email address
     * @param {string} name - Customer name
     * @param {string} earlyAccessCode - Early access code (optional)
     * @returns {Promise<object>} Result object
     */
    async sendPrivateEarlyAccessNotificationEmail(to, name, earlyAccessCode = null) {
        try {
            const templateId = process.env.SENDGRID_PRIVATE_EARLY_ACCESS_TEMPLATE_ID || 'd-00dc888e24b34a95a38a575f3f5abace';
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                early_access_code: earlyAccessCode || '',
                has_early_access_code: !!earlyAccessCode,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            return await this.sendCustomEmail(
                to,
                'Private Early Access to Peak Mode',
                templateId,
                dynamicData
            );

        } catch (error) {
            console.error('❌ Private early access notification email error:', error);
            return {
                success: false,
                error: 'Failed to send private early access notification email',
                details: error.message
            };
        }
    }

    /**
     * Send order status update email notification
     * @param {object} order - Order object
     * @param {string} status - New order status
     * @returns {Promise<object>} Result object with success status
     */
    async sendOrderStatusUpdateEmail(order, status) {
        try {
            const templateId = process.env.SENDGRID_ORDER_STATUS_TEMPLATE_ID || 'd-17818c64b4e04e77b2c73a9df2544c77';
            
            // Get customer email
            const customerEmail = order.customer?.email || order.customerEmail || order.email;
            if (!customerEmail) {
                throw new Error('Order does not have a customer email address');
            }

            // Get status text using order status machine
            const { getStatusText } = require('../utils/orderStatusMachine');
            const statusText = getStatusText(status);

            // Get status message
            const statusMessage = this.getStatusMessage(status);

            // Generate tracking link if available
            const trackingLink = this.generateTrackingLink(order, status);

            // Format dates
            const formatDate = (date) => {
                if (!date) return null;
                try {
                    return new Date(date).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                    });
                } catch (e) {
                    return date;
                }
            };

            // Prepare template data
            const dynamicTemplateData = {
                customerName: order.customerName || 
                             order.customer?.name || 
                             `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() ||
                             'Valued Customer',
                orderId: order.orderId,
                orderDate: formatDate(order.orderDate || order.createdAt || order.date),
                currentStatus: status,
                statusText: statusText,
                statusMessage: statusMessage,
                trackingNumber: order.trackingNumber || null,
                shippingProvider: order.shippingProvider || null,
                estimatedDelivery: order.estimatedDelivery ? formatDate(order.estimatedDelivery) : null,
                trackingLink: trackingLink,
                orderItems: (order.items || []).map(item => ({
                    name: item.name || item.productName || 'Product',
                    quantity: item.quantity || 1,
                    price: item.price || 0,
                    image: item.image || item.media?.[0] || item.primaryMedia?.url || null
                })),
                orderTotal: order.total || 
                           order.totals?.total || 
                           ((order.subtotal || 0) + (order.shipping || 0)),
                shippingAddress: {
                    street: order.shippingAddress?.street || 
                           order.customer?.address || 
                           '',
                    postalCode: order.shippingAddress?.postalCode || 
                               order.customer?.postalCode || 
                               '',
                    city: order.shippingAddress?.city || 
                         order.customer?.city || 
                         '',
                    country: order.shippingAddress?.country || 
                            order.customer?.country || 
                            'Sweden'
                },
                supportEmail: 'support@peakmode.se',
                trackOrderLink: `https://peakmode.se/track-order?orderId=${order.orderId}`,
                websiteLink: 'https://peakmode.se'
            };

            console.log(`📧 [ORDER STATUS EMAIL] Sending status update email to ${customerEmail} for order ${order.orderId}, status: ${status}`);

            return await this.sendCustomEmail(
                customerEmail,
                `Order ${order.orderId} - ${statusText}`,
                templateId,
                dynamicTemplateData
            );

        } catch (error) {
            console.error('❌ Order status update email error:', error);
            return {
                success: false,
                error: 'Failed to send order status update email',
                details: error.message
            };
        }
    }

    /**
     * Get status-specific message for email
     * @param {string} status - Order status
     * @returns {string} Status message
     */
    getStatusMessage(status) {
        const messages = {
            'pending': 'Your order has been received and payment confirmed.',
            'processing': 'Your order is being prepared in our warehouse.',
            'packed': 'Your order is packed and ready to ship.',
            'shipped': 'Your order has been shipped! 🚀',
            'in_transit': 'Your order is in transit! 📦',
            'out_for_delivery': 'Your order is out for delivery! 🎉',
            'delivered': 'Your order has been delivered! ✅',
            'cancelled': 'Your order has been cancelled.'
        };
        return messages[status] || 'Your order status has been updated.';
    }

    /**
     * Generate tracking link based on shipping provider
     * @param {object} order - Order object
     * @param {string} status - Order status
     * @returns {string|null} Tracking URL or null
     */
    generateTrackingLink(order, status) {
        // Only generate tracking link for shipped/in_transit/out_for_delivery statuses
        if (!['shipped', 'in_transit', 'out_for_delivery'].includes(status)) {
            return null;
        }

        if (!order.trackingNumber || !order.shippingProvider) {
            return null;
        }

        const provider = String(order.shippingProvider).toLowerCase().trim();
        const tracking = String(order.trackingNumber).trim();

        const urls = {
            'postnord': `https://tracking.postnord.se/?shipment=${tracking}`,
            'dhl': `https://www.dhl.com/en/express/tracking.html?AWB=${tracking}`,
            'ups': `https://www.ups.com/track?tracknum=${tracking}`,
            'fedex': `https://www.fedex.com/fedextrack/?trknbr=${tracking}`,
            'bring': `https://sporing.bring.no/tracking.html?q=${tracking}`,
            'budbee': `https://track.budbee.com/${tracking}`,
            'airmee': `https://track.airmee.com/${tracking}`,
            'instabox': `https://track.instabox.se/${tracking}`
        };

        return urls[provider] || `https://peakmode.se/track-order?orderId=${order.orderId}`;
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

