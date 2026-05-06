/**
 * Absolute URLs for checkout (payment failed page, 3DS / redirect return, success).
 *
 * Env (set one base):
 * - STOREFRONT_URL | FRONTEND_URL | PUBLIC_STORE_URL — e.g. https://www.peakmode.se (no trailing slash)
 *
 * Optional paths (leading slash):
 * - STOREFRONT_PAYMENT_FAILED_PATH — default /payment-failed
 * - STOREFRONT_PAYMENT_RETURN_PATH — default /checkout (use as stripe.confirmPayment return_url base)
 * - STOREFRONT_ORDER_SUCCESS_PATH — default /thank-you
 */

function trimSlash(s) {
    return String(s || '').replace(/\/$/, '');
}

function getStorefrontBaseUrl() {
    const base = process.env.STOREFRONT_URL || process.env.FRONTEND_URL || process.env.PUBLIC_STORE_URL || '';
    return trimSlash(base);
}

function joinUrl(base, path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
}

/**
 * Shared Stripe PaymentIntent options: SCA / 3DS for cards + redirect methods (Klarna, etc.).
 * Use on create and on amount update so intent never loses security settings.
 */
function getPaymentIntentSecurityOptions() {
    return {
        automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'always'
        },
        payment_method_options: {
            card: {
                // Request 3DS whenever the card supports it (before capture / next phase)
                request_three_d_secure: 'any'
            }
        }
    };
}

function getCheckoutUrls() {
    const base = getStorefrontBaseUrl();
    const failedPath = process.env.STOREFRONT_PAYMENT_FAILED_PATH || '/payment-failed';
    const returnPath = process.env.STOREFRONT_PAYMENT_RETURN_PATH || '/checkout';
    const successPath = process.env.STOREFRONT_ORDER_SUCCESS_PATH || '/thank-you';

    const paymentFailedUrl = base ? joinUrl(base, failedPath) : null;
    const confirmPaymentReturnUrl = base ? joinUrl(base, returnPath) : null;
    const orderSuccessUrl = base ? joinUrl(base, successPath) : null;

    return {
        baseUrl: base || null,
        paymentFailedUrl,
        /** Pass to stripe.confirmPayment({ return_url }) for 3DS / bank / wallet redirects */
        confirmPaymentReturnUrl,
        orderSuccessUrl,
        configured: Boolean(base)
    };
}

/**
 * Maps Stripe last_payment_error / decline to a stable category for UI copy + routing.
 */
function classifyPaymentFailure(errorLike) {
    if (!errorLike) return { failureCategory: 'unknown', stripeCode: null };
    const code = errorLike.code || errorLike.decline_code || null;
    const type = errorLike.type || null;
    let failureCategory = 'unknown';
    if (code === 'insufficient_funds') failureCategory = 'insufficient_funds';
    else if (code === 'authentication_required' || code === 'payment_intent_authentication_failure') failureCategory = 'authentication_failed';
    else if (code === 'card_declined' || type === 'card_error') failureCategory = 'card_declined';
    else if (code === 'canceled' || type === 'StripeInvalidRequestError') failureCategory = 'canceled';
    return { failureCategory, stripeCode: code, declineCode: errorLike.decline_code || null };
}

/**
 * Payload fragment to merge into JSON responses so the storefront can route consistently.
 */
function checkoutNavigationExtras(options = {}) {
    const urls = getCheckoutUrls();
    const { paymentIntent, shouldRedirectToFailurePage, failureHint } = options;
    let classification = null;
    if (paymentIntent && paymentIntent.last_payment_error) {
        classification = classifyPaymentFailure(paymentIntent.last_payment_error);
    }
    return {
        checkoutNavigation: {
            ...urls,
            shouldRedirectToPaymentFailedPage: Boolean(shouldRedirectToFailurePage),
            failureCategory: classification?.failureCategory || (failureHint || null),
            stripeDeclineOrErrorCode: classification?.stripeCode || null,
            frontendInstructions: urls.configured
                ? 'On any terminal payment failure (decline, cancel, insufficient funds, 3DS abandon, network error after trying confirm), navigate to paymentFailedUrl (or your router equivalent). Pass orderId and paymentIntentId as query params if you use them.'
                : 'Set STOREFRONT_URL (or FRONTEND_URL) on the server so paymentFailedUrl and confirmPaymentReturnUrl are returned for redirects.',
            confirmPayment: {
                returnUrlMustMatch: urls.confirmPaymentReturnUrl,
                note: 'Use confirmPaymentReturnUrl as return_url so users return to your app after bank/issuer or Klarna redirects. Then retrieve PaymentIntent status before showing success.'
            }
        }
    };
}

module.exports = {
    getStorefrontBaseUrl,
    getCheckoutUrls,
    getPaymentIntentSecurityOptions,
    classifyPaymentFailure,
    checkoutNavigationExtras
};
