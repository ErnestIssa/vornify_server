/**
 * CSP for responses from this API. JSON clients usually ignore CSP; embedded HTML/iframes
 * from admin or future server-rendered pages still get a sane policy.
 * Stripe: https://docs.stripe.com/security/guide#content-security-policy
 */
function buildStripePaymentCsp() {
    // Optional extra directive fragments (advanced), e.g. "worker-src 'self' blob:"
    const extra = (process.env.CSP_EXTRA_DIRECTIVES || '').trim();
    const parts = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
        "style-src 'self' 'unsafe-inline' https://js.stripe.com",
        "img-src 'self' data: blob: https: https://*.stripe.com",
        "font-src 'self' data: https://js.stripe.com",
        "connect-src 'self' https://api.stripe.com https://*.stripe.com https://merchant-ui-api.stripe.com https://r.stripe.com https://m.stripe.com https:",
        "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://payments.stripe.com",
        "base-uri 'self'",
        "form-action 'self' https://hooks.stripe.com https://stripe.com https://payments.stripe.com"
    ];
    if (extra) {
        parts.push(extra);
    }
    return parts.join('; ');
}

module.exports = {
    buildStripePaymentCsp
};
