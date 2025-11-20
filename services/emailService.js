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
            
            // Get currency symbol
            const currency = orderDetails.currency || 'EUR';
            const currencySymbols = {
                'EUR': '€',
                'SEK': 'kr',
                'DKK': 'kr',
                'PLN': 'zł',
                'CZK': 'Kč',
                'HUF': 'Ft',
                'BGN': 'лв',
                'RON': 'lei'
            };
            const currencySymbol = currencySymbols[currency] || currency;
            
            // Format order items properly
            const formattedItems = this.formatOrderItemsForEmail(orderDetails.items || []);
            
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
                order_items: formattedItems,
                shipping_address: this.formatAddressForEmail(orderDetails.shippingAddress),
                order_status_url: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/track-order?orderId=${orderDetails.orderId}`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear(),
                language: language // Include language in template data
            };

            const result = await this.sendCustomEmail(
                to,
                subject,
                templateId,
                dynamicData
            );

            // Log communication if email was sent successfully
            if (result.success) {
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
                review_url: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/review?orderId=${orderDetails.orderId}`,
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
     * Send review confirmation email
     * @param {string} to - Recipient email address
     * @param {string} name - Customer name
     * @param {object} reviewDetails - Review details
     * @returns {Promise<object>} Result object
     */
    async sendReviewConfirmationEmail(to, name, reviewDetails) {
        try {
            const templateId = process.env.SENDGRID_REVIEW_CONFIRMATION_TEMPLATE_ID || 'd-237146cecd3d4a49b89220fc58d2faa9';
            
            // Get product name if possible
            let productName = reviewDetails.productName || 'Product';
            if (reviewDetails.productId && reviewDetails.productId !== 'general') {
                try {
                    const VortexDB = require('../vornifydb/vornifydb');
                    const db = new VortexDB();
                    const productResult = await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'products',
                        command: '--read',
                        data: { id: reviewDetails.productId }
                    });
                    
                    if (productResult.success && productResult.data) {
                        productName = productResult.data.name || productName;
                    }
                } catch (error) {
                    console.error('Error fetching product name:', error);
                    // Continue with default product name
                }
            }
            
            const submissionDate = reviewDetails.submissionDate || new Date().toISOString().split('T')[0];
            const ratingStars = '⭐'.repeat(reviewDetails.rating || 0);
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                product_name: productName,
                rating: reviewDetails.rating || 0,
                rating_stars: ratingStars,
                review_source: this.formatReviewSource(reviewDetails.reviewSource || 'product_page'),
                verified_purchase: reviewDetails.verifiedPurchase ? 'Yes' : 'No',
                submission_date: submissionDate,
                moderation_status: 'Pending',
                expected_approval_time: '24-48 hours',
                support_email: 'support@peakmode.se',
                website_url: process.env.FRONTEND_URL || 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            const result = await this.sendCustomEmail(
                to,
                'Thank You for Your Review - Peak Mode',
                templateId,
                dynamicData
            );
            
            if (result.success) {
                // Log communication if customer exists
                await this.logCommunication(reviewDetails.customerEmail, {
                    type: 'email',
                    subject: 'Review Confirmation',
                    content: `Review confirmation email sent for ${productName}`,
                    status: 'sent',
                    adminNotes: `Review for product: ${productName}, Rating: ${reviewDetails.rating} stars`
                });
            }
            
            return result;

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
     * Helper to format review source for display
     * @param {string} source - Review source
     * @returns {string} Formatted source
     */
    formatReviewSource(source) {
        const sources = {
            'product_page': 'Product Page',
            'email_request': 'Email Request',
            'post_purchase': 'Post-Purchase',
            'manual': 'Manual Entry',
            'imported': 'Imported'
        };
        return sources[source] || source;
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
                reset_link: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/reset-password`,
                support_email: 'support@peakmode.se',
                website_url: 'https://peakmode.se',
                hub_login_url: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/hub/auth`,
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
     * @param {string} firstName - Customer's first name
     * @param {string} ticketId - Support ticket ID (optional)
     * @returns {Promise<object>} Result object
     */
    async sendSupportConfirmationEmail(to, firstName, ticketId = null) {
        try {
            const templateId = process.env.SENDGRID_SUPPORT_CONFIRMATION_TEMPLATE_ID || 'd-d237edcbc7284b7da88bdd9240858b59';
            
            const dynamicData = {
                firstName: firstName || 'Valued Customer',
                currentYear: new Date().getFullYear(),
                ticketId: ticketId || 'N/A',
                supportEmail: 'support@peakmode.se',
                websiteUrl: 'https://peakmode.se'
            };

            return await this.sendCustomEmail(
                to,
                'We Received Your Message - Peak Mode Support',
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
     * Send a reply email back to the customer
     * @param {object} params
     * @param {string} params.to - Customer email address
     * @param {string} params.name - Customer name
     * @param {string} params.replyMessage - Reply body
     * @param {string} [params.subject] - Original subject
     * @param {string} [params.ticketId] - Ticket identifier
     * @returns {Promise<object>}
     */
    async sendSupportReplyEmail({ to, name, replyMessage, subject, ticketId }) {
        try {
            if (!to) {
                throw new Error('Recipient email address is required for support replies');
            }

            if (!replyMessage) {
                throw new Error('Reply message content is required');
            }

            const templateId = process.env.SENDGRID_SUPPORT_REPLY_TEMPLATE_ID;
            const customerName = name || 'there';
            const safeSubject = subject || 'Response from Peak Mode Support';
            const replyBody = replyMessage;
            const ticket = ticketId || 'N/A';

            if (templateId) {
                const dynamicData = {
                    customerName,
                    replyMessage: replyBody,
                    subject: safeSubject,
                    ticketId: ticket,
                    supportEmail: this.fromEmail,
                    currentYear: new Date().getFullYear()
                };

                return await this.sendCustomEmail(
                    to,
                    'Response from Peak Mode Support',
                    templateId,
                    dynamicData
                );
            }

            const textContent = [
                `Hi ${customerName},`,
                '',
                'Thank you for contacting Peak Mode Support. Here is our response:',
                '',
                replyBody,
                '',
                `Ticket ID: ${ticket}`,
                '',
                'Best regards,',
                'Peak Mode Support Team'
            ].join('\n');

            const htmlContent = `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
                    <p>Hi ${customerName},</p>
                    <p>Thank you for contacting Peak Mode Support. Here is our response:</p>
                    <p>${this.escapeHtml(replyBody).replace(/\r?\n/g, '<br>')}</p>
                    <p><strong>Ticket ID:</strong> ${ticket}</p>
                    <p>Best regards,<br/>Peak Mode Support Team</p>
                </div>
            `;

            const msg = {
                to,
                from: {
                    email: this.fromEmail,
                    name: 'Peak Mode Support'
                },
                subject: safeSubject,
                text: textContent,
                html: htmlContent
            };

            await sgMail.send(msg);

            return {
                success: true,
                message: 'Support reply email sent successfully',
                timestamp: new Date().toISOString()
            };
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
     * Send support inbox notification email to Peak Mode support team
     * @param {object} params - Parameters for the email
     * @param {string} params.fromEmail - Email address of the user submitting the ticket
     * @param {string} [params.fromName] - Name of the user
     * @param {string} [params.subject] - Subject provided by the user
     * @param {string} params.message - Message body provided by the user
     * @param {string} [params.ticketId] - Generated ticket identifier
     * @returns {Promise<object>} Result object
     */
    async sendSupportInboxEmail({ fromEmail, fromName, subject, message, ticketId }) {
        try {
            if (!fromEmail) {
                throw new Error('fromEmail is required for support inbox emails');
            }

            if (!message) {
                throw new Error('message content is required for support inbox emails');
            }

            const cleanedFromEmail = fromEmail.trim();
            const safeSubject = subject && subject.trim() !== '' ? subject.trim() : 'New Support Message';
            const customerName = fromName && fromName.trim() !== '' ? fromName.trim() : 'Peak Mode Customer';
            const supportTicketId = ticketId || `SPT-${Date.now()}`;

            const textContent = [
                `New support request from ${customerName} (${cleanedFromEmail}).`,
                '',
                `Subject: ${safeSubject}`,
                `Ticket ID: ${supportTicketId}`,
                '',
                'Message:',
                message
            ].join('\n');

            const sanitizedMessage = this.escapeHtml(message);
            const formattedMessage = sanitizedMessage.replace(/\r?\n/g, '<br>');

            const htmlContent = `
                <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #222;">
                    <p><strong>New support request received.</strong></p>
                    <p>
                        <strong>From:</strong> ${customerName} &lt;${cleanedFromEmail}&gt;<br>
                        <strong>Ticket ID:</strong> ${supportTicketId}<br>
                        <strong>Subject:</strong> ${safeSubject}
                    </p>
                    <p>${formattedMessage}</p>
                </div>
            `;

            const msg = {
                to: this.supportInboxEmail,
                from: {
                    email: this.supportInboxEmail,
                    name: this.supportSenderName
                },
                replyTo: cleanedFromEmail,
                subject: `[Support] ${safeSubject}`,
                text: textContent,
                html: htmlContent,
                headers: {
                    'X-Original-From': cleanedFromEmail,
                    'X-Support-TicketId': supportTicketId
                }
            };

            if (this.adminNotificationEmail && this.adminNotificationEmail !== this.supportInboxEmail) {
                msg.cc = this.adminNotificationEmail;
            }

            const response = await sgMail.send(msg);

            console.log(`✅ Support inbox email forwarded to ${this.supportInboxEmail} from ${cleanedFromEmail}`);

            return {
                success: true,
                message: 'Support inbox email sent successfully',
                messageId: response[0].headers['x-message-id'],
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ Support inbox email error:', error.response?.body || error.message);

            return {
                success: false,
                error: 'Failed to send support inbox email',
                details: error.response?.body?.errors || error.message
            };
        }
    }

    /**
     * Send support reply email from admin to customer
     * @param {object} params - Parameters for the email
     * @param {string} params.to - Customer email address
     * @param {string} [params.name] - Customer name for greeting
     * @param {string} params.replyMessage - Admin reply content
     * @param {string} [params.subject] - Original subject provided by user
     * @param {string} [params.ticketId] - Support ticket identifier
     * @returns {Promise<object>} Result object
     */
    async sendSupportReplyEmail({ to, name, replyMessage, subject, ticketId }) {
        try {
            if (!to) {
                throw new Error('Recipient email address is required for support reply emails');
            }

            if (!replyMessage) {
                throw new Error('replyMessage is required for support reply emails');
            }

            const cleanedRecipient = to.trim();
            const customerName = name && name.trim() !== '' ? name.trim() : 'Peak Mode Customer';
            const baseSubject = subject && subject.trim() !== '' ? subject.trim() : 'Peak Mode Support';
            const compiledSubject = baseSubject.toLowerCase().startsWith('re:')
                ? baseSubject
                : `Re: ${baseSubject}`;
            const supportTicketId = ticketId || `SPT-${Date.now()}`;

            const textContent = [
                `Hi ${customerName},`,
                '',
                replyMessage,
                '',
                '---',
                'Peak Mode Support',
                'support@peakmode.se',
                `Ticket ID: ${supportTicketId}`
            ].join('\n');

            const sanitizedMessage = this.escapeHtml(replyMessage);
            const formattedMessage = sanitizedMessage.replace(/\r?\n/g, '<br>');

            const htmlContent = `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2933;">
                    <p>Hi ${this.escapeHtml(customerName)},</p>
                    <p>${formattedMessage}</p>
                    <hr style="margin: 24px 0; border: 0; border-top: 1px solid #e2e8f0;">
                    <p style="margin-bottom: 4px;"><strong>Peak Mode Support</strong></p>
                    <p style="margin: 0;">
                        <a href="mailto:support@peakmode.se" style="color: #2563eb;">support@peakmode.se</a><br>
                        Ticket ID: ${this.escapeHtml(supportTicketId)}
                    </p>
                </div>
            `;

            const msg = {
                to: cleanedRecipient,
                from: {
                    email: this.supportInboxEmail,
                    name: this.supportSenderName || 'Peak Mode Support'
                },
                replyTo: this.supportInboxEmail,
                subject: compiledSubject,
                text: textContent,
                html: htmlContent,
                headers: {
                    'X-Support-TicketId': supportTicketId
                }
            };

            const response = await sgMail.send(msg);

            console.log(`✅ Support reply email sent to ${cleanedRecipient} for ticket ${supportTicketId}`);

            return {
                success: true,
                message: 'Support reply email sent successfully',
                messageId: response[0].headers['x-message-id'],
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ Support reply email error:', error.response?.body || error.message);

            return {
                success: false,
                error: 'Failed to send support reply email',
                details: error.response?.body?.errors || error.message
            };
        }
    }

    /**
     * Basic HTML escaping helper
     * @param {string} value - Raw string to escape
     * @returns {string} Escaped string safe for HTML rendering
     */
    escapeHtml(value) {
        if (typeof value !== 'string') {
            return '';
        }

        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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
     * Helper method to format address for email templates (HTML-safe)
     * @param {object} address - Address object
     * @returns {string} Formatted address string with proper HTML breaks
     */
    formatAddressForEmail(address) {
        if (!address) return 'No address provided';
        
        const name = address.name || '';
        const street = address.street || '';
        const postalCode = address.postalCode || '';
        const city = address.city || '';
        const country = address.country || '';
        
        return `${name}<br>${street}<br>${postalCode} ${city}<br>${country}`;
    }

    /**
     * Helper method to format order items for email templates
     * @param {array} items - Order items array
     * @returns {string} Formatted items HTML
     */
    formatOrderItemsForEmail(items) {
        if (!items || !Array.isArray(items)) return '<p>No items found</p>';
        
        let itemsHtml = '';
        items.forEach(item => {
            const variant = '';
            if (item.size && item.color) {
                variant = ` (${item.color}, ${item.size})`;
            } else if (item.size) {
                variant = ` (${item.size})`;
            } else if (item.color) {
                variant = ` (${item.color})`;
            }
            
            const itemTotal = item.price * item.quantity;
            
            itemsHtml += `
                <div class="item" style="margin-bottom: 10px; padding: 10px; border-bottom: 1px solid #eee;">
                    <div class="item-name" style="font-weight: bold;">${item.name}${variant}</div>
                    <div class="item-details" style="color: #666;">
                        Quantity: ${item.quantity} × ${item.price} SEK = ${itemTotal} SEK
                    </div>
                </div>
            `;
        });
        
        return itemsHtml;
    }

    /**
     * Log communication to customer record
     * @param {string} customerEmail - Customer email
     * @param {object} communicationData - Communication data
     * @returns {Promise<void>}
     */
    async logCommunication(customerEmail, communicationData) {
        try {
            const VortexDB = require('../vornifydb/vornifydb');
            const db = new VortexDB();

            // Get current customer
            const customerResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'customers',
                command: '--read',
                data: { email: customerEmail }
            });

            if (customerResult.success && customerResult.data) {
                const customer = customerResult.data;
                
                // Create communication log entry
                const communicationEntry = {
                    id: `comm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: communicationData.type,
                    subject: communicationData.subject,
                    content: communicationData.content || '',
                    date: new Date().toISOString(),
                    status: communicationData.status || 'sent',
                    adminNotes: communicationData.adminNotes || ''
                };

                // Add to communication log
                const updatedCommunicationLog = [...(customer.communicationLog || []), communicationEntry];

                // Update customer
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'customers',
                    command: '--update',
                    data: {
                        filter: { email: customerEmail },
                        update: {
                            communicationLog: updatedCommunicationLog,
                            updatedAt: new Date().toISOString()
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Error logging communication:', error);
            // Don't throw error - communication logging shouldn't break email sending
        }
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

