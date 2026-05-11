const { computeCartVersion } = require('./cartVersion');

function buildShippingVersionSource({ country, municipality, zoneId, methodId, cost, freeDelivery, currency }) {
    return {
        country: String(country || '').toUpperCase(),
        municipality: String(municipality || '').trim().toLowerCase(),
        zoneId: zoneId != null ? String(zoneId) : null,
        methodId: methodId != null ? String(methodId) : null,
        cost: typeof cost === 'number' && !isNaN(cost) ? Math.round(cost * 100) / 100 : 0,
        freeDelivery: freeDelivery === true,
        currency: currency ? String(currency).toUpperCase() : 'SEK'
    };
}

function computeShippingVersion(source) {
    return computeCartVersion(source);
}

module.exports = { buildShippingVersionSource, computeShippingVersion };

