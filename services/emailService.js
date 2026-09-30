/**
 * Compatibility/domain facade — delivery is owned by communications/ + email/ provider.
 * Do not add SendGrid or provider logic here.
 */
require('dotenv').config();
const crypto = require('crypto');
const { normalizeAuthLink } = require('../lib/authMailLinks');
const { scheduleEmailCommunication } = require('../communications/emailBridge');
const { buildOrderStatusUrl, buildBrandUrls } = require('../email/emailUrls');

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildPasswordResetEmailBodies(resetLink, expiryHours = 1) {
    const href = escapeHtml(resetLink);
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;color:#111;background:#f7f7f7;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 24px;">
    <p style="margin:0 0 16px;">Hello,</p>
    <p style="margin:0 0 20px;">We received a request to reset your Peak Mode account password. This link expires in ${expiryHours} hour.</p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#000;color:#ffffff !important;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">Reset password</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#555;">If the button does not work, open this link in your browser:</p>
    <p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#111;">${href}</a></p>
    <p style="margin:0;font-size:13px;color:#777;">If you did not request a password reset, you can ignore this email.</p>
    <p style="margin:24px 0 0;">— Peak Mode</p>
  </div>
</body>
</html>`;
    const text = [
        'Hello,',
        '',
        `Reset your Peak Mode password (expires in ${expiryHours} hour):`,
        '',
        resetLink,
        '',
        'If you did not request this, ignore this email.',
        '',
        '— Peak Mode',
    ].join('\n');
    return { html, text };
}

/** Prefer Hub-specific Render env names, then legacy SENDGRID_* keys. */
function resolveTemplateId(envKeys, legacyKey, fallback) {
    const keys = Array.isArray(envKeys) ? envKeys : [envKeys];
    for (const key of keys) {
        const value = process.env[key];
        if (value && String(value).trim()) {
            return String(value).trim();
        }
    }
    const legacy = process.env[legacyKey];
    if (legacy && String(legacy).trim()) {
        return String(legacy).trim();
    }
    return fallback;
}

const {
    getHubAuthTemplateIds: getHubAuthTemplateIdsFromLib,
    listHubTemplateConfiguration,
} = require('../lib/hubAuthTemplates');

function hubAccountEmail() {
    return require('./hub/hubAccountEmailService');
}

function getHubAuthTemplateIds() {
    return getHubAuthTemplateIdsFromLib();
}

class EmailService {
    constructor() {
        this.fromEmail = (process.env.EMAIL_FROM || 'support@peakmode.se').trim();
        this.supportInboxEmail = process.env.SUPPORT_INBOX_EMAIL || 'support@peakmode.se';
        this.supportSenderName = process.env.SUPPORT_INBOX_NAME || 'Peak Mode Support';
        this.adminNotificationEmail = process.env.ADMIN_EMAIL || process.env.ADMIN_SUPPORT_EMAIL || null;
    }

    _schedule(communicationType, recipient, payload, options = {}) {
        return scheduleEmailCommunication({
            communicationType,
            recipient,
            payload,
            ...options,
        });
    }

    /** @deprecated Arbitrary template sends are disabled — use domain methods → orchestrator. */
    async sendCustomEmail() {
        return {
            success: false,
            error: 'DEPRECATED_SEND_PATH',
            details: 'Direct templateId sending is disabled. Use domain communication methods.',
        };
    }

    async sendTransactionalHtmlEmail(to, subject, html, text, options = {}) {
        const contentKey = crypto
            .createHash('sha256')
            .update(`${to}|${subject}|${html}|${text}`)
            .digest('hex')
            .slice(0, 16);
        return this._schedule(
            'SUPPORT_COMPOSED',
            to,
            {
                customer_name: 'Customer',
                html,
                text,
            },
            {
                idempotencyKey: options.idempotencyKey || `html-fallback:${String(to).toLowerCase()}:${contentKey}`,
            },
        );
    }

    async sendHubDynamicTemplateEmail() {
        return {
            success: false,
            error: 'DEPRECATED_SEND_PATH',
            details: 'Use hubAccountEmailService → communicationOrchestrator.',
        };
    }

    async verifyConnection() {
        try {
            const { verifyConfiguration } = require('../email/sendgridProvider');
            return verifyConfiguration();
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
            return this._schedule(
                'HUB_WELCOME_REGISTRATION',
                to,
                { customer_name: name || 'Valued Customer' },
                { idempotencyKey: `shop-welcome:${String(to).toLowerCase()}` },
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            const { buildOrderStatusUrl } = require('../email/emailUrls');

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
            
            const orderId = orderDetails.orderId || orderDetails.id || 'N/A';
            const orderStatusUrl = buildOrderStatusUrl({ orderId });

            const payload = {
                customer_name: name || 'Valued Customer',
                order_number: orderId,
                order_date: orderDetails.orderDate || orderDetails.createdAt || new Date().toISOString(),
                order_total: `${orderTotal} ${currencySymbol}`,
                order_currency: currency,
                order_currency_symbol: currencyFormat.symbol,
                order_items: formattedItems,
                order_items_count: formattedItems.length,
                shipping_address: formattedAddress,
                order_status_url: orderStatusUrl,
                language,
            };

            const result = await scheduleEmailCommunication({
                communicationType: 'ORDER_CONFIRMATION',
                recipient: to,
                payload,
                idempotencyKey: orderId && orderId !== 'N/A' ? `order-confirmation:${orderId}` : undefined,
                correlationId: orderId !== 'N/A' ? String(orderId) : null,
                processImmediately: true,
            });

            const legacyResult = {
                success: Boolean(result.providerAccepted || result.success),
                providerAccepted: result.providerAccepted,
                status: result.status,
                emailId: result.emailId,
                duplicate: result.duplicate,
                error: result.error,
                details: result.error || result.details,
            };

            if (legacyResult.success && orderDetails.customer?.email) {
                await this.logCommunication(orderDetails.customer.email, {
                    type: 'email',
                    subject: `Order Confirmation - ${orderId}`,
                    content: 'Order confirmation email queued/sent',
                    status: result.status || 'ACCEPTED',
                });
            }

            return legacyResult;

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
     * Send order receipt PDF as attachment (after order confirmation).
     * @param {string} to - Customer email
     * @param {string} name - Customer display name
     * @param {object} order - Order document (must include orderId, totals, invoiceNumber if assigned)
     * @param {string} language - 'en' | 'sv'
     * @param {Buffer} pdfBuffer - PDF bytes
     * @param {string} filename - Attachment filename
     */
    async sendOrderReceiptEmail(to, name, order, language, pdfBuffer, filename) {
        try {
            if (!to || !pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
                return { success: false, error: 'Recipient and PDF buffer are required' };
            }
            const lang = (language || 'en').toLowerCase().startsWith('sv') ? 'sv' : 'en';
            const orderId = order.orderId || 'order';
            const bodies = {
                en: `<p>Hello ${name || 'customer'},</p><p>Thank you for your purchase. Your <strong>PDF receipt</strong> is attached.</p><p>Order: <strong>${orderId}</strong></p>`,
                sv: `<p>Hej ${name || 'kund'},</p><p>Tack för ditt köp. Ditt <strong>PDF-kvitto</strong> är bifogat.</p><p>Order: <strong>${orderId}</strong></p>`,
            };
            return this._schedule(
                'ORDER_RECEIPT',
                to,
                {
                    customer_name: name || 'customer',
                    order_number: orderId,
                    language: lang,
                    html: bodies[lang],
                    attachments: [{
                        contentBase64: pdfBuffer.toString('base64'),
                        filename: filename || `Receipt-${orderId}.pdf`,
                        type: 'application/pdf',
                    }],
                },
                {
                    idempotencyKey: `order-receipt:${orderId}`,
                    correlationId: orderId,
                },
            );
        } catch (error) {
            console.error('❌ Order receipt email error:', error);
            return {
                success: false,
                error: error.message || 'Failed to send receipt email',
                details: error.message,
            };
        }
    }

    /**
     * Send order receipt email WITHOUT PDF attachment (fallback when PDF generation fails).
     */
    async sendOrderReceiptEmailNoAttachment(to, name, order, language) {
        try {
            if (!to) return { success: false, error: 'Recipient is required' };
            const lang = (language || 'en').toLowerCase().startsWith('sv') ? 'sv' : 'en';
            const orderId = order.orderId || 'order';
            const bodies = {
                en: `<p>Hello ${name || 'customer'},</p><p>Your order is confirmed. PDF receipt generation failed temporarily — contact support if you need the PDF.</p><p>Order: <strong>${orderId}</strong></p>`,
                sv: `<p>Hej ${name || 'kund'},</p><p>Din order är bekräftad. PDF-kvitto kunde inte skapas just nu — kontakta support om du behöver PDF.</p><p>Order: <strong>${orderId}</strong></p>`,
            };
            return this._schedule(
                'ORDER_RECEIPT_FALLBACK',
                to,
                {
                    customer_name: name || 'customer',
                    order_number: orderId,
                    language: lang,
                    html: bodies[lang],
                },
                {
                    idempotencyKey: `order-receipt-fallback:${orderId}`,
                    correlationId: orderId,
                },
            );
        } catch (error) {
            console.error('❌ Order receipt fallback email error:', error);
            return { success: false, error: error.message || 'Failed to send receipt email' };
        }
    }

    /**
     * Send password reset email
     * @param {string} to - Recipient email address
     * @param {string} resetLink - Password reset link
     * @returns {Promise<object>} Result object
     */
    async sendPasswordResetEmail(to, resetLink) {
        const link = normalizeAuthLink(resetLink);
        return hubAccountEmail().sendPasswordResetEmail(to, link);
    }

    /**
     * Send order processing email
     * @param {string} to - Recipient email address
     * @param {object} orderDetails - Order details
     * @returns {Promise<object>} Result object
     */
    async sendOrderProcessingEmail(to, orderDetails) {
        try {
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            const orderCurrency = (orderDetails.currency || orderDetails.baseCurrency || 'SEK').toUpperCase();
            const formattedItems = this.formatOrderItemsForEmail(orderDetails.items || [], orderCurrency);
            const formattedAddress = this.formatAddressForEmail(orderDetails.shippingAddress || orderDetails.customer);
            const orderId = orderDetails.orderId;
            return scheduleEmailCommunication({
                communicationType: 'ORDER_PROCESSING',
                recipient: to,
                payload: {
                    customer_name: orderDetails.customer?.name || 'Valued Customer',
                    order_number: orderId,
                    order_items: formattedItems,
                    order_items_count: formattedItems.length,
                    order_total: `${orderDetails.totals?.total || 0} ${orderCurrency}`,
                    shipping_address: formattedAddress,
                },
                idempotencyKey: orderId ? `order-processing:${orderId}` : undefined,
                correlationId: orderId,
            });
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            const { buildOrderStatusUrl } = require('../email/emailUrls');
            const orderCurrency = (orderDetails.currency || orderDetails.baseCurrency || 'SEK').toUpperCase();
            const formattedItems = this.formatOrderItemsForEmail(orderDetails.items || [], orderCurrency);
            const formattedAddress = this.formatAddressForEmail(orderDetails.shippingAddress || orderDetails.customer);
            const orderId = orderDetails.orderId;
            const trackingUrl = orderDetails.trackingUrl || buildOrderStatusUrl({ orderId });
            return scheduleEmailCommunication({
                communicationType: 'SHIPMENT_DISPATCHED',
                recipient: to,
                payload: {
                    customer_name: orderDetails.customer?.name || 'Valued Customer',
                    order_number: orderId,
                    tracking_number: orderDetails.trackingNumber || 'N/A',
                    tracking_url: trackingUrl,
                    order_items: formattedItems,
                    order_items_count: formattedItems.length,
                    shipping_address: formattedAddress,
                },
                idempotencyKey: orderId ? `shipment-dispatched:${orderId}` : undefined,
                correlationId: orderId,
            });
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            const orderCurrency = (orderDetails.currency || orderDetails.baseCurrency || 'SEK').toUpperCase();
            const formattedItems = this.formatOrderItemsForEmail(orderDetails.items || [], orderCurrency);
            const formattedAddress = this.formatAddressForEmail(orderDetails.shippingAddress || orderDetails.customer);
            const orderId = orderDetails.orderId;
            return scheduleEmailCommunication({
                communicationType: 'SHIPMENT_DELIVERED',
                recipient: to,
                payload: {
                    customer_name: orderDetails.customer?.name || 'Valued Customer',
                    order_number: orderId,
                    order_items: formattedItems,
                    order_items_count: formattedItems.length,
                    shipping_address: formattedAddress,
                },
                idempotencyKey: orderId ? `shipment-delivered:${orderId}` : undefined,
                correlationId: orderId,
            });
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            const { buildReviewUrl } = require('../email/emailUrls');
            const orderId = orderDetails.orderId;
            return scheduleEmailCommunication({
                communicationType: 'REVIEW_REQUEST',
                recipient: to,
                payload: {
                    customer_name: orderDetails.customer?.name || 'Valued Customer',
                    order_number: orderId,
                    review_url: buildReviewUrl({ orderId }),
                },
                idempotencyKey: orderId ? `review-request:${orderId}` : undefined,
                correlationId: orderId,
            });
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            return scheduleEmailCommunication({
                communicationType: 'NEWSLETTER_WELCOME',
                recipient: to,
                payload: {
                    customer_name: name || 'Peak Mode Member',
                    discount_code: discountCode,
                },
                idempotencyKey: `newsletter-welcome:${String(to).toLowerCase()}`,
                context: { marketingConsent: true },
            });
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
            return this._schedule(
                'DISCOUNT_REMINDER',
                to,
                { customer_name: name || 'Peak Mode Member', discount_code: discountCode },
                {
                    idempotencyKey: `discount-reminder:${String(to).toLowerCase()}`,
                    context: { marketingConsent: true },
                },
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
        return hubAccountEmail().sendHubWelcomePostVerifyEmail(
            to,
            name,
            hubUrl || `${process.env.FRONTEND_URL || 'https://peakmode.se'}/hub/dashboard`,
        );
    }

    /**
     * Send email verification email
     * @param {string} to - Recipient email address
     * @param {string} name - User name
     * @param {string} verificationLink - Email verification link
     * @returns {Promise<object>} Result object
     */
    async sendEmailVerificationEmail(to, name, verificationLink) {
        return hubAccountEmail().sendEmailVerificationEmail(to, name, verificationLink);
    }

    /**
     * Send password reset success confirmation
     * @param {string} to - Recipient email address
     * @param {string} name - User name
     * @returns {Promise<object>} Result object
     */
    async sendPasswordResetSuccessEmail(to, name) {
        return hubAccountEmail().sendPasswordResetSuccessEmail(to, name);
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            const tid = ticketId || 'N/A';
            return scheduleEmailCommunication({
                communicationType: 'SUPPORT_CONFIRMATION',
                recipient: to,
                payload: {
                    customer_name: firstName || 'Valued Customer',
                    ticket_id: tid,
                },
                idempotencyKey: tid !== 'N/A' ? `support-confirmation:${tid}` : undefined,
                correlationId: tid,
            });
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            return scheduleEmailCommunication({
                communicationType: 'DROPS_CONFIRMATION',
                recipient: to,
                payload: { customer_name: name || 'Peak Mode Member' },
                idempotencyKey: `drops-confirm:${String(to).toLowerCase()}`,
                context: { marketingConsent: true },
            });
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
            return this._schedule(
                'DISCOUNT_CODE_UPDATE',
                to,
                { customer_name: name || 'Peak Mode Member', discount_code: discountCode },
                {
                    idempotencyKey: `discount-update:${String(to).toLowerCase()}:${discountCode}`,
                    context: { marketingConsent: true },
                },
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
            return this._schedule(
                'DISCOUNT_EXPIRED',
                to,
                { customer_name: name || 'Peak Mode Member' },
                {
                    idempotencyKey: `discount-expired:${String(to).toLowerCase()}`,
                    context: { marketingConsent: true },
                },
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            return scheduleEmailCommunication({
                communicationType: 'NEWSLETTER_CONFIRMATION',
                recipient: to,
                payload: { customer_name: name || 'Peak Mode Member' },
                idempotencyKey: `newsletter-confirm:${String(to).toLowerCase()}`,
                context: { marketingConsent: true },
            });
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            return scheduleEmailCommunication({
                communicationType: 'MARKETING_CONFIRMATION',
                recipient: to,
                payload: { customer_name: name || 'Peak Mode Member' },
                idempotencyKey: `marketing-confirm:${String(to).toLowerCase()}`,
                context: { marketingConsent: true },
            });
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            const { buildCheckoutUrl } = require('../email/emailUrls');
            const orderId = orderNumber || 'N/A';
            return scheduleEmailCommunication({
                communicationType: 'PAYMENT_FAILED',
                recipient: to,
                payload: {
                    customer_name: name || 'Valued Customer',
                    order_number: orderId,
                    retry_url: retryUrl || buildCheckoutUrl({}),
                },
                idempotencyKey: orderId !== 'N/A' ? `payment-failed:${orderId}` : undefined,
                correlationId: orderId,
            });
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
            const { scheduleEmailCommunication } = require('../communications/emailBridge');
            const { buildCartUrl } = require('../email/emailUrls');
            const formattedItems = this.formatOrderItemsForEmail(items || [], 'SEK');
            const typeKey = emailType === 'second' ? 'ABANDONED_CART_REMINDER' : 'ABANDONED_CART';
            const cartLink = cartUrl || buildCartUrl({});
            return scheduleEmailCommunication({
                communicationType: typeKey,
                recipient: to,
                payload: {
                    customer_name: name || 'Valued Customer',
                    cart_items: formattedItems,
                    cart_items_count: formattedItems.length,
                    cart_total: `${total || 0} SEK`,
                    cart_url: cartLink,
                },
                idempotencyKey: `${typeKey.toLowerCase()}:${String(to).toLowerCase()}`,
                context: { marketingConsent: true },
            });
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
            return this._schedule(
                'REVIEW_CONFIRMATION',
                to,
                {
                    customer_name: name || 'Valued Customer',
                    product_name: reviewDetails.productName || 'Your Purchase',
                    rating: reviewDetails.rating || 5,
                    product_id: reviewDetails.productId,
                },
                { idempotencyKey: `review-confirm:${reviewDetails.productId}:${String(to).toLowerCase()}` },
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
            const toEmail = this.supportInboxEmail || this.adminNotificationEmail || 'support@peakmode.se';
            const tid = ticketId || 'N/A';
            return this._schedule(
                'SUPPORT_INBOX',
                toEmail,
                {
                    customer_name: fromName || 'Customer',
                    customer_email: fromEmail,
                    subject,
                    message,
                    ticket_id: tid,
                },
                {
                    idempotencyKey: tid !== 'N/A' ? `support-inbox:${tid}` : undefined,
                    correlationId: tid,
                },
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
    async sendSupportReplyEmail({ to, name, replyMessage, subject, ticketId, messageId }) {
        try {
            const tid = ticketId || 'N/A';
            const replyKey = messageId || crypto
                .createHash('sha256')
                .update(`${tid}|${replyMessage}|${subject}`)
                .digest('hex')
                .slice(0, 16);
            return this._schedule(
                'SUPPORT_REPLY',
                to,
                {
                    customer_name: name || 'Valued Customer',
                    reply_message: replyMessage,
                    original_subject: subject,
                    ticket_id: tid,
                },
                {
                    idempotencyKey: `support-reply:${tid}:${replyKey}`,
                    correlationId: tid,
                },
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

            const primary = recipients[0];
            const attachmentUrls = (attachments || []).map((a) => ({
                url: a.url || a.secure_url || a.path,
                name: a.name || a.filename,
                mimeType: a.mimeType || a.type,
            })).filter((a) => a.url);

            const composedKey = crypto
                .createHash('sha256')
                .update(`${primary}|${subject}|${message}|${recipients.join(',')}`)
                .digest('hex')
                .slice(0, 16);
            return this._schedule(
                'SUPPORT_COMPOSED',
                primary,
                {
                    customer_name: 'Peak Mode Support',
                    html: message.trim(),
                    text: message.trim().replace(/<[^>]*>/g, ''),
                    recipients,
                    cc,
                    bcc,
                    attachmentUrls,
                    composed_subject: subject.trim(),
                },
                {
                    idempotencyKey: `support-composed:${primary}:${composedKey}`,
                },
            );
        } catch (error) {
            console.error('❌ Composed email error:', error);
            return {
                success: false,
                error: 'Failed to send composed email',
                details: error.message,
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
            return this._schedule(
                'WAITLIST_CONFIRMATION',
                to,
                {
                    customer_name: name || 'Valued Customer',
                    early_access_code: earlyAccessCode || '',
                    has_early_access_code: !!earlyAccessCode,
                },
                {
                    idempotencyKey: `waitlist:${String(to).toLowerCase()}`,
                    context: { marketingConsent: true },
                },
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
            return this._schedule(
                'PRIVATE_EARLY_ACCESS',
                to,
                {
                    customer_name: name || 'Valued Customer',
                    early_access_code: earlyAccessCode || '',
                    has_early_access_code: !!earlyAccessCode,
                },
                {
                    idempotencyKey: `early-access:${String(to).toLowerCase()}:${earlyAccessCode || 'none'}`,
                    context: { marketingConsent: true },
                },
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

            const brand = buildBrandUrls();
            const trackOrderUrl = buildOrderStatusUrl({ orderId: order.orderId });
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
                supportEmail: brand.support_email,
                trackOrderLink: trackOrderUrl,
                websiteLink: brand.website_url,
            };
            return this._schedule(
                'ORDER_STATUS_UPDATE',
                customerEmail,
                {
                    customer_name: dynamicTemplateData.customerName,
                    order_number: order.orderId,
                    track_order_url: trackOrderUrl,
                    current_status: status,
                    status_text: statusText,
                    status_message: statusMessage,
                    ...dynamicTemplateData,
                },
                {
                    idempotencyKey: `order-status:${order.orderId}:${status}`,
                    correlationId: order.orderId,
                },
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

        return urls[provider] || buildOrderStatusUrl({ orderId: order.orderId });
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

    // --- Admin Invite Email Notifications (SendGrid dynamic templates) ---

    /** Template ID: email to invited admin when invite is created */
    async sendAdminInviteEmail(to, data) {
        const result = await this._schedule(
            'ADMIN_INVITE',
            to,
            {
                customer_name: data.admin_name || data.admin_email || to,
                admin_name: data.admin_name || '',
                admin_email: data.admin_email || to,
                invited_by: data.invited_by || 'Peak Mode',
                invite_link: data.invite_link || '',
                expiry_hours: data.expiry_hours != null ? data.expiry_hours : 24,
            },
            { idempotencyKey: `admin-invite:${String(to).toLowerCase()}:${data.invite_link || ''}` },
        );
        if (!result.success) {
            console.error('❌ [ADMIN INVITE EMAIL] Failed to send to invited admin:', to, result.error);
        }
        return result;
    }

    /**
     * 2. Super Admin Notification – to the super admin who sent the invite (after invite created)
     * @param {string} to - Super admin email
     * @param {object} data - { admin_name, admin_email, invite_link, year }
     */
    async sendSuperAdminInviteNotification(to, data) {
        const result = await this._schedule(
            'ADMIN_SUPER_INVITE_NOTIFY',
            to,
            {
                admin_name: data.admin_name || '',
                admin_email: data.admin_email || '',
                invite_link: data.invite_link || '',
            },
            { idempotencyKey: `admin-invite-notify:${data.admin_email || to}` },
        );
        if (!result.success) {
            console.error('❌ [ADMIN INVITE EMAIL] Failed to send super admin notification:', to, result.error);
        }
        return result;
    }

    /**
     * 3. Admin Account Activated – to the activated admin and to the super admin (after accept-invite succeeds)
     * @param {string} to - Recipient email (admin or super admin)
     * @param {object} data - { admin_name, admin_email, activated_at, year }
     */
    async sendAdminActivatedEmail(to, data) {
        const result = await this._schedule(
            'ADMIN_ACTIVATED',
            to,
            {
                admin_name: data.admin_name || '',
                admin_email: data.admin_email || '',
                activated_at: data.activated_at || new Date().toISOString(),
            },
            { idempotencyKey: `admin-activated:${data.admin_email || to}` },
        );
        if (!result.success) {
            console.error('❌ [ADMIN INVITE EMAIL] Failed to send activation notification:', to, result.error);
        }
        return result;
    }

    /**
     * 4. Set Password (Admin) – sent when admin requests password reset (forgot-password)
     * @param {string} to - Admin email
     * @param {object} data - { reset_link, admin_email, admin_name?, expiry_hours?, year }
     */
    async sendSetPasswordAdminEmail(to, data) {
        const link = normalizeAuthLink(data.reset_link || '');
        const result = await this._schedule(
            'ADMIN_SET_PASSWORD',
            to,
            {
                reset_link: link,
                admin_email: data.admin_email || to,
                admin_name: data.admin_name || '',
                expiry_hours: data.expiry_hours != null ? data.expiry_hours : 1,
            },
            { idempotencyKey: `admin-set-password:${to}:${link.slice(-12)}` },
        );
        if (!result.success) {
            console.error('❌ [SET PASSWORD ADMIN] Failed to send reset link:', to, result.error);
        }
        return result;
    }

    /**
     * 5. Password Set Successfully (admin) – sent after password is reset
     * @param {string} to - Admin email
     * @param {object} data - { admin_email, admin_name?, login_url?, year }
     */
    async sendPasswordSetSuccessfullyAdminEmail(to, data) {
        const result = await this._schedule(
            'ADMIN_PASSWORD_SET_SUCCESS',
            to,
            {
                admin_email: data.admin_email || to,
                admin_name: data.admin_name || '',
                login_url: data.login_url || '',
            },
            {
                idempotencyKey: `admin-password-set-ok:${to}:${data.resetEventId || 'unknown'}`,
            },
        );
        if (!result.success) {
            console.error('❌ [PASSWORD SET SUCCESS ADMIN] Failed to send confirmation:', to, result.error);
        }
        return result;
    }
}

// Export singleton instance
module.exports = new EmailService();
module.exports.getHubAuthTemplateIds = getHubAuthTemplateIds;
module.exports.listHubTemplateConfiguration =
    listHubTemplateConfiguration ||
    require('../email/emailDefinitions').listDefinitionsForDiagnostics;

