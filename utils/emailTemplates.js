const fs = require('fs');
const path = require('path');

class EmailTemplates {
    constructor() {
        this.templatesPath = path.join(__dirname, 'templates');
    }

    // Load HTML template from file
    loadTemplate(templateName) {
        try {
            const templatePath = path.join(this.templatesPath, `${templateName}.html`);
            return fs.readFileSync(templatePath, 'utf8');
        } catch (error) {
            console.error(`Error loading template ${templateName}:`, error);
            return null;
        }
    }

    // Replace placeholders in template with dynamic data
    replacePlaceholders(template, data) {
        if (!template) return null;
        
        let processedTemplate = template;
        
        // Replace all {{variable}} placeholders with actual data
        Object.keys(data).forEach(key => {
            const placeholder = new RegExp(`{{${key}}}`, 'g');
            processedTemplate = processedTemplate.replace(placeholder, data[key] || '');
        });
        
        return processedTemplate;
    }

    // Generate order confirmation email
    generateOrderConfirmation(orderData) {
        const template = this.loadTemplate('orderConfirmation');
        if (!template) return null;

        const data = {
            customer_name: orderData.customer.name,
            order_number: orderData.orderId,
            order_items: this.formatOrderItems(orderData.items),
            order_total: `${orderData.totals.total} SEK`,
            shipping_address: this.formatAddress(orderData.shippingAddress),
            order_status_url: `https://peakmode.se/track-order`,
            website_url: 'https://peakmode.se',
            instagram_url: 'https://www.instagram.com/peakmode1',
            tiktok_url: 'https://www.tiktok.com/@peakmode.se',
            unsubscribe_url: `https://peakmode.se/unsubscribe?email=${orderData.customer.email}`,
            privacy_url: 'https://peakmode.se/privacy-policy',
            year: '2024'
        };

        return this.replacePlaceholders(template, data);
    }

    // Generate order processing email
    generateOrderProcessing(orderData) {
        const template = this.loadTemplate('orderProcessing');
        if (!template) return null;

        const data = {
            customer_name: orderData.customer.name,
            order_number: orderData.orderId,
            order_items: this.formatOrderItems(orderData.items),
            order_total: `${orderData.totals.total} SEK`,
            shipping_address: this.formatAddress(orderData.shippingAddress),
            order_status_url: `https://peakmode.se/track-order`,
            website_url: 'https://peakmode.se',
            instagram_url: 'https://www.instagram.com/peakmode1',
            tiktok_url: 'https://www.tiktok.com/@peakmode.se',
            unsubscribe_url: `https://peakmode.se/unsubscribe?email=${orderData.customer.email}`,
            privacy_url: 'https://peakmode.se/privacy-policy',
            year: '2024'
        };

        return this.replacePlaceholders(template, data);
    }

    // Generate shipping notification email
    generateShippingNotification(orderData) {
        const template = this.loadTemplate('shippingNotification');
        if (!template) return null;

        const data = {
            customer_name: orderData.customer.name,
            order_number: orderData.orderId,
            order_items: this.formatOrderItems(orderData.items),
            order_total: `${orderData.totals.total} SEK`,
            shipping_address: this.formatAddress(orderData.shippingAddress),
            tracking_number: orderData.trackingNumber || 'N/A',
            tracking_url: orderData.trackingUrl || '#',
            order_status_url: `https://peakmode.se/track-order`,
            website_url: 'https://peakmode.se',
            instagram_url: 'https://www.instagram.com/peakmode1',
            tiktok_url: 'https://www.tiktok.com/@peakmode.se',
            unsubscribe_url: `https://peakmode.se/unsubscribe?email=${orderData.customer.email}`,
            privacy_url: 'https://peakmode.se/privacy-policy',
            year: '2024'
        };

        return this.replacePlaceholders(template, data);
    }

    // Generate delivery confirmation email
    generateDeliveryConfirmation(orderData) {
        const template = this.loadTemplate('deliveryConfirmation');
        if (!template) return null;

        const data = {
            customer_name: orderData.customer.name,
            order_number: orderData.orderId,
            order_items: this.formatOrderItems(orderData.items),
            order_total: `${orderData.totals.total} SEK`,
            shipping_address: this.formatAddress(orderData.shippingAddress),
            website_url: 'https://peakmode.se',
            instagram_url: 'https://www.instagram.com/peakmode1',
            tiktok_url: 'https://www.tiktok.com/@peakmode.se',
            unsubscribe_url: `https://peakmode.se/unsubscribe?email=${orderData.customer.email}`,
            privacy_url: 'https://peakmode.se/privacy-policy',
            year: '2024'
        };

        return this.replacePlaceholders(template, data);
    }

    // Generate newsletter welcome email
    generateNewsletterWelcome(subscriberData) {
        const template = this.loadTemplate('newsletterWelcome');
        if (!template) return null;

        const data = {
            customer_name: subscriberData.name || 'Peak Mode Member',
            discount_code: subscriberData.discountCode,
            website_url: 'https://peakmode.se',
            year: '2024'
        };

        return this.replacePlaceholders(template, data);
    }

    // Generate discount reminder email
    generateDiscountReminder(subscriberData) {
        const template = this.loadTemplate('discountReminder');
        if (!template) return null;

        const data = {
            customer_name: subscriberData.name || 'Peak Mode Member',
            discount_code: subscriberData.discountCode,
            website_url: 'https://peakmode.se',
            year: '2024'
        };

        return this.replacePlaceholders(template, data);
    }

    // Format order items for display in email
    formatOrderItems(items) {
        if (!items || !Array.isArray(items)) return '<p>No items found</p>';
        
        let itemsHtml = '';
        items.forEach(item => {
            const variant = item.variant ? ` (${item.variant.color}, ${item.variant.size})` : '';
            itemsHtml += `
                <div class="item">
                    <div class="item-name">${item.name}${variant}</div>
                    <div class="item-price">${item.quantity} x ${item.price} SEK</div>
                </div>
            `;
        });
        
        return itemsHtml;
    }

    // Format address for display in email
    formatAddress(address) {
        if (!address) return 'No address provided';
        
        return `
            ${address.name}<br>
            ${address.street}<br>
            ${address.postalCode} ${address.city}<br>
            ${address.country}
        `;
    }

    // Generate plain text version of email
    generatePlainText(htmlContent) {
        // Simple HTML to text conversion
        return htmlContent
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();
    }
}

module.exports = EmailTemplates;
