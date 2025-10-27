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
            
            // Calculate correct total from multiple possible sources
            const orderTotal = orderDetails.totals?.total || 
                              orderDetails.total || 
                              (orderDetails.items ? orderDetails.items.reduce((sum, item) => sum + (item.price * item.quantity), 0) : 0);
            
            // Format order items properly
            const formattedItems = this.formatOrderItemsForEmail(orderDetails.items || []);
            
            const dynamicData = {
                customer_name: name || 'Valued Customer',
                order_number: orderDetails.orderId || 'N/A',
                order_date: orderDetails.orderDate || orderDetails.createdAt || new Date().toISOString(),
                order_total: `${orderTotal} SEK`,
                order_items: formattedItems,
                shipping_address: this.formatAddressForEmail(orderDetails.shippingAddress),
                order_status_url: `${process.env.FRONTEND_URL || 'https://peakmode.se'}/track-order?orderId=${orderDetails.orderId}`,
                website_url: 'https://peakmode.se',
                year: new Date().getFullYear()
            };

            const result = await this.sendCustomEmail(
                to,
                `Order Confirmation - ${orderDetails.orderId}`,
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

