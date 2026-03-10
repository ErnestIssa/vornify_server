/**
 * Checkout Totals Service
 * Single source of truth for all monetary calculations.
 * Backend is the ONLY system that calculates prices and totals.
 * VAT rate is per-country (EU); use vatService.getVatRate(country) and pass here.
 */

const DEFAULT_VAT_RATE = 0.25;

function roundToCurrency(value) {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    return Math.round(value * 100) / 100;
}

/**
 * Calculate full checkout totals from items, shipping, and discount.
 * @param {Array<{ price: number, quantity: number, priceNet?: number }>} items - Cart/order items (price = gross per unit, or priceNet if pricesAreNet)
 * @param {number} shippingGross - Shipping cost (VAT-included)
 * @param {number} discountAmount - Discount amount in currency (applied to product gross only)
 * @param {string} currency - Currency code (e.g. 'SEK')
 * @param {number} vatRate - VAT rate for country (e.g. 0.25)
 * @param {object} options - Optional: { country?: string, pricesAreNet?: boolean }
 * @returns {object} totals - Canonical totals object; includes country when provided
 */
function calculateTotals(items = [], shippingGross = 0, discountAmount = 0, currency = 'SEK', vatRate = DEFAULT_VAT_RATE, options = {}) {
    const vat = typeof vatRate === 'number' && !isNaN(vatRate) ? vatRate : DEFAULT_VAT_RATE;
    const pricesAreNet = options && options.pricesAreNet === true;
    const country = (options && options.country) ? String(options.country).toUpperCase().trim() : undefined;

    let productGrossSubtotal;
    if (pricesAreNet) {
        const productNetSubtotal = (items || []).reduce((sum, item) => {
            const price = typeof item.priceNet === 'number' && !isNaN(item.priceNet) ? item.priceNet : (typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0);
            const qty = typeof item.quantity === 'number' && !isNaN(item.quantity) && item.quantity > 0 ? item.quantity : 0;
            return sum + price * qty;
        }, 0);
        productGrossSubtotal = roundToCurrency(productNetSubtotal * (1 + vat));
    } else {
        productGrossSubtotal = (items || []).reduce((sum, item) => {
            const price = typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0;
            const qty = typeof item.quantity === 'number' && !isNaN(item.quantity) && item.quantity > 0 ? item.quantity : 0;
            return sum + price * qty;
        }, 0);
    }

    const productGrossSubtotalRounded = roundToCurrency(productGrossSubtotal);
    const discountRounded = roundToCurrency(Math.max(0, discountAmount));

    const productGrossAfterDiscount = roundToCurrency(Math.max(0, productGrossSubtotalRounded - discountRounded));
    const productNetAfterDiscount = roundToCurrency(productGrossAfterDiscount / (1 + vat));
    const vatAmount = roundToCurrency(productGrossAfterDiscount - productNetAfterDiscount);
    const subtotalGross = productGrossAfterDiscount;
    // Subtotal ex-VAT (after discount): so that subtotalNet + vatAmount = subtotalGross
    const subtotalNet = productNetAfterDiscount;

    const shippingGrossRounded = roundToCurrency(shippingGross);
    const shippingNet = roundToCurrency(shippingGrossRounded / (1 + vat));
    const shippingVat = roundToCurrency(shippingGrossRounded - shippingNet);
    const total = roundToCurrency(subtotalGross + shippingGrossRounded);

    const result = {
        subtotalNet,
        vatRate: vat,
        vatAmount,
        subtotalGross,
        discountAmount: discountRounded,
        shippingNet,
        shippingVat,
        shippingGross: shippingGrossRounded,
        total,
        currency: currency || 'SEK'
    };
    if (country) result.country = country;
    // Backward-compat aliases so frontend can use totals.subtotal / totals.tax / totals.shipping
    result.subtotal = subtotalNet;
    result.tax = vatAmount;
    result.shipping = shippingGrossRounded;
    result.discount = discountRounded;
    result.discountedSubtotal = roundToCurrency(productNetAfterDiscount);
    return result;
}

module.exports = {
    calculateTotals,
    VAT_RATE: DEFAULT_VAT_RATE,
    DEFAULT_VAT_RATE,
    roundToCurrency
};
