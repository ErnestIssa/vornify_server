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
 * Env paths may be set as "/payment-failed" or mistakenly as a full URL.
 * Full URLs must be reduced to pathname (+ search) before joining with STOREFRONT_URL,
 * or you get: base + "/https://host/path" → "https://host/https://host/path".
 */
function normalizePathConfig(raw, defaultPath) {
    const d = defaultPath.startsWith('/') ? defaultPath : `/${defaultPath}`;
    const s = String(raw || '').trim();
    if (!s) return d;
    if (/^https?:\/\//i.test(s)) {
        try {
            const u = new URL(s);
            return u.pathname + u.search;
        } catch {
            return d;
        }
    }
    // e.g. env copy-paste "/https://peakmode.se/payment-failed" → "/payment-failed"
    if (/^\/https?:\/\//i.test(s)) {
        try {
            const u = new URL(s.slice(1));
            return u.pathname + u.search;
        } catch {
            return d;
        }
    }
    return s.startsWith('/') ? s : `/${s}`;
}

function pathnameForSpa(pathnameAndSearch) {
    const i = pathnameAndSearch.indexOf('?');
    return i === -1 ? pathnameAndSearch : pathnameAndSearch.slice(0, i);
}

/** Build one canonical absolute URL: prefer URL(base + path), never string-concat base + fullUrl. */
function absoluteUrlFromBase(baseTrimmed, pathnameAndSearch) {
    try {
        return new URL(pathnameAndSearch, `${baseTrimmed}/`).href;
    } catch {
        return joinUrl(baseTrimmed, pathnameAndSearch);
    }
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
    const failedNorm = normalizePathConfig(process.env.STOREFRONT_PAYMENT_FAILED_PATH, '/payment-failed');
    const returnNorm = normalizePathConfig(process.env.STOREFRONT_PAYMENT_RETURN_PATH, '/checkout');
    const successNorm = normalizePathConfig(process.env.STOREFRONT_ORDER_SUCCESS_PATH, '/thank-you');

    const paymentFailedUrl = base ? absoluteUrlFromBase(base, failedNorm) : null;
    const confirmPaymentReturnUrl = base ? absoluteUrlFromBase(base, returnNorm) : null;
    const orderSuccessUrl = base ? absoluteUrlFromBase(base, successNorm) : null;

    // Pathname-only for React Router (query strings for failures are usually appended client-side).
    const paymentFailedPath = pathnameForSpa(failedNorm);
    const confirmPaymentReturnPath = pathnameForSpa(returnNorm);
    const orderSuccessPath = pathnameForSpa(successNorm);

    return {
        baseUrl: base || null,
        paymentFailedUrl,
        /** Pass to stripe.confirmPayment({ return_url }) for 3DS / bank / wallet redirects */
        confirmPaymentReturnUrl,
        orderSuccessUrl,
        paymentFailedPath,
        confirmPaymentReturnPath,
        orderSuccessPath,
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
                ? 'On failure, use checkoutNavigation.paymentFailedPath with query string for SPA navigate (e.g. navigate(paymentFailedPath + "?..." )). Do NOT pass paymentFailedUrl to react-router navigate() — absolute URLs are treated as relative paths and produce /https://.../route (404). Use paymentFailedUrl only with window.location.assign or <a href>.'
                : 'Set STOREFRONT_URL (or FRONTEND_URL) on the server so paymentFailedUrl and confirmPaymentReturnUrl are returned for redirects.',
            spaNavigation: {
                paymentFailedPath: urls.paymentFailedPath,
                confirmPaymentReturnPath: urls.confirmPaymentReturnPath,
                orderSuccessPath: urls.orderSuccessPath,
                rule: 'React Router: navigate(paymentFailedPath + searchParamsString). Full-page: location.assign(paymentFailedUrl).'
            },
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
