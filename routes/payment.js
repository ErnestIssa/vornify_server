const express = require('express');
const router = express.Router();
const VornifyPay = require('../vornifypay/vornifypay');
const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('../services/emailService');
const storefrontCheckoutUrls = require('../services/storefrontCheckoutUrls');
const {
    getPaymentIntentSecurityOptions,
    checkoutNavigationExtras,
    classifyPaymentFailure
} = storefrontCheckoutUrls;

// /core reliability primitives (gradual adoption)
const { AppError } = require('../core/errors/AppError');
const { ErrorCodes } = require('../core/errors/codes');
const { requireFields } = require('../core/validators/requireFields');
const { withRetry } = require('../core/retry/retry');
const { ensureIdempotencyKey } = require('../core/guards/idempotency');
const { buildCartVersionSource, computeCartVersion } = require('../core/guards/cartVersion');
const { logger } = require('../core/logging/logger');
const { devLog, devWarn } = require('../core/logging/devConsole');

// Validate Stripe configuration at startup (no secret material in logs)
if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is missing from environment variables');
} else {
    devLog('STRIPE_SECRET_KEY loaded');
}

if (!process.env.STRIPE_PUBLIC_KEY) {
    console.warn('STRIPE_PUBLIC_KEY is missing from environment variables');
} else {
    devLog('STRIPE_PUBLIC_KEY loaded');
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('STRIPE_WEBHOOK_SECRET is missing — webhook signature verification disabled');
} else {
    devLog('STRIPE_WEBHOOK_SECRET loaded');
}

// Initialize Stripe
// Using default API version (latest) for PaymentElement compatibility
// Stripe automatically uses the latest API version that supports all features
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initialize services
let paymentService;
try {
    paymentService = new VornifyPay();
    devLog('VornifyPay service initialized');
} catch (error) {
    console.error('Failed to initialize VornifyPay:', error.message);
}

const db = getDBInstance();

/** Read first matching pending_checkouts row (VornifyDB may return array or object). */
async function readPendingCheckoutRow(query) {
    const r = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'pending_checkouts',
        command: '--read',
        data: query
    });
    if (!r.success || !r.data) return null;
    const rows = Array.isArray(r.data) ? r.data : [r.data];
    return rows[0] || null;
}

/**
 * Find draft checkout for a succeeded PaymentIntent.
 * Order: by paymentIntentId (fixes "pay before draft saved" / TEMP metadata mismatch), then hint orderId, then metadata orderId.
 */
async function findPendingCheckoutForPaymentIntent(paymentIntent, hintOrderId) {
    const piId = paymentIntent.id;
    let p = await readPendingCheckoutRow({ paymentIntentId: piId });
    if (p?.orderDraft) return p;
    if (hintOrderId) {
        p = await readPendingCheckoutRow({ orderId: hintOrderId });
        if (p?.orderDraft) return p;
    }
    const metaOid = paymentIntent.metadata?.orderId;
    if (metaOid) {
        p = await readPendingCheckoutRow({ orderId: metaOid });
        if (p?.orderDraft) return p;
    }
    return null;
}

/**
 * VornifyDB `--read` with `{ orderId }` returns an ARRAY (filter query), not a single doc.
 * Empty match is `[]` which is truthy — never use raw `data` as the order document.
 */
function normalizeReadFirst(data) {
    if (data == null) return null;
    if (Array.isArray(data)) return data.length ? data[0] : null;
    return data;
}

/** Normalize country to ISO 2-letter code (e.g. "Sweden" -> "SE") for zone lookup. */
function normalizeCountryCode(countryOrCode) {
    if (!countryOrCode || typeof countryOrCode !== 'string') return '';
    const upper = countryOrCode.toUpperCase().trim();
    if (upper.length === 2) return upper;
    const map = {
        SWEDEN: 'SE',
        SVERIGE: 'SE',
        GERMANY: 'DE',
        FRANCE: 'FR',
        DENMARK: 'DK',
        NORWAY: 'NO',
        FINLAND: 'FI',
        ITALY: 'IT',
        SPAIN: 'ES',
        NETHERLANDS: 'NL',
        POLAND: 'PL',
        AUSTRIA: 'AT',
        BELGIUM: 'BE',
        CROATIA: 'HR',
        CYPRUS: 'CY',
        CZECH: 'CZ',
        CZECHIA: 'CZ',
        ESTONIA: 'EE',
        GREECE: 'GR',
        HUNGARY: 'HU',
        IRELAND: 'IE',
        LATVIA: 'LV',
        LITHUANIA: 'LT',
        LUXEMBOURG: 'LU',
        MALTA: 'MT',
        PORTUGAL: 'PT',
        ROMANIA: 'RO',
        SLOVAKIA: 'SK',
        SLOVENIA: 'SI',
        BULGARIA: 'BG',
        UK: 'GB',
        'UNITED KINGDOM': 'GB'
    };
    return map[upper] || upper;
}

/** Compute canonical order totals on backend (source of truth). */
function computeCanonicalOrderTotals(order, overrides = {}) {
    const checkoutTotalsService = require('../services/checkoutTotalsService');
    const vatService = require('../services/vatService');

    const items = Array.isArray(order?.items) ? order.items : [];

    const shippingCountryRaw =
        overrides.country ||
        order?.shippingAddress?.country ||
        order?.shippingAddress?.countryCode ||
        order?.customer?.country ||
        order?.customer?.countryCode ||
        vatService.DEFAULT_COUNTRY;
    const country = normalizeCountryCode(String(shippingCountryRaw || ''));
    const vatRate =
        (typeof overrides.vatRate === 'number' && !isNaN(overrides.vatRate))
            ? overrides.vatRate
            : vatService.getVatRate(country || vatService.DEFAULT_COUNTRY);

    const shippingGross =
        (typeof overrides.shippingGross === 'number' && !isNaN(overrides.shippingGross))
            ? overrides.shippingGross
            : (
                (order?.totals && (typeof order.totals.shippingGross === 'number' ? order.totals.shippingGross : undefined)) ??
                (order?.totals && (typeof order.totals.shipping === 'number' ? order.totals.shipping : undefined)) ??
                (typeof order?.shippingCost === 'number' ? order.shippingCost : undefined) ??
                (typeof order?.shipping === 'number' ? order.shipping : undefined) ??
                0
            );

    const discountAmount =
        (typeof overrides.discountAmount === 'number' && !isNaN(overrides.discountAmount))
            ? overrides.discountAmount
            : (
                (order?.totals && (typeof order.totals.discountAmount === 'number' ? order.totals.discountAmount : undefined)) ??
                (order?.totals && (typeof order.totals.discount === 'number' ? order.totals.discount : undefined)) ??
                (order?.appliedDiscount && typeof order.appliedDiscount.amount === 'number' ? order.appliedDiscount.amount : undefined) ??
                0
            );

    return checkoutTotalsService.calculateTotals(items, shippingGross, discountAmount, 'SEK', vatRate, { country });
}

function groupOrderItemsForDeduction(items) {
    const out = new Map();
    const arr = Array.isArray(items) ? items : [];
    for (const it of arr) {
        const productId = String(it.id || it.productId || '').trim();
        if (!productId) continue;
        const qty = typeof it.quantity === 'number' && !isNaN(it.quantity) ? it.quantity : Number(it.quantity);
        const q = Number.isFinite(qty) ? Math.max(0, Math.floor(qty)) : 0;
        if (q <= 0) continue;
        const variantId = it.variantId != null ? String(it.variantId) : null;
        const colorId = it.colorId != null ? String(it.colorId) : null;
        const sizeId = it.sizeId != null ? String(it.sizeId) : null;
        const key = `${productId}::${variantId || ''}::${colorId || ''}::${sizeId || ''}`;
        const prev = out.get(key) || { productId, variantId, colorId, sizeId, quantity: 0 };
        prev.quantity += q;
        out.set(key, prev);
    }
    return Array.from(out.values());
}

async function deductInventoryForOrder(order) {
    const items = groupOrderItemsForDeduction(order?.items || []);
    if (items.length === 0) return { success: true, skipped: true };

    for (const it of items) {
        const productId = it.productId;
        const qty = it.quantity;
        const hasVariantId = !!it.variantId;
        const filter = { id: String(productId) };
        const arrayFilters = [];

        if (hasVariantId) {
            filter['inventory.variants'] = { $elemMatch: { id: it.variantId, quantity: { $gte: qty }, available: { $ne: false } } };
            arrayFilters.push({ 'v.id': it.variantId });
        } else if (it.colorId && it.sizeId) {
            filter['inventory.variants'] = { $elemMatch: { colorId: it.colorId, sizeId: it.sizeId, quantity: { $gte: qty }, available: { $ne: false } } };
            arrayFilters.push({ 'v.colorId': it.colorId, 'v.sizeId': it.sizeId });
        } else {
            return { success: false, error: 'missing_variant_identity', item: it };
        }

        const update = {
            $inc: {
                'inventory.variants.$[v].quantity': -qty,
                'inventory.totalQuantity': -qty
            },
            $set: {
                'inventory.lastUpdated': new Date().toISOString()
            }
        };

        const op = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--update-operator',
            data: {
                filter,
                update,
                options: { arrayFilters }
            }
        });

        if (!op.success) {
            return { success: false, error: op.error || op.message || 'inventory_update_failed', item: it };
        }
    }
    return { success: true };
}

function sumCartProductGross(cartItems) {
    return (cartItems || []).reduce((sum, item) => {
        const p = typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0;
        const q = typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : 0;
        return sum + p * q;
    }, 0);
}

/**
 * Try several client payload shapes (slug, Mongo id, deliveryOption) until one matches an active method.
 */
async function resolveShippingMethodIdFromPayload(shippingMethod, body) {
    const shippingConfigService = require('../services/shippingConfigService');
    const candidates = [];
    const push = (v) => {
        if (v === undefined || v === null) return;
        const s = String(v).trim();
        if (s !== '') candidates.push(s);
    };
    if (shippingMethod && typeof shippingMethod === 'object') {
        push(shippingMethod.id);
        push(shippingMethod.shippingMethodId);
        push(shippingMethod.methodId);
        push(shippingMethod._id);
    }
    const b = body && typeof body === 'object' ? body : {};
    push(b.shippingMethodId);
    push(b.methodId);
    if (b.deliveryOption && typeof b.deliveryOption === 'object') {
        push(b.deliveryOption.id);
        push(b.deliveryOption.methodId);
        push(b.deliveryOption._id);
    }
    const seen = new Set();
    const unique = candidates.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
    for (const cand of unique) {
        const m = await shippingConfigService.getMethodById(cand);
        if (m) return cand;
    }
    return null;
}

function extractShippingCountryRaw(shippingAddress) {
    if (!shippingAddress || typeof shippingAddress !== 'object') return '';
    const a = shippingAddress;
    return (
        a.country ||
        a.countryCode ||
        a.country_code ||
        a.Country ||
        a.nationality ||
        ''
    );
}

/**
 * Compute canonical checkout totals for a userId from the current cart + selected shipping/discount.
 * This is used for create-intent, update-intent, and the new prepare-confirmation endpoint.
 *
 * @param {object} opts
 * @param {object} [opts.checkoutContextBody] - raw POST body (prepare-confirmation) for nested deliveryOption / alternate keys
 * @param {boolean} [opts.tolerateInvalidDiscount] - if true, invalid/expired cart discount is dropped (amount 0) instead of 400
 */
async function computeCheckoutTotalsForUser({
    req,
    userId,
    shippingAddress,
    shippingMethod,
    discountCode,
    checkoutContextBody = null,
    tolerateInvalidDiscount = false
}) {
    const checkoutTotalsService = require('../services/checkoutTotalsService');
    const discountService = require('../services/discountService');
    const vatService = require('../services/vatService');
    const shippingConfigService = require('../services/shippingConfigService');

    // Load current cart from database (single source of truth)
    const cartResult = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'carts',
        command: '--read',
        data: { userId }
    });

    const cart = (cartResult.success && cartResult.data)
        ? (Array.isArray(cartResult.data) ? cartResult.data[0] : cartResult.data)
        : null;

    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
        throw new AppError({
            code: ErrorCodes.CHECKOUT_EMPTY,
            httpStatus: 400,
            severity: 'warn',
            message: 'Cart not found or empty',
            userMessage: 'Your cart is empty. Please add items before completing your order.'
        });
    }

    let countryForZone = normalizeCountryCode(String(extractShippingCountryRaw(shippingAddress) || ''));
    if (!countryForZone) {
        countryForZone = normalizeCountryCode(String(vatService.getCountryFromRequest(req) || ''));
    }

    const countryForVat = countryForZone || vatService.getCountryFromRequest(req);
    const vatRate = vatService.getVatRate(countryForVat);

    // Shipping validation + versioned quote from DB (do not silently treat invalid as 0)
    const methodId = await resolveShippingMethodIdFromPayload(shippingMethod, checkoutContextBody);
    if (!methodId) {
        throw new AppError({
            code: ErrorCodes.VALIDATION_FAILED,
            httpStatus: 400,
            severity: 'warn',
            message: 'Could not resolve shipping method id from request',
            userMessage: 'Please choose a delivery option again, then try paying.',
            details: { reason: 'unresolved_shipping_method' }
        });
    }
    const municipality = (shippingAddress && (shippingAddress.municipality || shippingAddress.city) ? String(shippingAddress.municipality || shippingAddress.city) : '').trim();
    const quoteResult = await shippingConfigService.validateAndQuoteShipping(countryForZone, methodId, municipality, 'SEK');
    if (!quoteResult.ok) {
        throw new AppError({
            code: quoteResult.errorCode === 'SHIPPING_UNAVAILABLE' ? ErrorCodes.SHIPPING_UNAVAILABLE : ErrorCodes.SHIPPING_METHOD_INVALID,
            httpStatus: 400,
            severity: 'warn',
            message: 'Shipping method invalid for address',
            userMessage: quoteResult.userMessage || 'Selected shipping method is not available. Please choose another.',
            details: { countryForZone, methodId, municipality }
        });
    }
    const shippingCost = quoteResult.quote.cost;
    const shippingVersion = quoteResult.quote.shippingVersion;

    const effectiveDiscountCode = discountService.pickEffectiveDiscountCode(discountCode, cart);
    const productGrossForDiscount = sumCartProductGross(cart.items);
    let discountAmount = 0;
    let discountDropped = false;
    if (effectiveDiscountCode) {
        const discountResolution = await discountService.validateAndComputeDiscountAmount(
            productGrossForDiscount,
            shippingCost,
            effectiveDiscountCode
        );
        if (!discountResolution.ok) {
            if (tolerateInvalidDiscount) {
                discountDropped = true;
                logger.warn('prepare_confirmation_discount_dropped', {
                    userId,
                    discountCode: effectiveDiscountCode,
                    errorCode: discountResolution.errorCode
                });
                discountAmount = 0;
            } else {
                throw new AppError({
                    code: discountResolution.errorCode,
                    httpStatus: 400,
                    severity: 'warn',
                    message: discountResolution.error,
                    userMessage: discountResolution.userMessage,
                    details: { discountCode: effectiveDiscountCode }
                });
            }
        } else {
            discountAmount = discountResolution.discountAmount;
        }
    }

    const totals = checkoutTotalsService.calculateTotals(
        cart.items,
        shippingCost,
        discountAmount,
        'SEK',
        vatRate,
        { country: countryForVat }
    );

    return {
        cart,
        totals,
        countryForVat,
        shippingQuote: quoteResult.quote,
        shippingVersion,
        discountDropped,
        clearedDiscountCode: discountDropped ? effectiveDiscountCode : null
    };
}

/**
 * GET /api/payments/check-payment-methods
 * Check if Apple Pay and Google Pay are available for the user's device/browser
 * This endpoint helps the frontend determine which payment methods to show
 * 
 * Query Parameters:
 * - currency: Optional - currency code (default: 'sek')
 * - amount: Optional - amount to check (default: 0)
 */
router.get('/check-payment-methods', async (req, res) => {
    try {
        const { currency = 'sek', amount = 0 } = req.query;
        
        // Create a test payment intent to check available payment methods
        // This uses Stripe's payment method detection
        const testPaymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(parseFloat(amount) * 100) || 100, // Minimum 1.00 in smallest unit
            currency: currency.toLowerCase(),
            automatic_payment_methods: {
                enabled: true
            }
        });
        
        // Retrieve the payment intent to see available payment methods
        const paymentIntent = await stripe.paymentIntents.retrieve(testPaymentIntent.id);
        
        // Cancel the test payment intent (we only needed it for detection)
        try {
            await stripe.paymentIntents.cancel(testPaymentIntent.id);
        } catch (cancelError) {
            // Ignore cancel errors - test intent may already be canceled
        }
        
        // Return available payment methods
        // Note: Actual availability depends on user's device/browser
        // Frontend should use Stripe.js to check real-time availability
        res.json({
            success: true,
            paymentMethods: {
                card: true, // Always available
                applePay: {
                    available: true, // Backend supports it - frontend checks device
                    note: 'Available on Safari (iOS/macOS) with Apple Wallet configured',
                    requires: ['Safari browser', 'iOS or macOS', 'Apple Wallet configured']
                },
                googlePay: {
                    available: true, // Backend supports it - frontend checks device
                    note: 'Available on Chrome/Edge with Google account and payment method',
                    requires: ['Chrome or Edge browser', 'Google account', 'Payment method in Google Wallet']
                }
            },
            currency: currency.toLowerCase(),
            stripeConfig: {
                publicKey: process.env.STRIPE_PUBLIC_KEY ? 
                    process.env.STRIPE_PUBLIC_KEY.substring(0, 7) + '...' : 'Not configured',
                mode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'production' : 'test'
            },
            message: 'Payment methods are enabled. Frontend should check device/browser compatibility using Stripe.js'
        });
    } catch (error) {
        logger.error('check_payment_methods_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to check payment methods',
            code: error.code || 'payment_method_check_failed'
        });
    }
});

/**
 * GET /api/payments/config
 * Check Stripe configuration status (does not expose keys)
 */
router.get('/config', async (req, res) => {
    try {
        const config = {
            success: true,
            stripe: {
                secretKeyConfigured: !!process.env.STRIPE_SECRET_KEY,
                publicKeyConfigured: !!process.env.STRIPE_PUBLIC_KEY,
                webhookSecretConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
                secretKeyPrefix: process.env.STRIPE_SECRET_KEY ? 
                    process.env.STRIPE_SECRET_KEY.substring(0, 7) + '...' : 'Not configured',
                publicKeyPrefix: process.env.STRIPE_PUBLIC_KEY ? 
                    process.env.STRIPE_PUBLIC_KEY.substring(0, 7) + '...' : 'Not configured',
                mode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'production' : 
                      process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? 'test' : 'unknown'
            },
            paymentMethods: {
                card: true,
                applePay: true,  // Enabled via automatic_payment_methods
                googlePay: true  // Enabled via automatic_payment_methods
            }
        };

        // Try to retrieve Apple Pay domain configuration from Stripe
        try {
            const applePayDomains = await stripe.applePayDomains.list({ limit: 10 });
            config.applePay = {
                enabled: true,
                domains: applePayDomains.data.map(domain => ({
                    domain: domain.domain_name,
                    id: domain.id,
                    created: new Date(domain.created * 1000).toISOString()
                }))
            };
        } catch (applePayError) {
            logger.warn('apple_pay_domains_list_failed', { message: applePayError.message });
            config.applePay = {
                enabled: true,
                note: 'Apple Pay is enabled. Domain verification status should be checked in Stripe Dashboard.'
            };
        }

        res.json(config);
    } catch (error) {
        logger.error('payments_config_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve configuration'
        });
    }
});

// Middleware to verify Stripe webhook signature
const verifyWebhookSignature = (req, res, next) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.warn('STRIPE_WEBHOOK_SECRET not configured — webhook verification disabled');
        return next();
    }

    if (!sig) {
        return res.status(400).json({
            success: false,
            error: 'Missing stripe-signature header'
        });
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            webhookSecret
        );
        req.stripeEvent = event;
        next();
    } catch (err) {
        console.error('Stripe webhook signature verification failed:', err.message);
        return res.status(400).json({
            success: false,
            error: `Webhook signature verification failed: ${err.message}`
        });
    }
};

// Raw body parser for webhook (Stripe requires raw body for signature verification)
router.post('/webhook', express.raw({ type: 'application/json' }), verifyWebhookSignature, async (req, res) => {
    try {
        const event = req.stripeEvent;

        devLog('Stripe webhook received', { type: event.type, id: event.id });

        // Handle different event types
        switch (event.type) {
            case 'payment_intent.succeeded':
                await handlePaymentIntentSucceeded(event.data.object);
                break;

            case 'payment_intent.payment_failed':
                await handlePaymentIntentFailed(event.data.object);
                break;

            case 'payment_intent.canceled':
                await handlePaymentIntentCanceled(event.data.object);
                break;

            case 'charge.refunded':
                await handleChargeRefunded(event.data.object);
                break;

            default:
                devLog('Stripe webhook unhandled event type', { type: event.type });
        }

        // Always return 200 to acknowledge receipt
        res.json({ received: true });
    } catch (error) {
        logger.error('stripe_webhook_handler_failed', { message: error.message });
        // Still return 200 to prevent Stripe from retrying
        res.status(200).json({ received: true, error: error.message });
    }
});

// Helper function to handle successful payment
// options.hintOrderId — from POST /confirm when client knows the real PM order id (metadata may still be TEMP)
async function handlePaymentIntentSucceeded(paymentIntent, options = {}) {
    const hintOrderId = options.hintOrderId || null;
    try {
        let resolvedOrderId = paymentIntent.metadata?.orderId || hintOrderId || null;

        // Find and update order (real orders are only created after payment succeeds)
        let findResult = resolvedOrderId
            ? await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--read',
                data: { orderId: resolvedOrderId }
            })
            : { success: false, data: null };

        let order = findResult.success ? normalizeReadFirst(findResult.data) : null;

        // If no real order exists yet, promote pending checkout draft into a real order now.
        if (!order) {
            const pending = await findPendingCheckoutForPaymentIntent(paymentIntent, hintOrderId);

            if (!pending || !pending.orderDraft) {
                logger.error('payment_webhook_succeeded_without_order', {
                    paymentIntentId: paymentIntent.id,
                    metadataOrderId: resolvedOrderId || null,
                    hintOrderId: hintOrderId || null,
                    amountCents: paymentIntent.amount,
                    currency: paymentIntent.currency
                });
                return;
            }

            const draft = pending.orderDraft;
            resolvedOrderId = draft.orderId || pending.orderId;
            const nowIso = new Date().toISOString();
            const promotedOrder = {
                ...draft,
                orderId: resolvedOrderId,
                status: 'processing',
                paymentStatus: 'succeeded',
                paymentIntentId: paymentIntent.id,
                stripeCustomerId: paymentIntent.customer || draft.stripeCustomerId || null,
                updatedAt: nowIso,
                timeline: [
                    ...(draft.timeline || []),
                    {
                        status: 'Payment Confirmed',
                        date: nowIso,
                        description: `Payment of ${(paymentIntent.amount / 100).toFixed(2)} ${paymentIntent.currency.toUpperCase()} confirmed`,
                        timestamp: nowIso
                    }
                ]
            };

            const createOrderResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--create',
                data: promotedOrder
            });

            if (!createOrderResult.success) {
                logger.error('payment_webhook_promote_order_failed', {
                    orderId: resolvedOrderId,
                    error: createOrderResult.error || String(createOrderResult)
                });
                return;
            }

            // Mark pending checkout completed (best-effort)
            try {
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'pending_checkouts',
                    command: '--update',
                    data: {
                        filter: { orderId: resolvedOrderId },
                        update: {
                            status: 'completed',
                            completedAt: nowIso,
                            paymentIntentId: paymentIntent.id,
                            updatedAt: nowIso
                        }
                    }
                });
            } catch (e) {
                logger.warn('payment_webhook_pending_checkout_close_failed', { message: e.message, orderId: resolvedOrderId });
            }

            order = promotedOrder;
        }

        resolvedOrderId = order.orderId || resolvedOrderId;

        // Keep Stripe metadata aligned with the real order id (fixes TEMP vs PM mismatch for dashboards/webhooks)
        if (resolvedOrderId && paymentIntent.metadata?.orderId !== resolvedOrderId) {
            try {
                await stripe.paymentIntents.update(paymentIntent.id, {
                    metadata: {
                        ...paymentIntent.metadata,
                        orderId: resolvedOrderId,
                        isTemporary: 'false',
                        updatedAt: new Date().toISOString()
                    }
                });
            } catch (metaErr) {
                logger.warn('payment_webhook_metadata_sync_failed', { message: metaErr.message });
            }
        }

        const orderId = resolvedOrderId;

        const normalizedEmail = (order.customer?.email || order.customerEmail || '').toLowerCase().trim();

        // Inventory deduction (best-effort but atomic per variant). Prevent oversells by deducting stock now.
        // If deduction fails (insufficient stock), issue an immediate refund and mark the order for review.
        const alreadyDeducted = order.inventoryDeductedAt || order.stockDeductedAt || order.inventoryDeducted === true;
        if (!alreadyDeducted) {
            try {
                const deductionResult = await deductInventoryForOrder(order);
                if (!deductionResult.success) {
                    logger.error('inventory_deduct_failed', { orderId: resolvedOrderId, result: deductionResult });
                    // Refund payment (payment already succeeded)
                    try {
                        await stripe.refunds.create({
                            payment_intent: paymentIntent.id
                        });
                        logger.warn('inventory_deduct_refund_issued', { paymentIntentId: paymentIntent.id, orderId: resolvedOrderId });
                    } catch (refundErr) {
                        logger.error('inventory_deduct_refund_failed', { message: refundErr.message, paymentIntentId: paymentIntent.id });
                    }
                    // Mark order as refunded/failed_stock
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'orders',
                        command: '--update',
                        data: {
                            filter: { orderId: resolvedOrderId },
                            update: {
                                paymentStatus: 'refunded',
                                status: 'canceled',
                                inventoryDeductedAt: new Date().toISOString(),
                                inventoryDeductionStatus: 'failed',
                                inventoryDeductionError: deductionResult.error || 'insufficient_stock',
                                updatedAt: new Date().toISOString(),
                                timeline: [
                                    ...(order.timeline || []),
                                    {
                                        status: 'Stock Deduction Failed',
                                        date: new Date().toISOString(),
                                        description: 'Payment was refunded because stock was unavailable at fulfillment time.',
                                        timestamp: new Date().toISOString()
                                    }
                                ]
                            }
                        }
                    });
                    return;
                }
                // Record deduction success on order (idempotency for duplicate webhooks)
                order.inventoryDeductedAt = new Date().toISOString();
                order.inventoryDeductionStatus = 'succeeded';
            } catch (dedErr) {
                logger.error('inventory_deduct_exception', { message: dedErr.message, orderId: resolvedOrderId });
            }
        }

        // Update order with payment status
        const updateData = {
            paymentStatus: 'succeeded',
            paymentIntentId: paymentIntent.id,
            updatedAt: new Date().toISOString(),
            timeline: [
                ...(order.timeline || []),
                {
                    status: 'Payment Confirmed',
                    date: new Date().toISOString(),
                    description: `Payment of ${(paymentIntent.amount / 100).toFixed(2)} ${paymentIntent.currency.toUpperCase()} confirmed`,
                    timestamp: new Date().toISOString()
                }
            ]
        };

        if (order.inventoryDeductedAt) {
            updateData.inventoryDeductedAt = order.inventoryDeductedAt;
            updateData.inventoryDeductionStatus = order.inventoryDeductionStatus || 'succeeded';
        }

        // Canonical totals (backend source of truth). Prefer the exact snapshot stored in PaymentIntent metadata
        // to avoid using stale draft values for shipping/discount that can differ from what the customer paid.
        try {
            const meta = paymentIntent.metadata || {};
            const parsedShipping = meta.shippingGross != null ? Number(meta.shippingGross) : NaN;
            const parsedDiscount = meta.discountAmount != null ? Number(meta.discountAmount) : NaN;
            const parsedVatRate = meta.vatRate != null ? Number(meta.vatRate) : NaN;
            const metaCountry = meta.country != null ? String(meta.country) : undefined;

            const canonicalTotals = computeCanonicalOrderTotals(order, {
                shippingGross: !isNaN(parsedShipping) ? parsedShipping : undefined,
                discountAmount: !isNaN(parsedDiscount) ? parsedDiscount : undefined,
                vatRate: !isNaN(parsedVatRate) ? parsedVatRate : undefined,
                country: metaCountry || undefined
            });
            updateData.totals = canonicalTotals;
            updateData.currency = 'SEK';
            updateData.totalsCalculatedAt = new Date().toISOString();
            updateData.totalsEngine = 'checkoutTotalsService';
            // Also persist shipping/discount snapshot fields explicitly for easier debugging
            if (!isNaN(parsedShipping)) updateData.shippingCost = parsedShipping;
            if (!isNaN(parsedDiscount)) updateData.discountAmount = parsedDiscount;
        } catch (totErr) {
            logger.warn('payment_webhook_canonical_totals_failed', { orderId, message: totErr.message });
        }

        // Add Stripe customer ID if available
        if (paymentIntent.customer) {
            updateData.stripeCustomerId = paymentIntent.customer;
        }

        // Update order status if it was pending payment
        if (order.status === 'pending' || order.status === 'processing') {
            updateData.status = 'processing';
        }

        if (paymentIntent.latest_charge && process.env.STRIPE_SECRET_KEY) {
            try {
                const charge = await stripe.charges.retrieve(paymentIntent.latest_charge);
                const last4 = charge?.payment_method_details?.card?.last4;
                if (last4) updateData.paymentCardLast4 = last4;
            } catch (chargeErr) {
                logger.warn('payment_webhook_card_last4_failed', { orderId, message: chargeErr.message });
            }
        }

        // Mark any failed checkouts as completed if payment succeeded
        const paymentFailureService = require('../services/paymentFailureService');
        try {
            // Try to find failed checkout by orderId and mark as completed
            // (Note: This is a best-effort cleanup, failed checkouts use retryToken primarily)
            // The main check happens in the background job which won't send emails for completed checkouts
        } catch (error) {
            // Non-critical, continue with order processing
        }

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: updateData
            }
        });

        // Send confirmation/receipt emails asynchronously to avoid slowing down webhook ack or /payments/confirm.
        setImmediate(async () => {
            // Confirmation + PDF receipt: receipt must run even if confirmation was already sent (e.g. PDF failed once;
            // previously the whole block was skipped when emailSent was true, so receipt never retried.)
            const custEmail = order.customer?.email;
            const paidNow = order.paymentStatus === 'succeeded' || updateData.paymentStatus === 'succeeded';

            if (!custEmail) {
                logger.warn('payment_webhook_no_customer_email', { orderId });
                return;
            }
            if (!paidNow) {
                logger.warn('payment_webhook_skip_email_wrong_status', { orderId, paymentStatus: order.paymentStatus });
                return;
            }

            const customerName = order.customer.name ||
                `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() ||
                order.customerName ||
                'Valued Customer';
            const orderLanguage = order.language || 'en';

            let confirmationJustSent = false;
            if (!order.emailSent) {
                try {
                    devLog('payment_webhook_send_confirmation', { orderId });
                    const emailResult = await emailService.sendOrderConfirmationEmail(
                        custEmail,
                        customerName,
                        order,
                        orderLanguage
                    );
                    if (emailResult && emailResult.success) {
                        await db.executeOperation({
                            database_name: 'peakmode',
                            collection_name: 'orders',
                            command: '--update',
                            data: {
                                filter: { orderId },
                                update: { emailSent: true }
                            }
                        });
                        confirmationJustSent = true;
                        devLog('payment_webhook_confirmation_sent', { orderId });
                    } else {
                        logger.error('order_confirmation_email_failed', {
                            orderId,
                            error: emailResult?.error,
                            details: emailResult?.details
                        });
                    }
                } catch (emailError) {
                    logger.error('order_confirmation_email_exception', {
                        orderId,
                        message: emailError.message
                    });
                    devWarn(emailError.stack);
                }
            } else {
                devLog('payment_webhook_confirmation_already_sent', { orderId });
            }

            const confirmationOk = !!order.emailSent || confirmationJustSent;
            if (!order.receiptEmailSent && confirmationOk) {
                // Track receipt attempts in DB so failures are visible even if logs are hard to access
                try {
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'orders',
                        command: '--update',
                        data: {
                            filter: { orderId },
                            update: {
                                receiptEmailLastAttemptAt: new Date().toISOString(),
                                receiptEmailAttempts: (order.receiptEmailAttempts || 0) + 1
                            }
                        }
                    });
                } catch (e) {
                    logger.warn('payment_webhook_receipt_metadata_failed', { orderId, message: e.message });
                }

                try {
                    const receiptPdfService = require('../services/receiptPdfService');
                    const orderForReceipt = {
                        ...order,
                        ...updateData,
                        emailSent: true,
                        paymentCardLast4: updateData.paymentCardLast4 || order.paymentCardLast4
                    };
                    await receiptPdfService.ensureInvoiceNumberOnOrder(orderForReceipt, db);
                    const invoiceNumber = orderForReceipt.invoiceNumber || receiptPdfService.stableInvoiceNumber(orderId);
                    orderForReceipt.invoiceNumber = invoiceNumber;
                    const { buffer, filename } = await receiptPdfService.generateReceiptPdfBuffer(orderForReceipt);
                    const receiptResult = await emailService.sendOrderReceiptEmail(
                        custEmail,
                        customerName,
                        orderForReceipt,
                        orderLanguage,
                        buffer,
                        filename
                    );
                    if (receiptResult.success) {
                        await db.executeOperation({
                            database_name: 'peakmode',
                            collection_name: 'orders',
                            command: '--update',
                            data: {
                                filter: { orderId },
                                update: {
                                    receiptEmailSent: true,
                                    receiptSentAt: new Date().toISOString(),
                                    receiptEmailLastError: null,
                                    invoiceNumber
                                }
                            }
                        });
                        devLog('payment_webhook_receipt_pdf_sent', { orderId });
                    } else {
                        logger.error('receipt_email_failed', { orderId, error: receiptResult.error });
                        try {
                            await db.executeOperation({
                                database_name: 'peakmode',
                                collection_name: 'orders',
                                command: '--update',
                                data: {
                                    filter: { orderId },
                                    update: {
                                        receiptEmailLastError: `send_failed: ${receiptResult.error || 'unknown'}`,
                                        receiptEmailLastErrorAt: new Date().toISOString()
                                    }
                                }
                            });
                        } catch (e) {
                            // ignore
                        }
                    }
                } catch (receiptErr) {
                    logger.error('receipt_pdf_failed', { orderId, message: receiptErr.message });
                    devWarn(receiptErr.stack);
                    try {
                        await db.executeOperation({
                            database_name: 'peakmode',
                            collection_name: 'orders',
                            command: '--update',
                            data: {
                                filter: { orderId },
                                update: {
                                    receiptEmailLastError: `exception: ${receiptErr.message || String(receiptErr)}`,
                                    receiptEmailLastErrorAt: new Date().toISOString()
                                }
                            }
                        });
                    } catch (e) {
                        // ignore
                    }

                    // Fallback: still send a receipt-style email without attachment so the customer receives something
                    // and we can distinguish PDF/Puppeteer issues from SendGrid delivery issues.
                    try {
                        const orderForFallback = { ...order, ...updateData, emailSent: true };
                        const fallbackResult = await emailService.sendOrderReceiptEmailNoAttachment(
                            custEmail,
                            customerName,
                            orderForFallback,
                            orderLanguage
                        );
                        if (fallbackResult.success) {
                            await db.executeOperation({
                                database_name: 'peakmode',
                                collection_name: 'orders',
                                command: '--update',
                                data: {
                                    filter: { orderId },
                                    update: {
                                        receiptEmailFallbackSent: true,
                                        receiptEmailFallbackSentAt: new Date().toISOString(),
                                        receiptEmailFallbackMessageId: fallbackResult.messageId || null
                                    }
                                }
                            });
                            devLog('payment_webhook_receipt_fallback_sent', { orderId });
                        } else {
                            logger.error('receipt_fallback_failed', {
                                orderId,
                                error: fallbackResult.error,
                                details: fallbackResult.details
                            });
                        }
                    } catch (fallbackErr) {
                        logger.error('receipt_fallback_exception', { orderId, message: fallbackErr.message });
                    }
                }
            } else if (order.receiptEmailSent) {
                devLog('payment_webhook_receipt_already_sent', { orderId });
            }
        });

        // Mark abandoned checkout as completed (if exists)
        if (normalizedEmail) {
            try {
                const checkoutResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'abandoned_checkouts',
                    command: '--read',
                    data: {
                        email: normalizedEmail,
                        status: 'pending'
                    }
                });

                if (checkoutResult.success && checkoutResult.data) {
                    const checkouts = Array.isArray(checkoutResult.data) ? checkoutResult.data : [checkoutResult.data];
                    
                    // Mark all pending checkouts for this email as completed
                    for (const checkout of checkouts) {
                        await db.executeOperation({
                            database_name: 'peakmode',
                            collection_name: 'abandoned_checkouts',
                            command: '--update',
                            data: {
                                filter: { id: checkout.id },
                                update: {
                                    status: 'completed',
                                    completedAt: new Date().toISOString(),
                                    orderId: orderId,
                                    updatedAt: new Date().toISOString()
                                }
                            }
                        });
                        
                        devLog('payment_webhook_abandoned_checkout_completed', { checkoutId: checkout.id, orderId });
                    }
                }
            } catch (checkoutError) {
                // Don't fail if checkout update fails - this is not critical
                logger.warn('payment_webhook_abandoned_checkout_update_failed', { message: checkoutError.message, orderId });
            }
        }

        // Mark failed checkout as completed (if retry succeeded)
        // Check order metadata for retryToken
        if (order.isRetry && order.retryToken) {
            try {
                const paymentFailureService = require('../services/paymentFailureService');
                const marked = await paymentFailureService.markFailedCheckoutCompleted(order.retryToken);
                if (marked) {
                    devLog('payment_webhook_failed_checkout_cleared', { orderId, retryToken: order.retryToken });
                }
            } catch (error) {
                // Don't fail if failed checkout update fails - this is not critical
                logger.warn('payment_webhook_failed_checkout_clear_failed', { message: error.message, orderId });
            }
        }

        // CRITICAL: Mark discount code as used ONLY after successful payment
        // This ensures codes remain valid if payment fails
        if (order.appliedDiscount?.code) {
            try {
                const discountService = require('../services/discountService');
                const markResult = await discountService.markDiscountCodeAsUsed(
                    order.appliedDiscount.code,
                    orderId
                );
                
                if (markResult.success) {
                    devLog('payment_webhook_discount_marked_used', { orderId, code: order.appliedDiscount.code });
                } else {
                    logger.warn('discount_mark_used_failed', {
                        orderId,
                        code: order.appliedDiscount.code,
                        error: markResult.error,
                        errorCode: markResult.errorCode,
                        conflict: markResult.conflict === true
                    });
                }
            } catch (error) {
                // Don't fail payment processing if discount marking fails - log error but continue
                logger.warn('discount_mark_used_exception', { orderId, message: error.message });
            }
        }

        devLog('payment_webhook_order_confirmed', { orderId });
    } catch (error) {
        logger.error('payment_intent_succeeded_handler_failed', { message: error.message });
        devWarn(error.stack);
        throw error;
    }
}

// Helper function to handle failed payment
async function handlePaymentIntentFailed(paymentIntent) {
    try {
        const orderId = paymentIntent.metadata.orderId;
        if (!orderId) {
            logger.warn('payment_intent_failed_no_order_id_metadata', { paymentIntentId: paymentIntent.id });
            return;
        }

        // Get order to update
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });

        if (!findResult.success || !findResult.data) {
            logger.warn('payment_failure_webhook_order_missing', { orderId });
            return;
        }

        const order = findResult.data;

        // Update order with failed payment status
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: {
                    paymentStatus: 'failed',
                    paymentIntentId: paymentIntent.id,
                    paymentFailedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    timeline: [
                        ...(order.timeline || []),
                        {
                            status: 'Payment Failed',
                            date: new Date().toISOString(),
                            description: `Payment failed: ${paymentIntent.last_payment_error?.message || 'Unknown error'}`,
                            timestamp: new Date().toISOString()
                        }
                    ]
                }
            }
        });

        devLog('payment_failure_webhook', { orderId });

        // Save failed checkout to failed_checkouts collection
        // Background job will send email after 3 minutes
        const paymentFailureService = require('../services/paymentFailureService');
        const saveResult = await paymentFailureService.saveFailedCheckout(paymentIntent, order);

        if (saveResult?.success) {
            devLog('failed_checkout_saved', { orderId, failedCheckoutId: saveResult.failedCheckoutId });
        } else {
            logger.error('failed_checkout_save_error', { orderId, error: saveResult?.error });
        }
    } catch (error) {
        logger.error('payment_intent_payment_failed_handler_error', { message: error.message });
        devWarn(error.stack);
        throw error;
    }
}

// Helper function to handle canceled payment
async function handlePaymentIntentCanceled(paymentIntent) {
    try {
        const orderId = paymentIntent.metadata.orderId;
        if (!orderId) return;

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: {
                    paymentStatus: 'canceled',
                    updatedAt: new Date().toISOString()
                }
            }
        });

        devLog('payment_intent_canceled_webhook', { orderId });
    } catch (error) {
        logger.error('payment_intent_canceled_handler_error', { message: error.message });
        devWarn(error.stack);
        throw error;
    }
}

// Helper function to handle refund
async function handleChargeRefunded(charge) {
    try {
        const paymentIntentId = charge.payment_intent;
        if (!paymentIntentId) return;

        // Find order by payment intent ID
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { paymentIntentId }
        });

        if (!findResult.success || !findResult.data) {
            logger.warn('refund_webhook_order_not_found', { paymentIntentId });
            return;
        }

        const order = findResult.data;

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId: order.orderId },
                update: {
                    paymentStatus: 'refunded',
                    updatedAt: new Date().toISOString(),
                    timeline: [
                        ...(order.timeline || []),
                        {
                            status: 'Refunded',
                            date: new Date().toISOString(),
                            description: `Payment refunded: ${(charge.amount_refunded / 100).toFixed(2)} ${charge.currency.toUpperCase()}`,
                            timestamp: new Date().toISOString()
                        }
                    ]
                }
            }
        });

        devLog('charge_refunded_webhook', { orderId: order.orderId });
    } catch (error) {
        logger.error('charge_refunded_handler_error', { message: error.message });
        devWarn(error.stack);
        throw error;
    }
}

/**
 * POST /api/payments/create-intent
 * Create a Stripe payment intent for checkout.
 * Payment amount is ALWAYS derived from backend-calculated cart totals.
 * Frontend must NOT send amount, subtotal, tax, or total; those are ignored.
 *
 * Body (allowed):
 *   userId (required)
 *   cartId (optional)
 *   shippingMethodId, shippingMethod (optional – id + { id, type, ... } for zone pricing)
 *   shippingAddress (optional – for zone/country)
 *   discountCode (optional)
 *   customerEmail, orderId, metadata (optional – for Stripe/customer)
 */

/**
 * GET /api/payments/checkout-navigation
 * Returns checkoutNavigation URLs (payment failed, confirm return URL) without creating a PI.
 * Use when Stripe.js throws client-side after confirmPayment (e.g. payment_intent_authentication_failure)
 * and the SPA no longer has checkoutNavigation from create-intent in memory.
 *
 * Query (optional): stripeCode — e.g. payment_intent_authentication_failure → maps to failureCategory
 */
router.get('/checkout-navigation', (req, res) => {
    try {
        let failureHint = null;
        const rawCode = req.query.stripeCode || req.query.code;
        if (rawCode && typeof rawCode === 'string') {
            const { failureCategory } = classifyPaymentFailure({ code: rawCode.trim() });
            failureHint = failureCategory;
        }
        return res.json({
            success: true,
            purpose: 'Use after any terminal Stripe customer-facing error before navigate to paymentFailedUrl',
            ...checkoutNavigationExtras({ shouldRedirectToFailurePage: Boolean(failureHint), failureHint })
        });
    } catch (error) {
        logger.error('checkout_navigation_error', { message: error.message });
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to build checkout navigation'
        });
    }
});

/**
 * POST /api/payments/prepare-confirmation
 * Last-gate endpoint right before redirecting to Klarna / confirming PaymentElement.
 *
 * Ensures the PaymentIntent amount/metadata matches the latest backend cart totals.
 * If the provided intent cannot be updated, creates a new one.
 *
 * Body:
 * - userId (required)
 * - paymentIntentId (optional; when present we try to update)
 * - shippingAddress, shippingMethod/shippingMethodId (required to compute totals)
 * - discountCode (optional)
 * - orderId (optional; may be TEMP)
 */
router.post('/prepare-confirmation', async (req, res) => {
    const idempotencyKey = ensureIdempotencyKey(req);
    try {
        const body = req.body || {};
        requireFields(body, ['userId'], { userMessage: 'Something went wrong. Please refresh and try again.' });

        const userId = body.userId;
        const paymentIntentId = body.paymentIntentId || null;
        const orderIdIncoming = body.orderId || null;
        const shippingAddress = body.shippingAddress || body.customer;
        let shippingMethod = body.shippingMethod || (body.shippingMethodId ? { id: body.shippingMethodId, type: body.shippingMethodType } : null);
        if ((!shippingMethod || typeof shippingMethod !== 'object') && body.deliveryOption && typeof body.deliveryOption === 'object') {
            const d = body.deliveryOption;
            shippingMethod = {
                id: d.id,
                shippingMethodId: d.shippingMethodId,
                methodId: d.methodId,
                _id: d._id,
                type: d.type
            };
        }
        const discountCode = body.discountCode || null;

        const hasShippingAddress = !!(shippingAddress && String(extractShippingCountryRaw(shippingAddress) || '').trim());
        const hasShippingMethodHint =
            !!(shippingMethod &&
                (shippingMethod.id ||
                    shippingMethod.shippingMethodId ||
                    shippingMethod.methodId ||
                    shippingMethod._id)) ||
            !!(body.shippingMethodId || body.methodId) ||
            !!(body.deliveryOption &&
                (body.deliveryOption.id || body.deliveryOption.methodId || body.deliveryOption._id));
        if (!hasShippingAddress || !hasShippingMethodHint) {
            throw new AppError({
                code: ErrorCodes.VALIDATION_FAILED,
                httpStatus: 400,
                severity: 'warn',
                message: 'Shipping address and method required before confirmation',
                userMessage: 'Please enter your delivery address and select a shipping method before paying.',
                details: { hasShippingAddress, hasShippingMethod: hasShippingMethodHint }
            });
        }

        const { cart, totals, shippingQuote, shippingVersion, discountDropped, clearedDiscountCode } = await withRetry(
            () =>
                computeCheckoutTotalsForUser({
                    req,
                    userId,
                    shippingAddress,
                    shippingMethod,
                    discountCode,
                    checkoutContextBody: body,
                    tolerateInvalidDiscount: true
                }),
            { retries: 2 }
        );
        const cartVersion = computeCartVersion(
            buildCartVersionSource({ cart, shippingAddress, shippingMethod, discountCode })
        );

        const validatedAmount = totals.total;
        if (validatedAmount <= 0) {
            throw new AppError({
                code: ErrorCodes.VALIDATION_FAILED,
                httpStatus: 400,
                severity: 'warn',
                message: 'Invalid amount calculated from cart',
                userMessage: 'We could not calculate the order total. Please review your cart and try again.',
                details: { validatedAmount }
            });
        }

        const currencyLower = 'sek';
        const amountInCents = Math.round(validatedAmount * 100);

        const baseMetadata = {
            // keep an order identifier for thank-you canonical totals (TEMP ok)
            orderId: orderIdIncoming || `TEMP-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            isTemporary: (!orderIdIncoming || String(orderIdIncoming).startsWith('TEMP-')).toString(),
            shippingGross: String(totals.shippingGross || 0),
            discountAmount: String(totals.discountAmount || 0),
            vatRate: String(totals.vatRate || 0.25),
            country: String(totals.country || ''),
            total: String(totals.total || validatedAmount || 0),
            preparedAt: new Date().toISOString()
        };

        let intent = null;
        let action = 'created';

        if (paymentIntentId) {
            intent = await stripe.paymentIntents.retrieve(paymentIntentId);
            const updateable = intent.status === 'requires_payment_method' || intent.status === 'requires_confirmation';
            if (updateable) {
                action = 'updated';
                intent = await stripe.paymentIntents.update(
                    paymentIntentId,
                    {
                        amount: amountInCents,
                        currency: currencyLower,
                        metadata: { ...intent.metadata, ...baseMetadata },
                        ...getPaymentIntentSecurityOptions()
                    },
                    { idempotencyKey }
                );
            } else {
                logger.warn('prepare_confirmation_intent_not_updateable', {
                    requestId: req.requestId,
                    paymentIntentId,
                    status: intent.status
                });
                intent = null;
            }
        }

        if (!intent) {
            // Create a fresh intent (client must use returned clientSecret)
            intent = await stripe.paymentIntents.create(
                {
                    amount: amountInCents,
                    currency: currencyLower,
                    metadata: baseMetadata,
                    ...getPaymentIntentSecurityOptions()
                },
                { idempotencyKey }
            );
            action = 'created';
        }

        if (!intent.client_secret) {
            throw new AppError({
                code: ErrorCodes.STRIPE_ERROR,
                httpStatus: 500,
                severity: 'error',
                message: 'Stripe PaymentIntent missing client_secret',
                userMessage: 'We could not prepare the payment. Please try again.',
                details: { paymentIntentId: intent.id, status: intent.status }
            });
        }

        return res.json({
            success: true,
            action,
            userId,
            paymentIntentId: intent.id,
            clientSecret: intent.client_secret,
            amount: validatedAmount,
            currency: currencyLower,
            totals,
            cartVersion,
            shippingVersion,
            shippingQuote,
            ...(discountDropped
                ? { discountDropped: true, clearedDiscountCode: clearedDiscountCode || null }
                : {}),
            // Frontend should always use this before confirmPayment/redirect for provider parity
            mustUseBeforeConfirm: true,
            ...checkoutNavigationExtras({ paymentIntent: intent })
        });
    } catch (err) {
        // Keep response shape compatible with existing clients but provide /core-like details
        const msg = err?.message || 'prepare-confirmation failed';
        logger.error('prepare_confirmation_failed', {
            requestId: req.requestId,
            idempotencyKey,
            message: msg,
            code: err?.code,
            details: err?.details
        });
        const httpStatus = err?.httpStatus && Number.isFinite(err.httpStatus) ? err.httpStatus : 500;
        return res.status(httpStatus).json({
            success: false,
            error: msg,
            code: err?.code || 'prepare_confirmation_failed',
            userMessage: err?.userMessage || 'We could not prepare your payment. Please try again.',
            requestId: req.requestId || req.headers['x-request-id'] || null,
            details: err?.details,
            ...checkoutNavigationExtras({ shouldRedirectToFailurePage: true })
        });
    }
});

router.post('/create-intent', async (req, res) => {
    try {
        const body = req.body || {};
        // Allowed fields; any amount/totals from frontend are ignored
        const userId = body.userId;
        const customerEmail = body.customerEmail;
        const orderId = body.orderId;
        const metadata = body.metadata || {};
        const shippingAddress = body.shippingAddress || body.customer;
        const shippingMethod = body.shippingMethod || (body.shippingMethodId ? { id: body.shippingMethodId, type: body.shippingMethodType } : null);
        const discountCode = body.discountCode || null;

        const userAgent = req.headers['user-agent'] || '';
        const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
        const deviceInfo = {
            isMobile,
            userAgent: userAgent.substring(0, 100),
            platform: isMobile ? 'mobile' : 'desktop'
        };
        
        devLog('create-intent request', { platform: deviceInfo.platform });

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId is required to create payment intent',
                errorCode: 'MISSING_USER_ID',
                userMessage: 'Something went wrong. Please refresh the page and try again.'
            });
        }

        // Require shipping address and method before creating payment (payment must only start when user clicks "Complete my order")
        const hasShippingAddress = shippingAddress && (shippingAddress.country || shippingAddress.countryCode);
        if (!hasShippingAddress) {
            return res.status(400).json({
                success: false,
                error: 'Shipping address with country is required',
                errorCode: 'MISSING_SHIPPING_ADDRESS',
                userMessage: 'Please enter your delivery address and country before completing your order.'
            });
        }
        const hasShippingMethod = shippingMethod && (shippingMethod.id || body.shippingMethodId);
        if (!hasShippingMethod) {
            return res.status(400).json({
                success: false,
                error: 'Shipping method is required',
                errorCode: 'MISSING_SHIPPING_METHOD',
                userMessage: 'Please select a shipping method before completing your order.'
            });
        }

        // Load current cart from database (single source of truth for items and pricing)
        const cartResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });

        let cart = null;
        if (cartResult.success && cartResult.data) {
            cart = Array.isArray(cartResult.data) ? cartResult.data[0] : cartResult.data;
        }
        if (!cart || !cart.items || !Array.isArray(cart.items) || cart.items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Cart not found or empty. Add items to cart before creating payment intent.',
                errorCode: 'CART_EMPTY_OR_MISSING',
                userMessage: 'Your cart is empty. Please add items before completing your order.'
            });
        }

        const checkoutTotalsService = require('../services/checkoutTotalsService');
        const discountService = require('../services/discountService');
        const vatService = require('../services/vatService');
        const shippingConfigService = require('../services/shippingConfigService');

        // Normalize country to ISO 2-letter code (frontend may send "Sweden" or "SE") so zone lookup works
        const countryForZone = normalizeCountryCode((shippingAddress && (shippingAddress.country || shippingAddress.countryCode)) ? String(shippingAddress.country || shippingAddress.countryCode) : '');

        // Shipping country overrides IP for final VAT (checkout rule)
        const shippingCountry = countryForZone || vatService.getCountryFromRequest(req);
        const countryForVat = shippingCountry || vatService.getCountryFromRequest(req);
        const vatRate = vatService.getVatRate(countryForVat);

        // Shipping cost: admin/DB only; never trust frontend amount
        let shippingCost = 0;
        if (shippingAddress && shippingMethod) {
            const methodId = shippingMethod.id || shippingMethod.shippingMethodId || (shippingMethod._id && shippingMethod._id.toString());
            const municipality = (shippingAddress.municipality || shippingAddress.city || '').trim();
            shippingCost = await shippingConfigService.getShippingCostFromDb(countryForZone, methodId, municipality);
            if (shippingCost <= 0 && cart.totals && (typeof cart.totals.shippingGross === 'number' || typeof cart.totals.shipping === 'number')) {
                shippingCost = cart.totals.shippingGross ?? cart.totals.shipping ?? 0;
            }
        }
        if (shippingCost <= 0 && cart.totals && (typeof cart.totals.shippingGross === 'number' || typeof cart.totals.shipping === 'number')) {
            shippingCost = cart.totals.shippingGross ?? cart.totals.shipping ?? 0;
        }

        const effectiveDiscountCode = discountService.pickEffectiveDiscountCode(discountCode, cart);
        const discountResolution = await discountService.validateAndComputeDiscountAmount(
            sumCartProductGross(cart.items),
            shippingCost,
            effectiveDiscountCode
        );
        if (!discountResolution.ok) {
            return res.status(400).json({
                success: false,
                code: discountResolution.errorCode,
                error: discountResolution.error,
                userMessage: discountResolution.userMessage,
                requestId: req.requestId || req.headers['x-request-id'] || null,
                details: { discountCode: effectiveDiscountCode }
            });
        }
        const discountAmount = discountResolution.discountAmount;

        const totals = checkoutTotalsService.calculateTotals(
            cart.items,
            shippingCost,
            discountAmount,
            'SEK',
            vatRate,
            { country: countryForVat }
        );
        const validatedAmount = totals.total;
        const currency = 'SEK';

        if (validatedAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid payment amount calculated from cart',
                errorCode: 'INVALID_AMOUNT',
                userMessage: 'We could not calculate the order total. Please check your cart and try again.'
            });
        }
        
        devLog('create-intent validated amount', { amount: validatedAmount, currency });

        // orderId is now optional - can be temporary or added later
        // If not provided, generate a temporary ID
        const tempOrderId = orderId || `TEMP-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const isTemporaryOrderId = !orderId || orderId.startsWith('TEMP-');

        // Convert validated amount to cents
        const amountInCents = Math.round(validatedAmount * 100);

        // Prepare payment intent metadata (used later as an immutable audit trail for totals shown on thank-you/PDF)
        const paymentMetadata = {
            orderId: tempOrderId,
            isTemporary: isTemporaryOrderId.toString(),
            // Canonical checkout totals snapshot (strings for Stripe metadata)
            shippingGross: String(totals.shippingGross || 0),
            discountAmount: String(totals.discountAmount || 0),
            vatRate: String(totals.vatRate || vatRate || 0.25),
            country: String(totals.country || countryForVat || ''),
            total: String(totals.total || validatedAmount || 0),
            ...metadata
        };

        // Prepare payment intent parameters for SCA compliance and Payment Request API
        // PaymentElement REQUIRES automatic_payment_methods to be enabled (not payment_method_types)
        // This allows Stripe to dynamically determine which payment methods to show based on:
        // - Customer location, device capabilities, browser support, payment method availability
        const currencyLower = currency.toLowerCase();
        
        // Ensure minimum amount for payment intent (Stripe requires at least 1 unit in smallest currency unit)
        if (amountInCents < 1) {
            return res.status(400).json({
                success: false,
                error: 'Amount must be at least 0.01 in the specified currency',
                userMessage: 'The order total is too low. Please add items to your cart.'
            });
        }

        const paymentIntentParams = {
            amount: amountInCents,
            currency: currencyLower,
            metadata: paymentMetadata,
            // Cards: request 3DS whenever supported (issuer/bank portal) before capture.
            // Wallets / Klarna: automatic_payment_methods + allow_redirects (issuer/hosted flows).
            ...getPaymentIntentSecurityOptions()
            // PaymentElement: confirm only on submit; 3DS and redirects run inside confirmPayment().
        };

        // Add customer if email provided
        if (customerEmail) {
            try {
                // Get or create Stripe customer
                const customers = await stripe.customers.list({
                    email: customerEmail,
                    limit: 1
                });

                let customerId;
                if (customers.data.length > 0) {
                    customerId = customers.data[0].id;
                } else {
                    const customer = await stripe.customers.create({
                        email: customerEmail,
                        metadata: { orderId: tempOrderId }
                    });
                    customerId = customer.id;
                }

                paymentIntentParams.customer = customerId;
            } catch (customerError) {
                logger.warn('stripe_customer_attach_failed', {
                    message: customerError.message,
                    code: customerError.code
                });
                // Continue without customer - not critical
            }
        }

        // Create payment intent (amount is always backend-calculated from cart)
        devLog('Creating payment intent', {
            orderId: tempOrderId,
            amount: validatedAmount,
            currency,
            cents: amountInCents,
            platform: deviceInfo.platform
        });
        const logParams = {
            amount: amountInCents,
            currency: currencyLower,
            automatic_payment_methods: paymentIntentParams.automatic_payment_methods,
            payment_method_options: paymentIntentParams.payment_method_options,
            has_customer: !!paymentIntentParams.customer,
            has_metadata: !!paymentIntentParams.metadata,
            device: deviceInfo.platform
        };
        devLog('Payment intent params', logParams);
        
        // CRITICAL: Verify automatic_payment_methods is set correctly
        if (!paymentIntentParams.automatic_payment_methods || !paymentIntentParams.automatic_payment_methods.enabled) {
            logger.error('payment_intent_config_automatic_methods_disabled');
            return res.status(500).json({
                success: false,
                error: 'Payment intent configuration error: automatic_payment_methods must be enabled',
                code: 'invalid_payment_intent_config',
                userMessage: 'Payment is temporarily unavailable. Please try again later.'
            });
        }
        
        // CRITICAL: Verify payment_method_types is NOT set (conflicts with automatic_payment_methods)
        if (paymentIntentParams.payment_method_types) {
            logger.error('payment_intent_config_method_types_conflict');
            return res.status(500).json({
                success: false,
                error: 'Payment intent configuration error: Cannot use both payment_method_types and automatic_payment_methods',
                code: 'conflicting_payment_method_config',
                userMessage: 'Payment is temporarily unavailable. Please try again later.'
            });
        }
        
        const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
        
        // CRITICAL: Validate payment intent was created correctly
        if (!paymentIntent.client_secret) {
            logger.error('payment_intent_missing_client_secret');
            return res.status(500).json({
                success: false,
                error: 'Payment intent created but client secret is missing',
                code: 'missing_client_secret',
                userMessage: 'Something went wrong starting the payment. Please try again.'
            });
        }
        
        // CRITICAL: Validate status is requires_payment_method (required for PaymentElement)
        if (paymentIntent.status !== 'requires_payment_method') {
            logger.error('payment_intent_bad_status', {
                status: paymentIntent.status,
                expected: 'requires_payment_method'
            });
            return res.status(500).json({
                success: false,
                error: `Payment intent status is ${paymentIntent.status}, expected 'requires_payment_method' for PaymentElement`,
                code: 'invalid_payment_intent_status',
                actualStatus: paymentIntent.status,
                expectedStatus: 'requires_payment_method',
                userMessage: 'Something went wrong starting the payment. Please try again.'
            });
        }
        
        // CRITICAL: Validate automatic_payment_methods is enabled (required for PaymentElement)
        if (!paymentIntent.automatic_payment_methods?.enabled) {
            logger.error('payment_intent_automatic_methods_not_enabled');
            return res.status(500).json({
                success: false,
                error: 'Payment intent created but automatic_payment_methods is not enabled. PaymentElement requires this.',
                code: 'automatic_payment_methods_not_enabled',
                automatic_payment_methods: paymentIntent.automatic_payment_methods,
                userMessage: 'Something went wrong starting the payment. Please try again.'
            });
        }
        
        // CRITICAL: Verify payment_method_types is NOT present (conflicts with automatic_payment_methods)
        if (paymentIntent.payment_method_types && paymentIntent.payment_method_types.length > 0) {
            logger.warn('payment_intent_has_payment_method_types', {
                types: paymentIntent.payment_method_types
            });
        }
        
        devLog('payment_intent.created', {
            id: paymentIntent.id,
            status: paymentIntent.status,
            amountCents: paymentIntent.amount,
            currency: paymentIntent.currency,
            threeDS: paymentIntent.payment_method_options?.card?.request_three_d_secure || null,
            automatic_payment_methods: paymentIntent.automatic_payment_methods,
            payment_method_types: paymentIntent.payment_method_types
        });

        // Update order with payment intent ID (only if order exists, not for temporary IDs)
        if (!isTemporaryOrderId) {
            try {
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'orders',
                    command: '--update',
                    data: {
                        filter: { orderId: tempOrderId },
                        update: {
                            paymentIntentId: paymentIntent.id,
                            paymentStatus: 'pending',
                            updatedAt: new Date().toISOString()
                        }
                    }
                });
            } catch (dbError) {
                logger.warn('order_payment_intent_link_failed', {
                    message: dbError.message,
                    orderId: tempOrderId
                });
                // Continue even if order update fails - order might not exist yet
            }
        }

        // Get actual payment method types from the created payment intent
        // With automatic_payment_methods, Stripe determines available methods dynamically
        const actualPaymentMethodTypes = paymentIntent.payment_method_types || [];
        
        res.json({
            success: true,
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.client_secret,
            amount: validatedAmount,
            currency: currency.toLowerCase(),
            orderId: tempOrderId,
            isTemporary: isTemporaryOrderId,
            status: paymentIntent.status,
            // Frontend contract: enforce correct UX (see docs/FRONTEND-CHECKOUT-FIXES.md)
            confirmOnlyOnCompleteButton: true,
            afterVerificationCancelShowPaymentMethods: true,
            clientInstructions: {
                doNotConfirmUntil: 'User has clicked the "Complete my order" (or equivalent) button. Do not call stripe.confirmPayment() on mount, on payment method change, or on field blur.',
                afterVerificationCancel: 'If the user exits or cancels the verification (e.g. 3DS), keep the payment section visible and allow choosing another payment method; do not hide or disable the Payment Element. Optionally request a new clientSecret via create-intent if the intent is no longer in requires_payment_method.',
                onTerminalFailure: 'Navigate to checkoutNavigation.paymentFailedUrl (or equivalent route). Call POST /api/payments/payment-failed with orderId + paymentIntentId when possible.',
                returnUrlForConfirmPayment: 'Use checkoutNavigation.confirmPaymentReturnUrl as stripe.confirmPayment({ return_url }) so 3DS and redirect-based PMs return to your SPA.'
            },
            // Payment intent uses automatic_payment_methods (PaymentElement requirement)
            automaticPaymentMethods: {
                enabled: paymentIntent.automatic_payment_methods?.enabled || false,
                allow_redirects: paymentIntent.automatic_payment_methods?.allow_redirects || 'always'
            },
            // Actual payment method types available (determined by Stripe based on availability)
            paymentMethodTypes: actualPaymentMethodTypes,
            // Payment methods that will be available in PaymentElement (when supported)
            paymentMethods: {
                card: true,
                link: true,
                klarna: true,
                applePay: true,
                googlePay: true
            },
            device: {
                isMobile: isMobile,
                platform: deviceInfo.platform
            },
            authenticationPolicy: {
                cardsThreeDSecure: paymentIntent.payment_method_options?.card?.request_three_d_secure || 'not_set',
                redirectPaymentMethods: 'automatic_payment_methods.allow_redirects is always so Klarna/hosted methods use provider flows before success.',
                note: 'Funds are not captured until Stripe confirms the PaymentIntent after authentication and issuer checks. Do not advance order UX until status is succeeded (or processing for async methods).'
            },
            threeDSecure: {
                configured: paymentIntent.payment_method_options?.card?.request_three_d_secure === 'any',
                request_three_d_secure: paymentIntent.payment_method_options?.card?.request_three_d_secure || 'not_set',
                note: '3DS runs when the user submits payment via confirmPayment(); do not confirm until user clicks Complete my order.'
            },
            debug: {
                automatic_payment_methods_enabled: paymentIntent.automatic_payment_methods?.enabled,
                status: paymentIntent.status,
                requires_payment_method: paymentIntent.status === 'requires_payment_method',
                three_d_secure_configured: paymentIntent.payment_method_options?.card?.request_three_d_secure === 'any',
                device: deviceInfo.platform
            },
            ...checkoutNavigationExtras({ paymentIntent })
        });
    } catch (error) {
        const userAgent = req.headers['user-agent'] || '';
        const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
        
        logger.error('create_payment_intent_failed', {
            message: error.message,
            code: error.code,
            type: error.type,
            statusCode: error.statusCode,
            mobile: isMobile
        });
        devLog('create_payment_intent_failed.ua', userAgent.substring(0, 100));
        
        // Prefer a client-friendly message; never expose stack or internal details to the client
        const userMessage = (error.code === 'card_declined' || error.decline_code)
            ? 'Your card was declined. Please try another card or payment method.'
            : (error.code === 'incorrect_cvc' || error.code === 'invalid_cvc')
                ? 'The security code (CVC) is incorrect. Please check and try again.'
                : (error.code === 'expired_card')
                    ? 'Your card has expired. Please use another card.'
                    : 'We could not start the payment. Please check your details and try again, or use another payment method.';

        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create payment intent',
            code: error.code || 'payment_intent_creation_failed',
            userMessage,
            device: {
                isMobile,
                platform: isMobile ? 'mobile' : 'desktop'
            },
            stripeError: error.type ? {
                type: error.type,
                code: error.code,
                message: error.message
            } : undefined,
            ...checkoutNavigationExtras()
        });
    }
});

/**
 * POST /api/payments/payment-failed
 * Handle payment failure when user clicks "Complete Order" but payment fails/declines
 * This is called by the frontend immediately when confirmPayment fails
 * 
 * Body:
 * {
 *   "orderId": "PM123456",
 *   "paymentIntentId": "pi_xxx",
 *   "error": "Payment declined" (optional)
 * }
 */
router.post('/payment-failed', async (req, res) => {
    devLog('payment-failed endpoint', {
        hasOrderId: !!req.body.orderId,
        hasPaymentIntentId: !!req.body.paymentIntentId
    });

    try {
        const { orderId, paymentIntentId, error } = req.body;
        
        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: 'orderId is required'
            });
        }
        
        logger.warn('payment_failed_client_report', { orderId, hasPaymentIntentId: !!paymentIntentId });
        devLog('payment_failed_client_detail', { error });
        
        // Get order to verify it exists and update status
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });

        const order = findResult.success ? normalizeReadFirst(findResult.data) : null;

        // Checkout often uses TEMP ids or creates the orders row only after payment — do not 404:
        // the client still needs 200 + checkoutNavigation to reach the payment-failed page.
        if (!order) {
            logger.warn('payment_failure_no_order_row', { orderId });

            let paymentIntentObj = null;
            if (paymentIntentId) {
                try {
                    paymentIntentObj = await stripe.paymentIntents.retrieve(paymentIntentId);
                } catch (piErr) {
                    logger.warn('payment_failure_orphan_pi_retrieve_failed', { message: piErr.message, orderId });
                }
            }

            if (paymentIntentObj) {
                const paymentFailureService = require('../services/paymentFailureService');
                const syntheticOrder = {
                    orderId,
                    items: [],
                    totals: { total: paymentIntentObj.amount / 100 },
                    paymentStatus: 'failed'
                };
                try {
                    const saveResult = await paymentFailureService.saveFailedCheckout(paymentIntentObj, syntheticOrder);
                    if (!saveResult?.success) {
                        logger.warn('payment_failure_save_orphan_failed', { orderId, error: saveResult?.error });
                    }
                } catch (saveErr) {
                    logger.warn('payment_failure_save_orphan_exception', { orderId, message: saveErr.message });
                }
            }

            return res.json({
                success: true,
                message: 'Payment failure noted (order record not created yet)',
                orderId,
                paymentIntentId: paymentIntentId || null,
                orderNotFound: true,
                ...checkoutNavigationExtras({ shouldRedirectToFailurePage: true })
            });
        }
        
        // Only update if payment hasn't succeeded yet
        if (order.paymentStatus !== 'succeeded') {
            // Update order with failed payment status
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--update',
                data: {
                    filter: { orderId },
                    update: {
                        paymentStatus: 'failed',
                        paymentIntentId: paymentIntentId || order.paymentIntentId,
                        paymentFailedAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        timeline: [
                            ...(order.timeline || []),
                            {
                                status: 'Payment Failed',
                                date: new Date().toISOString(),
                                description: `Payment failed: ${error || 'Payment was declined or canceled'}`,
                                timestamp: new Date().toISOString(),
                                source: 'frontend'
                            }
                        ]
                    }
                }
            });
            
            // Save failed checkout to failed_checkouts collection
            // Background job will send email after 3 minutes
            const paymentFailureService = require('../services/paymentFailureService');
            
            // Get payment intent from Stripe if we have paymentIntentId
            let paymentIntentObj = null;
            if (paymentIntentId || order.paymentIntentId) {
                try {
                    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                    paymentIntentObj = await stripe.paymentIntents.retrieve(paymentIntentId || order.paymentIntentId);
                } catch (error) {
                    logger.warn('payment_failure_pi_retrieve_failed', { message: error.message, orderId });
                }
            }
            
            // If we have payment intent, save failed checkout
            if (paymentIntentObj) {
                const saveResult = await paymentFailureService.saveFailedCheckout(paymentIntentObj, { ...order, paymentStatus: 'failed' });
                
                if (saveResult?.success) {
                    devLog('failed_checkout_saved_from_frontend_path', { orderId });
                } else {
                    logger.error('failed_checkout_save_error_from_frontend', { orderId, error: saveResult?.error });
                }
            } else {
                logger.warn('payment_failure_no_pi_to_persist', { orderId });
            }
        } else {
            devLog('payment_failure_ignored_already_succeeded', { orderId });
        }
        
        res.json({
            success: true,
            message: 'Payment failure recorded',
            orderId: orderId,
            paymentIntentId: paymentIntentId || order.paymentIntentId || null,
            ...checkoutNavigationExtras({ shouldRedirectToFailurePage: true })
        });
        
    } catch (error) {
        logger.error('payment_failure_frontend_handler_error', { message: error.message });
        devWarn(error.stack);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to handle payment failure'
        });
    }
});

/**
 * PUT /api/payments/update-intent/:paymentIntentId
 * Update payment intent amount from current cart totals (same rule as create-intent).
 * Preferred: frontend should create a new PaymentIntent when shipping/discount/country change.
 * Body: userId (required), shippingAddress, shippingMethod, discountCode (all optional).
 * Amount/totals from frontend are ignored.
 */
router.put('/update-intent/:paymentIntentId', async (req, res) => {
    try {
        const { paymentIntentId } = req.params;
        const body = req.body || {};
        const userId = body.userId;
        const shippingAddress = body.shippingAddress || body.customer;
        const shippingMethod = body.shippingMethod || (body.shippingMethodId ? { id: body.shippingMethodId, type: body.shippingMethodType } : null);
        const discountCode = body.discountCode || null;

        if (!paymentIntentId) {
            return res.status(400).json({
                success: false,
                error: 'paymentIntentId is required',
                errorCode: 'MISSING_PAYMENT_INTENT_ID'
            });
        }

        const existingIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (existingIntent.status !== 'requires_payment_method' && existingIntent.status !== 'requires_confirmation') {
            return res.status(400).json({
                success: false,
                error: `Cannot update payment intent with status: ${existingIntent.status}. Payment intent can only be updated when status is 'requires_payment_method' or 'requires_confirmation'`,
                errorCode: 'INVALID_PAYMENT_INTENT_STATUS',
                currentStatus: existingIntent.status
            });
        }

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId is required to update payment intent amount from cart',
                errorCode: 'MISSING_USER_ID'
            });
        }

        const cartResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });
        let cart = null;
        if (cartResult.success && cartResult.data) {
            cart = Array.isArray(cartResult.data) ? cartResult.data[0] : cartResult.data;
        }
        if (!cart || !cart.items || !Array.isArray(cart.items) || cart.items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Cart not found or empty',
                errorCode: 'CART_EMPTY_OR_MISSING'
            });
        }

        const checkoutTotalsService = require('../services/checkoutTotalsService');
        const discountService = require('../services/discountService');
        const vatService = require('../services/vatService');
        const shippingConfigService = require('../services/shippingConfigService');

        const countryForZoneUpdate = normalizeCountryCode((shippingAddress && (shippingAddress.country || shippingAddress.countryCode)) ? String(shippingAddress.country || shippingAddress.countryCode) : '');

        const countryForVat = countryForZoneUpdate || vatService.getCountryFromRequest(req);
        const vatRate = vatService.getVatRate(countryForVat);

        let shippingCost = 0;
        if (shippingAddress && shippingMethod) {
            const methodId = shippingMethod.id || shippingMethod.shippingMethodId || (shippingMethod._id && shippingMethod._id.toString());
            const municipality = (shippingAddress.municipality || shippingAddress.city || '').trim();
            shippingCost = await shippingConfigService.getShippingCostFromDb(countryForZoneUpdate, methodId, municipality);
            if (shippingCost <= 0 && cart.totals && (typeof cart.totals.shippingGross === 'number' || typeof cart.totals.shipping === 'number')) {
                shippingCost = cart.totals.shippingGross ?? cart.totals.shipping ?? 0;
            }
        }
        if (shippingCost <= 0 && cart.totals && (typeof cart.totals.shippingGross === 'number' || typeof cart.totals.shipping === 'number')) {
            shippingCost = cart.totals.shippingGross ?? cart.totals.shipping ?? 0;
        }

        const effectiveDiscountCodeUpdate = discountService.pickEffectiveDiscountCode(discountCode, cart);
        const discountResolutionUpdate = await discountService.validateAndComputeDiscountAmount(
            sumCartProductGross(cart.items),
            shippingCost,
            effectiveDiscountCodeUpdate
        );
        if (!discountResolutionUpdate.ok) {
            return res.status(400).json({
                success: false,
                code: discountResolutionUpdate.errorCode,
                error: discountResolutionUpdate.error,
                userMessage: discountResolutionUpdate.userMessage,
                requestId: req.requestId || req.headers['x-request-id'] || null,
                details: { discountCode: effectiveDiscountCodeUpdate }
            });
        }
        const discountAmount = discountResolutionUpdate.discountAmount;

        const totals = checkoutTotalsService.calculateTotals(cart.items, shippingCost, discountAmount, 'SEK', vatRate, { country: countryForVat });
        const validatedAmount = totals.total;

        if (validatedAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount calculated from cart',
                errorCode: 'INVALID_AMOUNT'
            });
        }

        devLog('update_payment_intent_amount', { paymentIntentId, validatedAmount });

        const amountInCents = Math.round(validatedAmount * 100);
        const currencyLower = (existingIntent.currency || 'sek').toString().toLowerCase();

        const updateParams = {
            amount: amountInCents,
            currency: currencyLower,
            metadata: {
                ...existingIntent.metadata,
                shippingCost: (totals.shippingGross || 0).toString(),
                orderTotal: validatedAmount.toString(),
                subtotalNet: (totals.subtotalNet || 0).toString(),
                vatAmount: (totals.vatAmount || 0).toString(),
                discountAmount: (totals.discountAmount || 0).toString(),
                updatedAt: new Date().toISOString()
            },
            // Keep SCA / 3DS + redirect PM settings in sync with create-intent
            ...getPaymentIntentSecurityOptions()
        };

        const paymentIntent = await stripe.paymentIntents.update(paymentIntentId, updateParams);

        devLog('payment_intent_updated', {
            paymentIntentId,
            oldAmount: existingIntent.amount / 100,
            newAmount: paymentIntent.amount / 100,
            currency: paymentIntent.currency,
            status: paymentIntent.status
        });

        res.json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency,
            status: paymentIntent.status,
            ...checkoutNavigationExtras({ paymentIntent })
        });

    } catch (error) {
        logger.error('update_payment_intent_error', {
            message: error.message,
            code: error.code,
            type: error.type
        });
        
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update payment intent',
            errorCode: error.code || 'PAYMENT_INTENT_UPDATE_FAILED',
            stripeError: error.type ? {
                type: error.type,
                code: error.code,
                message: error.message
            } : undefined
        });
    }
});

/**
 * POST /api/payments/update-intent
 * Update payment intent metadata with actual order ID
 * This is called after order creation to replace temporary order ID
 * 
 * Body:
 * {
 *   "paymentIntentId": "pi_xxx",
 *   "orderId": "PM123456"
 * }
 */
router.post('/update-intent', async (req, res) => {
    try {
        const { paymentIntentId, orderId } = req.body;

        if (!paymentIntentId) {
            return res.status(400).json({
                success: false,
                error: 'paymentIntentId is required'
            });
        }

        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: 'orderId is required'
            });
        }

        devLog('update_intent_metadata', { paymentIntentId, orderId });

        // Retrieve existing payment intent to preserve metadata
        const existingIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        // Update payment intent metadata with actual order ID
        const paymentIntent = await stripe.paymentIntents.update(paymentIntentId, {
            metadata: {
                ...existingIntent.metadata,
                orderId: orderId,
                isTemporary: 'false',
                updatedAt: new Date().toISOString()
            }
        });

        // Update order with payment intent ID
        try {
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--update',
                data: {
                    filter: { orderId },
                    update: {
                        paymentIntentId: paymentIntent.id,
                        paymentStatus: 'pending',
                        updatedAt: new Date().toISOString()
                    }
                }
            });
            devLog('order_linked_payment_intent', { orderId, paymentIntentId });
        } catch (dbError) {
            logger.warn('order_payment_intent_update_failed', { orderId, message: dbError.message });
            // Continue even if order update fails
        }

        res.json({
            success: true,
            paymentIntentId: paymentIntent.id,
            orderId: orderId,
            metadata: paymentIntent.metadata
        });
    } catch (error) {
        logger.error('update_intent_route_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update payment intent',
            code: error.code || 'payment_intent_update_failed'
        });
    }
});

/**
 * POST /api/payments/confirm
 * Confirm payment completion (called after frontend confirms payment)
 * 
 * Body:
 * {
 *   "paymentIntentId": "pi_xxx",
 *   "orderId": "PM123456"
 * }
 */
router.post('/confirm', async (req, res) => {
    try {
        const { paymentIntentId, orderId } = req.body;

        if (!paymentIntentId) {
            return res.status(400).json({
                success: false,
                error: 'paymentIntentId is required'
            });
        }

        // Retrieve payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        // Payment already succeeded — still run finalize (creates order + emails if webhook ran before draft existed)
        if (paymentIntent.status === 'succeeded') {
            devLog('confirm_already_succeeded', { paymentIntentId });
            // Fire-and-forget finalize to avoid blocking the success page render.
            // The webhook will also run finalize; this is just a safety net.
            setImmediate(async () => {
                try {
                    await handlePaymentIntentSucceeded(paymentIntent, { hintOrderId: orderId || null });
                } catch (finErr) {
                    logger.error('finalize_after_succeeded_failed', { message: finErr.message, paymentIntentId });
                }
            });
            const refreshedPi = await stripe.paymentIntents.retrieve(paymentIntentId);
            const finalOrderId = orderId || refreshedPi.metadata?.orderId || null;
            let canonicalTotals = null;
            try {
                if (finalOrderId) {
                    const findResult = await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'orders',
                        command: '--read',
                        data: { orderId: finalOrderId }
                    });
                    const existingOrder = findResult.success ? normalizeReadFirst(findResult.data) : null;
                    if (existingOrder) {
                        const meta = paymentIntent.metadata || {};
                        const parsedShipping = meta.shippingGross != null ? Number(meta.shippingGross) : NaN;
                        const parsedDiscount = meta.discountAmount != null ? Number(meta.discountAmount) : NaN;
                        const parsedVatRate = meta.vatRate != null ? Number(meta.vatRate) : NaN;
                        const metaCountry = meta.country != null ? String(meta.country) : undefined;
                        canonicalTotals = computeCanonicalOrderTotals(existingOrder, {
                            shippingGross: !isNaN(parsedShipping) ? parsedShipping : undefined,
                            discountAmount: !isNaN(parsedDiscount) ? parsedDiscount : undefined,
                            vatRate: !isNaN(parsedVatRate) ? parsedVatRate : undefined,
                            country: metaCountry || undefined
                        });
                    }
                }
            } catch (e) {
                // ignore; success page can still render without breakdown
            }
            return res.json({
                success: true,
                paymentStatus: 'succeeded',
                orderId: finalOrderId,
                amount: paymentIntent.amount / 100,
                currency: paymentIntent.currency,
                totals: canonicalTotals,
                alreadyConfirmed: true,
                shouldRedirectToSuccess: true,
                userMessage: 'Your payment was already completed. Redirecting you to your order confirmation…',
                message: 'Payment was already confirmed',
                ...checkoutNavigationExtras({ paymentIntent })
            });
        }

        if (paymentIntent.status === 'processing') {
            devLog('confirm_already_processing', { paymentIntentId });
            return res.json({
                success: true,
                paymentStatus: 'processing',
                orderId: orderId || paymentIntent.metadata.orderId,
                amount: paymentIntent.amount / 100,
                currency: paymentIntent.currency,
                alreadyProcessing: true,
                message: 'Payment is already being processed - do not call confirmCardPayment again',
                action: 'wait_for_webhook', // Frontend should wait for webhook or poll status
                shouldNotConfirm: true, // Explicit flag for frontend
                userMessage: 'Your payment is processing. Please wait a moment—do not refresh or try again.',
                ...checkoutNavigationExtras({ paymentIntent })
            });
        }

        if (paymentIntent.status === 'canceled') {
            return res.status(400).json({
                success: false,
                error: 'Payment intent has been canceled',
                paymentStatus: 'canceled',
                code: 'payment_canceled',
                userMessage: 'This payment was canceled. Please try again.',
                shouldRedirectToPaymentFailedPage: true,
                ...checkoutNavigationExtras({ paymentIntent, shouldRedirectToFailurePage: true })
            });
        }

        // Determine order ID (from request or metadata)
        const targetOrderId = orderId || paymentIntent.metadata.orderId;

        if (!targetOrderId) {
            return res.status(400).json({
                success: false,
                error: 'orderId is required'
            });
        }

        // Update order based on payment status
        const paymentStatus = paymentIntent.status === 'succeeded' ? 'succeeded' : 
                             paymentIntent.status === 'requires_payment_method' ? 'failed' : 
                             paymentIntent.status === 'processing' ? 'processing' :
                             'pending';

        const updateData = {
            paymentStatus,
            paymentIntentId: paymentIntent.id,
            updatedAt: new Date().toISOString()
        };

        if (paymentIntent.customer) {
            updateData.stripeCustomerId = paymentIntent.customer;
        }

        // If payment succeeded, update order status
        if (paymentStatus === 'succeeded') {
            // Find order to check current status
            const findResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--read',
                data: { orderId: targetOrderId }
            });

            const existingOrder = findResult.success ? normalizeReadFirst(findResult.data) : null;
            if (existingOrder) {
                const order = existingOrder;
                if (order.status === 'pending') {
                    updateData.status = 'processing';
                }

                // Add timeline entry
                updateData.timeline = [
                    ...(order.timeline || []),
                    {
                        status: 'Payment Confirmed',
                        date: new Date().toISOString(),
                        description: `Payment of ${(paymentIntent.amount / 100).toFixed(2)} ${paymentIntent.currency.toUpperCase()} confirmed`,
                        timestamp: new Date().toISOString()
                    }
                ];
            }
        }

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId: targetOrderId },
                update: updateData
            }
        });

        const terminalFailure =
            paymentIntent.status === 'canceled' ||
            (paymentStatus === 'failed' && paymentIntent.last_payment_error);

        res.json({
            success: true,
            paymentStatus: paymentIntent.status,
            orderId: targetOrderId,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency,
            orderPaymentStatus: paymentStatus,
            lastPaymentError: paymentIntent.last_payment_error || null,
            shouldRedirectToPaymentFailedPage: terminalFailure,
            shouldRedirectToSuccess: paymentStatus === 'succeeded',
            userMessage: paymentStatus === 'succeeded'
                ? 'Payment completed. Redirecting…'
                : (paymentStatus === 'processing'
                    ? 'Your payment is processing. Please wait…'
                    : 'Payment status updated.'),
            ...checkoutNavigationExtras({ paymentIntent })
        });
    } catch (error) {
        logger.error('confirm_payment_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to confirm payment',
            code: error.code || 'payment_confirmation_failed',
            userMessage: 'We could not confirm your payment. Please try again, or use another payment method.',
            shouldRedirectToPaymentFailedPage: true,
            ...checkoutNavigationExtras({ shouldRedirectToFailurePage: true })
        });
    }
});

/**
 * POST /api/payments/finalize-after-payment
 * Idempotent: if PaymentIntent succeeded, runs the same finalize as the webhook (order + emails).
 * Use when webhook raced before pending_checkouts existed, or as a recovery after deploy.
 * Body: { paymentIntentId: string, orderId?: string }
 */
router.post('/finalize-after-payment', async (req, res) => {
    try {
        const { paymentIntentId, orderId: hintOrderId } = req.body || {};
        if (!paymentIntentId) {
            return res.status(400).json({ success: false, error: 'paymentIntentId is required' });
        }
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.status !== 'succeeded') {
            return res.json({
                success: false,
                paymentStatus: pi.status,
                userMessage: 'Payment is not completed yet; finalize runs only after success.'
            });
        }
        await handlePaymentIntentSucceeded(pi, { hintOrderId: hintOrderId || null });
        const after = await stripe.paymentIntents.retrieve(paymentIntentId);
        return res.json({
            success: true,
            paymentStatus: 'succeeded',
            orderId: hintOrderId || after.metadata?.orderId || null,
            message: 'Finalize attempted (order + emails if pending checkout was found)'
        });
    } catch (error) {
        logger.error('finalize_after_payment_error', { message: error.message });
        return res.status(500).json({
            success: false,
            error: error.message || 'Finalize failed',
            userMessage: 'Could not finalize order. Contact support with your order number.'
        });
    }
});

/**
 * GET /api/payments/status/:paymentIntentId
 * Check payment status
 */
router.get('/status/:paymentIntentId', async (req, res) => {
    try {
        const { paymentIntentId } = req.params;

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        // Determine if payment can be confirmed
        const canConfirm = [
            'requires_payment_method',
            'requires_confirmation',
            'requires_action',
            'requires_capture'
        ].includes(paymentIntent.status);

        const isProcessing = paymentIntent.status === 'processing';
        const isCompleted = ['succeeded', 'canceled'].includes(paymentIntent.status);

        const failedTerminal =
            paymentIntent.status === 'canceled' ||
            (paymentIntent.status === 'requires_payment_method' && paymentIntent.last_payment_error);

        res.json({
            success: true,
            paymentIntentId: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency,
            orderId: paymentIntent.metadata.orderId,
            created: new Date(paymentIntent.created * 1000).toISOString(),
            lastPaymentError: paymentIntent.last_payment_error || null,
            canConfirm,
            isProcessing,
            isCompleted,
            shouldRedirectToPaymentFailedPage: failedTerminal,
            message: isProcessing 
                ? 'Payment is currently being processed' 
                : isCompleted 
                    ? `Payment is ${paymentIntent.status}` 
                    : canConfirm 
                        ? 'Payment can be confirmed' 
                        : 'Payment status unknown',
            ...checkoutNavigationExtras({ paymentIntent })
        });
    } catch (error) {
        logger.error('get_payment_status_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to retrieve payment status',
            code: error.code || 'payment_status_retrieval_failed'
        });
    }
});

/**
 * POST /api/payments/check-before-confirm
 * Check if payment intent is safe to confirm (prevents duplicate confirmations)
 * Call this before calling confirmCardPayment on the frontend
 * 
 * Body:
 * {
 *   "paymentIntentId": "pi_xxx"
 * }
 */
router.post('/check-before-confirm', async (req, res) => {
    try {
        const { paymentIntentId } = req.body;

        if (!paymentIntentId) {
            return res.status(400).json({
                success: false,
                error: 'paymentIntentId is required'
            });
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        const status = paymentIntent.status;
        const canConfirm = [
            'requires_payment_method',
            'requires_confirmation',
            'requires_action',
            'requires_capture'
        ].includes(status);

        const isProcessing = status === 'processing';
        const isCompleted = ['succeeded', 'canceled'].includes(status);

        res.json({
            success: true,
            paymentIntentId: paymentIntent.id,
            status,
            canConfirm,
            isProcessing,
            isCompleted,
            safeToConfirm: canConfirm && !isProcessing && !isCompleted,
            message: isProcessing 
                ? 'Payment is already being processed - do not call confirmCardPayment again'
                : isCompleted 
                    ? `Payment is already ${status} - no confirmation needed`
                    : canConfirm 
                        ? 'Payment can be confirmed safely'
                        : `Payment status is ${status} - check Stripe documentation`,
            ...checkoutNavigationExtras({ paymentIntent })
        });
    } catch (error) {
        logger.error('check_before_confirm_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to check payment intent',
            code: error.code || 'payment_check_failed'
        });
    }
});

/**
 * POST /api/payments/refund
 * Process a refund (for admin use)
 * 
 * Body:
 * {
 *   "paymentIntentId": "pi_xxx",
 *   "amount": 50.00,  // Optional - if not provided, full refund
 *   "reason": "requested_by_customer"  // Optional
 * }
 */
router.post('/refund', async (req, res) => {
    try {
        const { paymentIntentId, amount, reason } = req.body;

        if (!paymentIntentId) {
            return res.status(400).json({
                success: false,
                error: 'paymentIntentId is required'
            });
        }

        // Retrieve payment intent to get charge ID
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (!paymentIntent.charges || paymentIntent.charges.data.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No charge found for this payment intent'
            });
        }

        const chargeId = paymentIntent.charges.data[0].id;

        // Prepare refund parameters
        const refundParams = {
            charge: chargeId,
            reason: reason || 'requested_by_customer'
        };

        // Add amount if partial refund
        if (amount && amount > 0) {
            refundParams.amount = Math.round(parseFloat(amount) * 100);
        }

        // Create refund
        const refund = await stripe.refunds.create(refundParams);

        // Update order status
        const orderId = paymentIntent.metadata.orderId;
        if (orderId) {
            try {
                const findResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'orders',
                    command: '--read',
                    data: { orderId }
                });

                if (findResult.success && findResult.data) {
                    const order = findResult.data;
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'orders',
                        command: '--update',
                        data: {
                            filter: { orderId },
                            update: {
                                paymentStatus: refund.amount === paymentIntent.amount ? 'refunded' : 'partially_refunded',
                                updatedAt: new Date().toISOString(),
                                timeline: [
                                    ...(order.timeline || []),
                                    {
                                        status: 'Refunded',
                                        date: new Date().toISOString(),
                                        description: `Payment refunded: ${(refund.amount / 100).toFixed(2)} ${refund.currency.toUpperCase()}`,
                                        timestamp: new Date().toISOString()
                                    }
                                ]
                            }
                        }
                    });
                }
            } catch (dbError) {
                logger.warn('order_update_after_refund_failed', { message: dbError.message });
                // Continue even if order update fails
            }
        }

        res.json({
            success: true,
            refundId: refund.id,
            amount: refund.amount / 100,
            currency: refund.currency,
            status: refund.status,
            orderId
        });
    } catch (error) {
        logger.error('refund_route_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process refund',
            code: error.code || 'refund_failed'
        });
    }
});

// Legacy endpoint - keep for backward compatibility
router.post('/', async (req, res) => {
    try {
        devLog('legacy payment request keys', req.body ? Object.keys(req.body) : []);

        // Process the payment using VornifyPay
        const result = await paymentService.processPayment(req.body);
        
        devLog('legacy payment result', { status: result && result.status });

        // Send response
        if (result.status) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        logger.error('legacy_payment_route_error', { message: error.message });
        res.status(500).json({
            status: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * GET /api/payments/apple-pay/verification-file
 * Retrieve the Apple Pay domain verification file content from Stripe
 * This endpoint fetches the file content that should be hosted at
 * /.well-known/apple-developer-merchantid-domain-association
 * 
 * Query Parameters:
 * - domainId: Optional - Stripe payment method domain ID (default: retrieves all registered domains)
 */
router.get('/apple-pay/verification-file', async (req, res) => {
    try {
        const { domainId } = req.query;
        
        // If domainId is provided, retrieve that specific domain
        if (domainId) {
            try {
                const domain = await stripe.paymentMethodDomains.retrieve(domainId);
                
                // The verification file content is typically in the domain object
                // However, Stripe might not return it directly - it's usually provided during registration
                res.json({
                    success: true,
                    domain: {
                        id: domain.id,
                        domain: domain.domain,
                        status: domain.status,
                        note: 'Verification file content is typically provided when registering the domain. Check Stripe Dashboard or contact support for the file content.'
                    },
                    message: 'Domain retrieved. Verification file content should be available in Stripe Dashboard when you click on the domain.'
                });
            } catch (error) {
                res.status(404).json({
                    success: false,
                    error: 'Domain not found',
                    message: error.message
                });
            }
        } else {
            // List all registered domains
            try {
                const domains = await stripe.paymentMethodDomains.list({ limit: 100 });
                
                res.json({
                    success: true,
                    domains: domains.data.map(d => ({
                        id: d.id,
                        domain: d.domain,
                        status: d.status,
                        enabled: d.enabled
                    })),
                    message: 'Domains retrieved. To get verification file content: 1) Click on domain in Stripe Dashboard, 2) Look for "Download" or "View file" option, 3) Or contact Stripe support with domain IDs',
                    note: 'The verification file content is provided by Stripe when you register the domain. It should be available in the Stripe Dashboard when viewing the domain details.'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to retrieve domains',
                    message: error.message
                });
            }
        }
    } catch (error) {
        logger.error('apple_pay_verification_file_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to retrieve verification file information',
            note: 'The verification file content is typically provided in Stripe Dashboard when you click on the registered domain. Contact Stripe support if you cannot find it.'
        });
    }
});

module.exports = router; 