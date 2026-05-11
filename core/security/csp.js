const { buildStripePaymentCsp } = require('../../config/contentSecurityPolicy');

function buildCsp() {
    return buildStripePaymentCsp();
}

module.exports = { buildCsp };

