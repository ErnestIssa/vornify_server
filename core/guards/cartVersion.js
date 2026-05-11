const crypto = require('crypto');

function stableStringify(value) {
    if (value == null) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Server-generated version identifier for cart/checkout snapshots.
 * Must change whenever anything that affects totals changes.
 */
function computeCartVersion(input) {
    const s = stableStringify(input);
    return crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
}

/**
 * Create a normalized snapshot from a cart + selected checkout inputs.
 * Include only fields that must participate in versioning.
 */
function buildCartVersionSource({ cart, shippingAddress, shippingMethod, discountCode }) {
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const normItems = items.map((it) => ({
        id: String(it.id ?? it.productId ?? ''),
        variantId: it.variantId != null ? String(it.variantId) : null,
        colorId: it.colorId != null ? String(it.colorId) : null,
        sizeId: it.sizeId != null ? String(it.sizeId) : null,
        quantity: Number(it.quantity || 0),
        // Price is stored as SEK gross in backend cart; include to detect price changes.
        price: typeof it.price === 'number' && !isNaN(it.price) ? it.price : 0
    }));

    normItems.sort((a, b) => (a.id + (a.variantId || '')).localeCompare(b.id + (b.variantId || '')));

    const country = shippingAddress ? (shippingAddress.countryCode || shippingAddress.country || '') : '';
    const municipality = shippingAddress ? (shippingAddress.municipality || shippingAddress.city || '') : '';
    const methodId = shippingMethod ? (shippingMethod.id || shippingMethod.shippingMethodId || shippingMethod._id || '') : '';

    return {
        items: normItems,
        shipping: {
            country: String(country || '').toUpperCase(),
            municipality: String(municipality || '').trim(),
            methodId: String(methodId || '')
        },
        discountCode: discountCode ? String(discountCode).trim().toUpperCase() : null,
        // If cart has an appliedDiscount, include its code so version changes if backend drops it.
        appliedDiscount: cart?.appliedDiscount?.code ? String(cart.appliedDiscount.code).trim().toUpperCase() : null
    };
}

module.exports = {
    computeCartVersion,
    buildCartVersionSource
};

