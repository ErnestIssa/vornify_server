const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('../services/emailService');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const currencyService = require('../services/currencyService');
const {
    CANONICAL_STATUSES,
    validateTransition,
    getStatusText,
    createStatusHistoryEntry,
    updateStatusTimestamps,
    isCancelled,
    isFinalState
} = require('../utils/orderStatusMachine');
const {
    generateUniqueTrackingCode,
    normalizeEmail,
    extractCustomerNames
} = require('../utils/trackingCodeGenerator');
const { devLog, devWarn } = require('../core/logging/devConsole');
const { logger } = require('../core/logging/logger');
const tiktokEvents = require('../services/tiktokEvents');

const db = getDBInstance();

/** Filter to exclude soft-deleted orders from list queries */
const NOT_DELETED_FILTER = { $or: [ { deletedAt: { $exists: false } }, { deletedAt: null } ] };

/** True if order has been soft-deleted */
function isOrderDeleted(order) {
    return !!(order && (order.deletedAt != null || order.deleted === true));
}

// Helper function to create or update customer record
async function createOrUpdateCustomer(order) {
    try {
        const customerEmail = order.customer.email;
        if (!customerEmail) return;

        // Check if customer exists with timeout
        const existingCustomer = await Promise.race([
            db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--read',
            data: { email: customerEmail }
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Customer lookup timeout')), 10000)
            )
        ]);

        const customerData = {
            id: customerEmail,
            name: order.customer.name || 
                  `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() ||
                  order.customerName ||
                  'Customer',
            email: customerEmail,
            phone: order.customer.phone || order.shippingAddress?.phone || '',
            address: {
                street: order.customer.address || order.shippingAddress?.street || '',
                city: order.customer.city || order.shippingAddress?.city || '',
                postalCode: order.customer.postalCode || order.shippingAddress?.postalCode || '',
                country: order.customer.country || order.shippingAddress?.country || ''
            },
            status: 'active',
            updatedAt: new Date().toISOString(),
            preferences: {
                newsletter: false,
                smsNotifications: false,
                preferredLanguage: 'en'
            }
        };

        if (existingCustomer.success && existingCustomer.data) {
            // Update existing customer with timeout
            await Promise.race([
                db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'customers',
                command: '--update',
                data: {
                    filter: { email: customerEmail },
                    update: customerData
                }
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Customer update timeout')), 10000)
                )
            ]);
        } else {
            // Create new customer with timeout
            customerData.joinDate = new Date().toISOString();
            customerData.createdAt = new Date().toISOString();
            customerData.ordersCount = 0;
            customerData.totalSpent = 0;
            customerData.averageOrderValue = 0;
            customerData.customerType = 'new';
            customerData.tags = ['new_user'];
            customerData.recentOrders = [];
            customerData.communicationLog = [];

            await Promise.race([
                db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'customers',
                command: '--create',
                data: customerData
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Customer creation timeout')), 10000)
                )
            ]);
        }

        // Update customer analytics (non-blocking, runs in background)
        updateCustomerAnalytics(customerEmail);
        
    } catch (error) {
        logger.error('orders_customer_upsert_error', { message: error.message });
        throw error;
    }
}

// Helper function to update customer analytics (non-blocking, runs in background)
async function updateCustomerAnalytics(customerEmail) {
    // Run in background without blocking
    setImmediate(async () => {
    try {
            // Add timeout to prevent hanging
            const analyticsPromise = (async () => {
        // Get all orders for this customer
        const ordersResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { 'customer.email': customerEmail }
        });

        const orders = ordersResult.success ? ordersResult.data : [];
        const orderArray = Array.isArray(orders) ? orders : (orders ? [orders] : []);

        // Calculate analytics
        const ordersCount = orderArray.length;
        const totalSpent = orderArray.reduce((sum, order) => {
            return sum + (order.total || order.totals?.total || 0);
        }, 0);
        
        const averageOrderValue = ordersCount > 0 ? totalSpent / ordersCount : 0;
        
        // Get order dates
        const orderDates = orderArray
            .map(order => new Date(order.createdAt || order.orderDate))
            .filter(date => !isNaN(date.getTime()))
            .sort((a, b) => a - b);
        
        const firstOrderDate = orderDates.length > 0 ? orderDates[0] : null;
        const lastOrderDate = orderDates.length > 0 ? orderDates[orderDates.length - 1] : null;

        // Determine customer type
        let customerType = 'new';
        let tags = [];

        if (ordersCount === 0) {
            customerType = 'new';
            tags = ['new_user'];
        } else if (ordersCount === 1) {
            customerType = 'new';
            tags = ['new_user'];
        } else if (ordersCount >= 2 && ordersCount <= 4) {
            customerType = 'returning';
            tags = ['returning'];
        } else if (ordersCount >= 5) {
            customerType = 'loyal';
            tags = ['loyal'];
        }

        if (totalSpent > 5000) {
            customerType = 'vip';
            tags.push('vip', 'high_spender');
        }

        // Get recent orders (last 5)
        const recentOrders = orderArray
            .sort((a, b) => new Date(b.createdAt || b.orderDate) - new Date(a.createdAt || a.orderDate))
            .slice(0, 5)
            .map(order => ({
                id: order.orderId,
                date: order.createdAt || order.orderDate,
                total: order.total || order.totals?.total || 0,
                status: order.status,
                itemsCount: order.items ? order.items.length : 0
            }));

        // Update customer with analytics
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--update',
            data: {
                filter: { email: customerEmail },
                update: {
                    ordersCount,
                    totalSpent,
                    averageOrderValue,
                    firstOrderDate,
                    lastOrderDate,
                    customerType,
                    tags,
                    recentOrders,
                    updatedAt: new Date().toISOString()
                }
            }
        });
            })();

            // Add timeout protection
            await Promise.race([
                analyticsPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Analytics update timeout')), 30000)
                )
            ]);
    } catch (error) {
            logger.warn('orders_customer_analytics_background_failed', { message: error.message });
            // Don't throw - this is background processing
    }
    });
}

// Helper function to generate unique Order ID with timeout protection
async function generateUniqueOrderId() {
    const maxRetries = 10; // Prevent infinite loops
    let attempts = 0;
    let orderId;
    let exists = true;
    
    while (exists && attempts < maxRetries) {
        attempts++;
        const randomNum = Math.floor(100000 + Math.random() * 900000);
        orderId = 'PM' + randomNum;
        
        try {
            // Check if this ID already exists with timeout
            const result = await Promise.race([
                db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Order ID check timeout')), 5000)
                )
            ]);
        
        // VornifyDB returns single object when query is provided, or error if not found
        exists = result.success && result.data;
        } catch (error) {
            logger.warn('orders_id_generation_check_failed', { orderId, attempt: attempts, message: error.message });
            // If timeout or error, assume ID doesn't exist and use it
            exists = false;
        }
    }
    
    if (attempts >= maxRetries) {
        // Fallback: use timestamp-based ID if we can't generate unique one
        orderId = 'PM' + Date.now() + Math.floor(Math.random() * 1000);
        logger.warn('orders_fallback_order_id', { attempts: maxRetries, orderId });
    }
    
    return orderId;
}

// Helper function to generate timeline descriptions
function generateTimelineDescription(status, provider, trackingNum) {
    switch(status) {
        case 'processing':
            return 'Order is being prepared';
        case 'confirmed':
            return 'Payment confirmed, ready to ship';
        case 'shipped':
            return `Order shipped with ${provider || 'carrier'}${trackingNum ? ' - Tracking: ' + trackingNum : ''}`;
        case 'delivered':
            return 'Order has been delivered';
        case 'cancelled':
            return 'Order has been cancelled';
        default:
            return `Order status updated to ${status}`;
    }
}

// Create order with unique Order ID
router.post('/create', async (req, res) => {
    const startTime = Date.now();
    devLog('[ORDER CREATE] Request received at', new Date().toISOString());
    
    try {
        const orderData = req.body;
        devLog('[ORDER CREATE] Order data received', {
            customerEmail: orderData.customer?.email || orderData.customerEmail,
            itemsCount: orderData.items?.length || 0,
            total: orderData.total || orderData.totals?.total
        });
        
        // SECURITY: Recalculate shipping cost from admin/DB only; never trust frontend amount
        const shippingConfigService = require('../services/shippingConfigService');
        const shippingAddress = orderData.shippingAddress || orderData.customer;
        const shippingMethod = orderData.shippingMethod;
        
        if (shippingAddress && shippingMethod) {
            const country = (shippingAddress.country || shippingAddress.countryCode || '').toString().toUpperCase().trim();
            if (country && (await shippingConfigService.hasZoneConfig())) {
                const methodId = shippingMethod.id || shippingMethod.shippingMethodId || (shippingMethod._id && shippingMethod._id.toString());
                const municipality = (shippingAddress.municipality || shippingAddress.city || '').trim();
                const shippingCostFromDb = await shippingConfigService.getShippingCostFromDb(country, methodId, municipality);
                orderData.shippingCost = shippingCostFromDb;
                if (orderData.totals) orderData.totals.shipping = shippingCostFromDb;
                if (orderData.shippingMethod) orderData.shippingMethod.cost = shippingCostFromDb;
            }
        }

        // Auto-assign best warehouse when not set (multi-warehouse support)
        if (orderData.items?.length && shippingAddress && !orderData.warehouseId) {
            try {
                const warehouseSelectionService = require('../services/warehouseSelectionService');
                const destCountry = (shippingAddress.country || shippingAddress.countryCode || '').toString().toUpperCase().trim();
                const orderItems = (orderData.items || []).map(i => ({ id: i.id || i.productId, productId: i.id || i.productId, quantity: i.quantity || 1 }));
                const { warehouse } = await warehouseSelectionService.selectWarehouse(orderItems, destCountry, { preferSingleShipment: true });
                if (warehouse && warehouse._id) orderData.warehouseId = warehouse._id.toString();
            } catch (e) {
                logger.warn('order_create_warehouse_selection_skipped', { message: e.message });
            }
        }

        // Backend is single source of truth: recalculate totals from items, shipping, discount; VAT from shipping country
        const checkoutTotalsService = require('../services/checkoutTotalsService');
        const discountService = require('../services/discountService');
        const vatService = require('../services/vatService');
        const shippingCountry = (orderData.shippingAddress && (orderData.shippingAddress.country || orderData.shippingAddress.countryCode)) || (orderData.customer && (orderData.customer.country || orderData.customer.countryCode));
        const countryForVat = shippingCountry ? String(shippingCountry).toUpperCase().trim() : vatService.DEFAULT_COUNTRY;
        const vatRate = vatService.getVatRate(countryForVat);

        const shippingCostForTotals = orderData.shippingCost ?? orderData.shippingMethod?.cost ?? 0;
        let orderDiscountAmount = 0;
        if (orderData.appliedDiscount && typeof orderData.appliedDiscount.amount === 'number' && !isNaN(orderData.appliedDiscount.amount)) {
            orderDiscountAmount = orderData.appliedDiscount.amount;
        } else if (orderData.discountCode) {
            const productGross = (orderData.items || []).reduce((sum, item) => {
                const p = typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0;
                const q = typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : 0;
                return sum + p * q;
            }, 0);
            const calc = await discountService.calculateOrderTotals(productGross, shippingCostForTotals, 0, orderData.discountCode);
            if (calc.success && calc.appliedDiscount && typeof calc.appliedDiscount.amount === 'number') {
                orderDiscountAmount = calc.appliedDiscount.amount;
            }
        }
        const calculatedTotals = checkoutTotalsService.calculateTotals(
            orderData.items || [],
            shippingCostForTotals,
            orderDiscountAmount,
            orderData.currency || 'SEK',
            vatRate,
            { country: countryForVat }
        );
        // Keep backward-compat alias for consumers that read order.totals.shipping
        const orderTotals = { ...calculatedTotals, shipping: calculatedTotals.shippingGross };
        
        // Generate unique Order ID with timeout protection
        devLog('[ORDER CREATE] Generating unique order ID…');
        const orderId = await Promise.race([
            generateUniqueOrderId(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Order ID generation timeout')), 10000)
            )
        ]);
        devLog('[ORDER CREATE] Order ID generated:', orderId);
        
        // Generate customer-friendly tracking code
        devLog('[ORDER CREATE] Generating tracking code…');
        const { firstName, lastName } = extractCustomerNames(orderData);
        const trackingCode = await generateUniqueTrackingCode(firstName, lastName);
        devLog('[ORDER CREATE] Tracking code generated:', trackingCode);
        
        // Check if this is a retry payment (failed checkout retry)
        const isRetry = orderData.isRetry === true;
        const retryToken = orderData.retryToken || null;

        // -------------------------------------------------------------------
        // TikTok Events API: capture event_id + ttclid + client context now so
        // CompletePayment fired by the Stripe webhook can deduplicate against
        // the frontend Pixel. Accepts multiple field shapes from the frontend.
        // Source-of-truth fields live on `order.tiktok`.
        // -------------------------------------------------------------------
        const tiktokInput = orderData.tiktok || {};
        const tiktokEventIdsIncoming = orderData.tiktokEventIds || tiktokInput.eventIds || {};
        const clientCtx = tiktokEvents.extractClientContextFromReq(req);

        // GDPR / TTDSG consent gate. Frontend must mirror its Pixel-load gate here:
        // - true  → backend Events API may fire (Pixel did too → properly deduplicated)
        // - false → backend Events API must NOT fire (Pixel did not fire either)
        // - null/undefined → treat as granted (legacy clients without CMP wiring)
        const tiktokConsentRaw =
            tiktokInput.consent ??
            tiktokInput.consentGranted ??
            orderData.tiktokConsent ??
            null;
        const tiktokConsentGranted = tiktokConsentRaw === false ? false : true;

        const tiktokMeta = {
            ttclid: orderData.ttclid || tiktokInput.ttclid || null,
            ttp: orderData.ttp || tiktokInput.ttp || null,
            consentGranted: tiktokConsentGranted,
            consentSignal: tiktokConsentRaw === null ? 'assumed_granted' : (tiktokConsentGranted ? 'granted' : 'denied'),
            initiateCheckoutEventId:
                tiktokEventIdsIncoming.initiateCheckout ||
                tiktokInput.initiateCheckoutEventId ||
                null,
            addPaymentInfoEventId:
                tiktokEventIdsIncoming.addPaymentInfo ||
                tiktokInput.addPaymentInfoEventId ||
                null,
            // CRITICAL: this id MUST match the event_id the frontend Pixel uses
            // for ttq.track('CompletePayment', ..., { event_id }) on the thank-you page.
            completePaymentEventId:
                tiktokEventIdsIncoming.completePayment ||
                tiktokInput.completePaymentEventId ||
                null,
            pageUrl: tiktokInput.pageUrl || orderData.pageUrl || null,
            referrer: tiktokInput.referrer || clientCtx.referrer || null,
            ip: clientCtx.ip,
            userAgent: clientCtx.userAgent,
            capturedAt: new Date().toISOString()
        };

        // Prepare order with enhanced customer data structure
        const order = {
            ...orderData,
            orderId,
            trackingCode, // Customer-friendly tracking code (e.g., NEIS-1234)
            isRetry: isRetry, // Include retry flag
            retryToken: retryToken, // Include retry token
            status: orderData.status || 'processing',
            paymentStatus: orderData.paymentStatus || 'pending',
            emailSent: false, // Flag to track if confirmation email has been sent
            
            // Enhanced customer information structure
            customer: orderData.customer ? {
                email: orderData.customer.email,
                firstName: orderData.customer.firstName || orderData.customer.name?.split(' ')[0] || '',
                lastName: orderData.customer.lastName || orderData.customer.name?.split(' ').slice(1).join(' ') || '',
                address: orderData.customer.address || orderData.shippingAddress?.street || '',
                city: orderData.customer.city || orderData.shippingAddress?.city || '',
                postalCode: orderData.customer.postalCode || orderData.shippingAddress?.postalCode || '',
                country: orderData.customer.country || orderData.shippingAddress?.country || '',
                phone: orderData.customer.phone || orderData.shippingAddress?.phone || ''
            } : {
                email: orderData.customerEmail || '',
                firstName: orderData.customerName?.split(' ')[0] || '',
                lastName: orderData.customerName?.split(' ').slice(1).join(' ') || '',
                address: orderData.shippingAddress?.street || '',
                city: orderData.shippingAddress?.city || '',
                postalCode: orderData.shippingAddress?.postalCode || '',
                country: orderData.shippingAddress?.country || '',
                phone: orderData.shippingAddress?.phone || ''
            },
            
            // Legacy fields for backward compatibility
            customerName: orderData.customerName || orderData.customer?.name || '',
            customerEmail: orderData.customerEmail || orderData.customer?.email || '',
            
            // Store first and last name for tracking code reference
            firstName: orderData.customer?.firstName || orderData.firstName || firstName,
            lastName: orderData.customer?.lastName || orderData.lastName || lastName,
            
            // Ensure cart items include variant information
            items: orderData.items ? orderData.items.map(item => ({
                ...item,
                // Preserve variant information from cart
                sizeId: item.sizeId || null,
                colorId: item.colorId || null,
                variantId: item.variantId || null,
                size: item.size || null,
                color: item.color || null
            })) : [],
            
            // Financial information (backend-calculated only; frontend totals ignored)
            totals: orderTotals,
            total: calculatedTotals.total,
            shipping: calculatedTotals.shippingGross,
            tax: calculatedTotals.vatAmount,
            subtotal: calculatedTotals.subtotalNet,
            discount: calculatedTotals.discountAmount,
            discountedSubtotal: calculatedTotals.subtotalGross - calculatedTotals.vatAmount,
            appliedDiscount: orderData.appliedDiscount || null,
            discountCode: orderData.appliedDiscount?.code || orderData.discountCode || null,
            
            // Multi-currency support
            currency: orderData.currency || currencyService.BASE_CURRENCY,
            baseTotal: calculatedTotals.total,
            baseCurrency: orderData.baseCurrency || currencyService.BASE_CURRENCY,
            exchangeRate: orderData.exchangeRate || 1.0,
            rateTimestamp: orderData.rateTimestamp || new Date().toISOString(),
            
            // Language support (for email localization)
            language: orderData.language || 'en', // Default to English if not provided
            
            // Order status and details
            paymentMethod: orderData.paymentMethod || 'card',
            paymentIntentId: orderData.paymentIntentId || null, // Stripe payment intent ID
            stripeCustomerId: orderData.stripeCustomerId || null, // Stripe customer ID
            shippingMethod: orderData.shippingMethod?.name || orderData.shippingMethod || '',
            
            // Enhanced tracking information
            trackingNumber: orderData.trackingNumber || null,
            trackingUrl: orderData.trackingUrl || null,
            shippingProvider: orderData.shippingProvider || orderData.shippingMethod?.carrier || null,
            estimatedDelivery: orderData.estimatedDelivery || null,
            estimatedDeliveryDate: orderData.estimatedDeliveryDate || orderData.estimatedDelivery || null,
            
            // Include shipping method information
            shippingMethodDetails: orderData.shippingMethod ? {
                id: orderData.shippingMethod.id,
                name: orderData.shippingMethod.name,
                carrier: orderData.shippingMethod.carrier,
                cost: orderData.shippingMethod.cost,
                estimatedDays: orderData.shippingMethod.estimatedDays,
                description: orderData.shippingMethod.description,
                trackingEnabled: orderData.shippingMethod.trackingEnabled,
                carrierCode: orderData.shippingMethod.carrierCode
            } : null,
            shippingCost: orderData.shippingCost || 0,
            
            // Order management
            notes: orderData.notes || '',
            
            // Timestamps
            date: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            orderDate: new Date().toISOString(),
            
            // Order status (default to pending after payment)
            status: orderData.status || 'pending',
            
            // Status history and timestamps (initialize with pending status)
            statusHistory: [
                createStatusHistoryEntry(orderData.status || 'pending', 'system')
            ],
            statusTimestamps: updateStatusTimestamps({}, orderData.status || 'pending'),
            
            // Timeline (for backward compatibility)
            timeline: [
                {
                    status: 'Order Placed',
                    date: new Date().toISOString(),
                    description: 'Order initiated — awaiting payment confirmation',
                    timestamp: new Date().toISOString()
                }
            ],

            // TikTok Events API metadata — flows from pending_checkout → real order
            // so the webhook can fire CompletePayment with deduplicated event_id.
            tiktok: tiktokMeta,
            ttclid: tiktokMeta.ttclid // mirrored for legacy/admin readability
        };
        
        // IMPORTANT: Do NOT create a real order until payment succeeds.
        // Store this as a pending checkout (order draft) to be promoted by the Stripe webhook.
        devLog('[ORDER CREATE] Saving pending checkout (order draft) to database…');
        const result = await Promise.race([
            db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'pending_checkouts',
            command: '--create',
            data: {
                id: orderId,
                orderId,
                status: 'pending_payment',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                customerEmail: order.customer?.email || order.customerEmail || null,
                paymentIntentId: order.paymentIntentId || null,
                orderDraft: order
            }
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Database operation timeout')), 15000)
            )
        ]);
        
        const dbTime = Date.now() - startTime;
        devLog(`[ORDER CREATE] Database operation completed in ${dbTime}ms`);
        
        if (result.success) {
            devLog('[ORDER CREATE] Pending checkout created successfully:', orderId);
            
            // Send response immediately - don't wait for background operations
            const responseTime = Date.now() - startTime;
            devLog(`[ORDER CREATE] Sending response in ${responseTime}ms`);
            
            // Note: Real order + emails will be created/sent by the Stripe webhook after payment succeeds
            res.json({
                success: true,
                message: 'Checkout created successfully',
                orderId: orderId,
                data: {
                    orderId: orderId,
                    pendingCheckout: true
                }
            });
            
            // Run background operations after response is sent (non-blocking)
            setImmediate(async () => {
                try {
                    // Update payment intent with actual order ID if it was created with temporary ID
                    if (order.paymentIntentId) {
                        devLog('[ORDER CREATE] Background: Syncing PaymentIntent metadata with checkout order id…');
                        try {
                            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                            const existingIntent = await stripe.paymentIntents.retrieve(order.paymentIntentId);
                            const metaOid = existingIntent.metadata?.orderId;
                            const needsSync = !metaOid ||
                                metaOid !== orderId ||
                                existingIntent.metadata?.isTemporary === 'true' ||
                                String(metaOid).startsWith('TEMP-');
                            if (needsSync) {
                                await stripe.paymentIntents.update(order.paymentIntentId, {
                                    metadata: {
                                        ...existingIntent.metadata,
                                        orderId,
                                        isTemporary: 'false',
                                        updatedAt: new Date().toISOString()
                                    }
                                });
                                devLog('[ORDER CREATE] Background: PaymentIntent metadata orderId synced', order.paymentIntentId, orderId);
                            }
                        } catch (paymentIntentError) {
                            logger.warn('order_create_payment_intent_sync_failed', {
                                paymentIntentId: order.paymentIntentId,
                                message: paymentIntentError.message
                            });
                        }
                    }

                    // IMPORTANT: Do not create/update customer and do not email until payment succeeds.
                    devLog('[ORDER CREATE] Background: Pending checkout saved; webhook will finalize order.');

                    // TikTok InitiateCheckout — fire-and-forget. Failures must never affect checkout.
                    // event_id MUST match the InitiateCheckout id the Pixel used on the storefront.
                    // Consent gate: skip server-side firing when frontend reports denied consent
                    // (Pixel didn't fire there either → would otherwise cause non-deduped count).
                    try {
                        if (!tiktokMeta.consentGranted) {
                            devLog('[ORDER CREATE] TikTok InitiateCheckout skipped (consent denied)', { orderId });
                        } else if (tiktokEvents.isEnabled()) {
                            const ttResult = await tiktokEvents.trackInitiateCheckout({
                                eventId: tiktokMeta.initiateCheckoutEventId || undefined,
                                ttclid: tiktokMeta.ttclid,
                                ttp: tiktokMeta.ttp,
                                email: order.customer?.email,
                                phone: order.customer?.phone,
                                externalId: order.userId || order.customer?.email,
                                ip: tiktokMeta.ip,
                                userAgent: tiktokMeta.userAgent,
                                pageUrl: tiktokMeta.pageUrl,
                                referrer: tiktokMeta.referrer,
                                items: order.items,
                                value: order.total || order.totals?.total || 0,
                                currency: order.currency || 'SEK'
                            });
                            if (ttResult?.ok) {
                                devLog('[ORDER CREATE] TikTok InitiateCheckout sent', { eventId: ttResult.eventId });
                            }
                        }
                    } catch (tkErr) {
                        logger.warn('order_create_tiktok_initiate_checkout_failed', { message: tkErr.message, orderId });
                    }
                    
                    const totalTime = Date.now() - startTime;
                    devLog(`[ORDER CREATE] Background operations completed in ${totalTime}ms total`);
                } catch (bgError) {
                    logger.warn('order_create_background_error', { message: bgError.message });
                }
            });
        } else {
            logger.error('order_create_database_failed', { message: result.error || result.message || 'unknown' });
            res.status(400).json({
                success: false,
                error: result.error || 'Failed to create pending checkout in database',
                ...result
            });
        }
    } catch (error) {
        const errorTime = Date.now() - startTime;
        logger.error('order_create_error', { message: error.message, ms: errorTime });
        devLog('[ORDER CREATE] Error stack:', error.stack);
        
        // Ensure response is sent even on error
        if (!res.headersSent) {
        res.status(500).json({
            success: false,
                error: error.message || 'Failed to create order',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
        }
    }
});

/**
 * POST /api/orders/update-status
 * Admin endpoint: single source of truth for order status.
 * Body: { orderId, status, changedBy?, allowAnyTransition?, trackingNumber?, shippingProvider?, estimatedDelivery? }
 * Valid statuses: pending | processing | packed | shipped | in_transit | out_for_delivery | delivered | cancelled
 * When allowAnyTransition !== true: valid transitions are forward along 7 steps or to cancelled (INVALID_STATUS_TRANSITION otherwise).
 * When allowAnyTransition === true: any transition is allowed; only status value and orderId are validated.
 */
router.post('/update-status', async (req, res) => {
    try {
        const { orderId, status, shippingProvider, trackingNumber, trackingUrl, estimatedDelivery, changedBy, allowAnyTransition } = req.body;
        
        if (!orderId || !status) {
            return res.status(400).json({
                success: false,
                error: 'orderId and status are required',
                errorCode: 'VALIDATION_ERROR'
            });
        }
        
        // Find the order first
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!findResult.success || !findResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Order not found',
                errorCode: 'ORDER_NOT_FOUND'
            });
        }
        
        const order = findResult.data;
        if (isOrderDeleted(order)) {
            return res.status(404).json({
                success: false,
                error: 'Order not found',
                errorCode: 'ORDER_NOT_FOUND'
            });
        }
        const currentStatus = order.status || 'pending';
        const newStatus = String(status).toLowerCase().trim();
        
        // Always validate that requested status is canonical
        if (!CANONICAL_STATUSES.includes(newStatus)) {
            return res.status(400).json({
                success: false,
                error: `Invalid status: "${newStatus}". Must be one of: ${CANONICAL_STATUSES.join(', ')}`,
                errorCode: 'INVALID_STATUS'
            });
        }
        
        // Idempotent cancel: already-cancelled order set to cancelled again is a no-op success
        if (currentStatus === 'cancelled' && newStatus === 'cancelled') {
            return res.json({
                success: true,
                message: 'Order status updated',
                data: {
                    message: 'Order status updated',
                    orderId,
                    status: newStatus
                }
            });
        }
        
        // When allowAnyTransition is not true, enforce allowed transitions and final-state rules
        if (!allowAnyTransition) {
            const validation = validateTransition(currentStatus, newStatus);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    error: validation.error,
                    errorCode: 'INVALID_STATUS_TRANSITION',
                    currentStatus,
                    requestedStatus: newStatus
                });
            }
            if (isFinalState(currentStatus) && currentStatus !== newStatus) {
                return res.status(400).json({
                    success: false,
                    error: `Cannot update order status. Order is in final state: ${currentStatus}`,
                    errorCode: 'FINAL_STATE_REACHED'
                });
            }
        }
        
        // Create status history entry
        const statusHistoryEntry = createStatusHistoryEntry(newStatus, changedBy || 'system');
        
        // Update status timestamps
        const updatedStatusTimestamps = updateStatusTimestamps(order.statusTimestamps || {}, newStatus);
        
        // Prepare timeline entry (for backward compatibility)
        const timelineEntry = {
            status: status.charAt(0).toUpperCase() + status.slice(1),
            date: new Date().toISOString(),
            description: generateTimelineDescription(newStatus, shippingProvider, trackingNumber)
        };
        
        // Prepare update data
        const updateData = {
            status: newStatus,
            updatedAt: new Date().toISOString(),
            timeline: [...(order.timeline || []), timelineEntry],
            statusHistory: [...(order.statusHistory || []), statusHistoryEntry],
            statusTimestamps: updatedStatusTimestamps
        };
        
        // Add shipping fields if provided
        if (shippingProvider) updateData.shippingProvider = shippingProvider;
        if (trackingNumber) updateData.trackingNumber = trackingNumber;
        if (trackingUrl) updateData.trackingUrl = trackingUrl;
        if (estimatedDelivery) updateData.estimatedDelivery = estimatedDelivery;
        
        // Update the order
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: updateData
            }
        });
        
        if (updateResult.success) {
            // Create tracking entry if order is being shipped
            if (status === 'shipped' && !order.trackingNumber && order.shippingMethod) {
                try {
                    const trackingRoutes = require('./tracking');
                    const trackingResult = await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'tracking_events',
                        command: '--create',
                        data: {
                            orderId: order.orderId,
                            trackingNumber: `PM${Math.floor(100000 + Math.random() * 900000)}`,
                            carrier: order.shippingMethod.carrierCode || 'POSTNORD',
                            shippingMethodId: order.shippingMethod.id,
                            shippingCost: order.shippingCost || 0,
                            status: 'Shipped',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            events: [
                                {
                                    status: 'Shipped',
                                    location: 'Peak Mode Warehouse, Stockholm',
                                    description: 'Package has been shipped',
                                    timestamp: new Date().toISOString()
                                }
                            ]
                        }
                    });
                    
                    if (trackingResult.success) {
                        // Update order with tracking number
                        await db.executeOperation({
                            database_name: 'peakmode',
                            collection_name: 'orders',
                            command: '--update',
                            data: {
                                filter: { orderId },
                                update: {
                                    trackingNumber: trackingResult.data.trackingNumber,
                                    carrier: trackingResult.data.carrier,
                                    updatedAt: new Date().toISOString()
                                }
                            }
                        });
                        
                        devLog('Tracking entry created', { orderId, trackingNumber: trackingResult.data.trackingNumber });
                    }
                } catch (trackingError) {
                    logger.warn('order_tracking_entry_create_failed', { orderId, message: trackingError.message });
                    // Don't fail the status update if tracking creation fails
                }
            }
            
            // Send appropriate email based on status
            try {
                const updatedOrder = { ...order, ...updateData };
                
                switch (status) {
                    case 'processing':
                        await emailService.sendOrderProcessingEmail(
                            order.customer.email,
                            updatedOrder
                        );
                        devLog('Order processing email sent', { orderId });
                        break;
                    case 'shipped':
                        await emailService.sendShippingNotificationEmail(
                            order.customer.email,
                            updatedOrder
                        );
                        devLog('Shipping notification email sent', { orderId });
                        break;
                    case 'delivered':
                        await emailService.sendDeliveryConfirmationEmail(
                            order.customer.email,
                            updatedOrder
                        );
                        devLog('Delivery confirmation email sent', { orderId });
                        
                        // Schedule review request email (2-3 days later)
                        setTimeout(async () => {
                            try {
                                await emailService.sendReviewRequestEmail(
                                    order.customer.email,
                                    updatedOrder
                                );
                                devLog('Review request email sent', { orderId });
                            } catch (reviewError) {
                                logger.warn('order_review_request_email_failed', { orderId, message: reviewError.message });
                            }
                        }, 2 * 24 * 60 * 60 * 1000); // 2 days in milliseconds
                        break;
                }
            } catch (emailError) {
                logger.warn('order_status_update_email_failed', { orderId, message: emailError.message });
                // Don't fail the status update if email fails
            }

            // Admin-compatible response: success, message, and data with orderId/status so admin can show toast and refetch
            res.json({
                success: true,
                message: 'Order status updated',
                data: {
                    message: 'Order status updated',
                    orderId,
                    status: newStatus,
                    ...updateResult.data
                }
            });
        } else {
            res.status(400).json({
                success: false,
                error: updateResult.error || 'Update failed',
                ...updateResult
            });
        }
    } catch (error) {
        logger.error('order_status_update_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update order status'
        });
    }
});

/** MongoDB case-insensitive email match for orders */
function emailRegex(email) {
    const escaped = (email || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { $regex: '^' + escaped + '$', $options: 'i' };
}

/**
 * GET /api/orders/verify-email
 * Public endpoint for email verification before review form.
 * For general Reviews: hasPurchase = true if email exists in ANY relevant collection (orders, customers, reviews, subscribers).
 * Same endpoint and response shape; optional fields (orderCount, reviewCount, etc.) still returned.
 *
 * Query: email (required)
 * Response: { hasPurchase: boolean, orderCount: number, reviewCount?: number, maxReviewsAllowed?: number, canSubmitMoreReviews?: boolean }
 */
router.get('/verify-email', async (req, res) => {
    try {
        const emailRaw = (req.query.email || '').toString().trim();
        if (!emailRaw) {
            return res.status(400).json({
                success: false,
                hasPurchase: false,
                error: 'Email is required',
                message: 'Query parameter "email" is required'
            });
        }
        const email = emailRaw.toLowerCase();
        const regex = emailRegex(emailRaw);

        // Check all relevant collections: email "exists in system" if found in any
        const [orderResult, customerResult, reviewResult, subscriberResult] = await Promise.all([
            db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--read',
                data: {
                    $and: [
                        NOT_DELETED_FILTER,
                        { $or: [ { 'customer.email': regex }, { customerEmail: regex } ] }
                    ]
                }
            }),
            db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'customers',
                command: '--read',
                data: { email: regex }
            }),
            db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'reviews',
                command: '--read',
                data: { customerEmail: regex }
            }),
            db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'subscribers',
                command: '--read',
                data: { email: regex }
            })
        ]);

        const toList = (result) => {
            if (!result.success || !result.data) return [];
            const d = result.data;
            return Array.isArray(d) ? d : (d ? [d] : []);
        };

        const orders = toList(orderResult);
        const customers = toList(customerResult);
        const reviews = toList(reviewResult);
        const subscribers = toList(subscriberResult);

        const orderCount = orders.length;
        const reviewCount = reviews.length;
        const hasPurchase = orderCount > 0 || customers.length > 0 || reviews.length > 0 || subscribers.length > 0;
        const maxReviewsAllowed = orderCount;
        const canSubmitMoreReviews = orderCount > 0 && reviewCount < orderCount;

        return res.json({
            success: true,
            hasPurchase,
            orderCount,
            reviewCount,
            maxReviewsAllowed,
            canSubmitMoreReviews
        });
    } catch (error) {
        logger.error('orders_verify_email_error', { message: error.message });
        return res.status(500).json({
            success: false,
            hasPurchase: false,
            error: 'Internal server error',
            message: 'Could not verify email. Please try again later.'
        });
    }
});

/**
 * GET /api/orders/track
 * Public endpoint to track order by orderId and email
 * No authentication required - email acts as verification
 *
 * Query Parameters:
 * - orderId (REQUIRED) - Order ID to track (or use trackingCode)
 * - email (REQUIRED) - Customer email for verification
 *
 * Success (200): Normal order data (status, statusTimestamps, items, etc.) for active orders.
 *
 * Order unavailable – cancelled (200): Body has orderUnavailable: true, reason: 'cancelled',
 * orderId, message, supportEmail. Client should show "Order cancelled" page with support CTA.
 *
 * Order not found / deleted (404): Body has error, message, reason: 'not_found', supportEmail.
 * Client should show "Order not available" page with support CTA.
 *
 * IMPORTANT: This route must be defined BEFORE /:orderId to avoid route conflicts
 */
router.get('/track', async (req, res) => {
    try {
        devLog('[ORDER TRACK] Request received', {
            query: req.query,
            timestamp: new Date().toISOString()
        });

        const { orderId, trackingCode, email } = req.query;

        // Validate email is provided
        if (!email) {
            devWarn('[ORDER TRACK] Missing email parameter');
            return res.status(400).json({
                error: 'Invalid parameters',
                message: 'Email is required'
            });
        }

        // Validate at least one identifier is provided
        if (!orderId && !trackingCode) {
            devWarn('[ORDER TRACK] Missing identifier', { orderId: !!orderId, trackingCode: !!trackingCode });
            return res.status(400).json({
                error: 'Invalid parameters',
                message: 'Either orderId or trackingCode is required'
            });
        }

        // Normalize email (lowercase, trim)
        const normalizedEmail = normalizeEmail(email);
        const identifier = trackingCode ? String(trackingCode).toUpperCase().trim() : String(orderId).trim();

        devLog('[ORDER TRACK] Processing', {
            identifier: identifier,
            identifierType: trackingCode ? 'trackingCode' : 'orderId',
            email: normalizedEmail
        });

        // Find order by trackingCode or orderId
        devLog('[ORDER TRACK] Querying database for order:', identifier);
        let orderResult;
        try {
            // Build query based on identifier type
            const query = trackingCode 
                ? { trackingCode: identifier }
                : { orderId: identifier };
            
            orderResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--read',
                data: query
            });
            devLog('[ORDER TRACK] Database query result', {
                success: orderResult?.success,
                hasData: !!orderResult?.data,
                identifierType: trackingCode ? 'trackingCode' : 'orderId'
            });
        } catch (dbError) {
            logger.error('order_track_db_query_failed', { message: dbError.message });
            devLog('[ORDER TRACK] DB error stack:', dbError.stack);
            return res.status(500).json({
                error: 'Database error',
                message: 'Failed to query order from database'
            });
        }

        if (!orderResult || !orderResult.success || !orderResult.data) {
            devWarn('[ORDER TRACK] Order not found:', identifier);
            return res.status(404).json({
                error: 'Order not found',
                message: 'This order is not available for tracking. If you have not been notified, please contact support.',
                reason: 'not_found',
                supportEmail: 'support@peakmode.se'
            });
        }

        const order = Array.isArray(orderResult.data) ? orderResult.data[0] : orderResult.data;
        
        if (!order) {
            devWarn('[ORDER TRACK] Order not found:', identifier);
            return res.status(404).json({
                error: 'Order not found',
                message: 'This order is not available for tracking. If you have not been notified, please contact support.',
                reason: 'not_found',
                supportEmail: 'support@peakmode.se'
            });
        }

        devLog('[ORDER TRACK] Order found', {
            orderId: order.orderId,
            trackingCode: order.trackingCode,
            status: order.status,
            hasCustomer: !!order.customer,
            hasCustomerEmail: !!order.customerEmail
        });

        // Order cancelled: return structured response so client can show dedicated "cancelled" page with support info
        if (isCancelled(order.status)) {
            devWarn('[ORDER TRACK] Order is cancelled:', identifier);
            return res.status(200).json({
                orderUnavailable: true,
                reason: 'cancelled',
                orderId: order.orderId || identifier,
                message: 'This order has been cancelled.',
                supportEmail: 'support@peakmode.se'
            });
        }

        // Verify email matches order (check all possible email fields)
        const orderEmails = [
            order.email,
            order.customerEmail,
            order.customer?.email,
            order.customerInfo?.email
        ]
            .filter(Boolean)
            .map(e => normalizeEmail(e));
        
        const emailMatches = orderEmails.includes(normalizedEmail);
        
        if (!emailMatches) {
            logger.warn('order_track_email_mismatch', { identifierType: trackingCode ? 'trackingCode' : 'orderId' });
            devLog('[ORDER TRACK] Email mismatch (dev detail)', {
                provided: normalizedEmail,
                orderEmails: orderEmails,
                checkedFields: ['email', 'customerEmail', 'customer.email', 'customerInfo.email']
            });
            return res.status(403).json({
                error: 'Email mismatch',
                message: 'Email does not match this order',
                supportEmail: 'support@peakmode.se'
            });
        }

        // Order soft-deleted: return structured response so client can show dedicated "deleted" view with support info
        if (isOrderDeleted(order)) {
            devWarn('[ORDER TRACK] Order is deleted:', identifier);
            return res.status(200).json({
                orderUnavailable: true,
                reason: 'deleted',
                orderId: order.orderId || identifier,
                message: 'This order is no longer available for tracking.',
                supportEmail: 'support@peakmode.se'
            });
        }

        devLog('[ORDER TRACK] Order found and email verified:', identifier);

        const currentStatus = order.status || 'pending';
        let statusText;
        try {
            statusText = getStatusText(currentStatus);
        } catch (statusError) {
            logger.warn('order_track_status_text_failed', { message: statusError.message });
            statusText = currentStatus; // Fallback to status value
        }

        // Normalize item images (ensure full Cloudinary URLs)
        const normalizeImageUrl = (image) => {
            if (!image) return '';
            const imageStr = String(image).trim();
            if (!imageStr) return '';
            
            // If already a full URL, return as-is
            if (imageStr.startsWith('http://') || imageStr.startsWith('https://')) {
                return imageStr;
            }
            
            // If relative URL, prepend Cloudinary base URL (if needed)
            // For now, return as-is (assuming Cloudinary URLs are already full)
            return imageStr;
        };

        // Get status timestamps (ensure all are ISO strings)
        const statusTimestamps = {};
        try {
            if (order.statusTimestamps && typeof order.statusTimestamps === 'object') {
                Object.keys(order.statusTimestamps).forEach(status => {
                    try {
                        const timestamp = order.statusTimestamps[status];
                        if (timestamp) {
                            // Convert to ISO string if it's a Date object
                            statusTimestamps[status] = timestamp instanceof Date 
                                ? timestamp.toISOString() 
                                : String(timestamp);
                        }
                    } catch (tsError) {
                        devWarn('[ORDER TRACK] Error processing timestamp for status:', status, tsError.message);
                    }
                });
            }
        } catch (tsError) {
            devWarn('[ORDER TRACK] Error processing statusTimestamps:', tsError.message);
        }

        // Get current status timestamp
        const currentStatusTimestamp = statusTimestamps[currentStatus] || null;

        // Build normalized response
        const response = {
            orderId: order.orderId || identifier,
            trackingCode: order.trackingCode || null, // Include customer-friendly tracking code
            status: currentStatus,
            statusText: statusText,
            statusTimestamps: Object.keys(statusTimestamps).length > 0 ? statusTimestamps : undefined,
            currentStatusTimestamp: currentStatusTimestamp,
            trackingNumber: order.trackingNumber || null,
            shippingProvider: order.shippingProvider || order.shippingMethodDetails?.carrier || null,
            estimatedDelivery: order.estimatedDelivery || order.estimatedDeliveryDate || null,
            orderDate: order.orderDate || order.createdAt || order.date || new Date().toISOString(),
            customerName: order.customerName || 
                         (order.customer?.name) || 
                         `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() ||
                         'Customer',
            email: normalizedEmail,
            items: (Array.isArray(order.items) ? order.items : []).map(item => {
                try {
                    return {
                        name: item?.name || item?.productName || 'Product',
                        quantity: item?.quantity || 1,
                        price: item?.price || 0,
                        image: normalizeImageUrl(item?.image || item?.media?.[0] || '')
                    };
                } catch (itemError) {
                    devWarn('[ORDER TRACK] Error processing item:', itemError.message);
                    return {
                        name: 'Product',
                        quantity: 1,
                        price: 0,
                        image: ''
                    };
                }
            }),
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
            totals: {
                subtotal: order.subtotal || 
                         order.totals?.subtotal || 
                         (order.items || []).reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0),
                shipping: order.shipping || 
                         order.totals?.shipping || 
                         order.shippingCost || 
                         0,
                total: order.total || 
                      order.totals?.total || 
                      ((order.subtotal || 0) + (order.shipping || 0))
            }
        };

        // Remove null values from optional fields (but keep empty objects/arrays)
        if (!response.trackingNumber) delete response.trackingNumber;
        if (!response.shippingProvider) delete response.shippingProvider;
        if (!response.estimatedDelivery) delete response.estimatedDelivery;
        
        // Always include statusTimestamps (even if empty) and currentStatusTimestamp (can be null)
        // Frontend expects these fields to always be present
        if (!response.statusTimestamps) {
            response.statusTimestamps = {};
        }

        devLog('[ORDER TRACK] Returning order data', {
            orderId: response.orderId,
            status: response.status,
            itemsCount: response.items.length
        });

        res.json(response);

    } catch (error) {
        logger.error('order_track_unhandled_error', {
            message: error.message,
            name: error.name,
            orderId: req.query?.orderId,
            trackingCode: req.query?.trackingCode ? '[present]' : undefined
        });
        devLog('[ORDER TRACK] Unhandled stack:', error.stack);

        // Ensure response hasn't been sent
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Internal server error',
                message: error.message || 'An unexpected error occurred while processing your request'
            });
        } else {
            logger.error('order_track_response_already_sent', {});
        }
    }
});

// Get all orders (for admin) - Also supports email query parameter
router.get('/all', async (req, res) => {
    try {
        const { email } = req.query;
        
        // If email query parameter is provided, filter by email (exclude soft-deleted)
        if (email) {
            const result = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--read',
                data: { $and: [ { 'customer.email': email }, NOT_DELETED_FILTER ] }
            });
            
            if (result.success) {
                // Ensure data is always an array
                let orders = result.data || [];
                if (!Array.isArray(orders)) {
                    orders = orders ? [orders] : [];
                }
                
                // Format response to match frontend expectations
                const formattedOrders = orders.map(order => ({
                    orderId: order.orderId || order._id,
                    email: order.customer?.email || email,
                    items: order.items || [],
                    total: order.total || order.totals?.total || 0,
                    status: order.status || 'unknown',
                    createdAt: order.createdAt || order.orderDate || order.date,
                    shippingAddress: order.shippingAddress,
                    customer: order.customer,
                    paymentStatus: order.paymentStatus,
                    trackingNumber: order.trackingNumber,
                    shippingProvider: order.shippingProvider,
                    estimatedDelivery: order.estimatedDelivery
                }));
                
                return res.json({
                    success: true,
                    data: formattedOrders
                });
            } else {
                return res.json({
                    success: true,
                    data: []
                });
            }
        }
        
        // Get all orders (exclude soft-deleted)
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: NOT_DELETED_FILTER
        });
        
        res.json(result);
    } catch (error) {
        logger.error('orders_get_all_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve orders'
        });
    }
});

// GET /api/orders/list - Admin orders dashboard: list with filters, sorting, pagination
router.get('/list', authenticateAdmin, async (req, res) => {
    try {
        const {
            status,
            fulfillmentStatus,
            carrier,
            shippingMethod,
            country,
            warehouseId,
            dateFrom,
            dateTo,
            minTotal,
            maxTotal,
            limit = 50,
            offset = 0
        } = req.query;
        const andParts = [ NOT_DELETED_FILTER ];
        if (status) andParts.push({ status: String(status).toLowerCase() });
        if (fulfillmentStatus) andParts.push({ fulfillmentStatus: String(fulfillmentStatus).toLowerCase() });
        if (carrier) andParts.push({ shippingProvider: new RegExp(String(carrier), 'i') });
        if (shippingMethod) andParts.push({ 'shippingMethod.name': new RegExp(String(shippingMethod), 'i') });
        if (country) andParts.push({ 'shippingAddress.country': new RegExp(String(country), 'i') });
        if (warehouseId) andParts.push({ warehouseId: ObjectId.isValid(warehouseId) ? new ObjectId(warehouseId) : warehouseId });
        if (req.query.invoiceNumber) andParts.push({ invoiceNumber: String(req.query.invoiceNumber).trim() });
        if (dateFrom || dateTo) {
            const dateQ = {};
            if (dateFrom) dateQ.$gte = new Date(dateFrom);
            if (dateTo) dateQ.$lte = new Date(dateTo);
            andParts.push({ createdAt: dateQ });
        }
        if (minTotal != null || maxTotal != null) {
            const totalQ = {};
            if (minTotal != null) totalQ.$gte = Number(minTotal);
            if (maxTotal != null) totalQ.$lte = Number(maxTotal);
            andParts.push({ 'totals.total': totalQ });
        }
        const query = { $and: andParts };
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: query
        });
        let orders = (result.success && result.data) ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
        const total = orders.length;
        orders = orders.slice(Number(offset) || 0, (Number(offset) || 0) + (Number(limit) || 50));
        const data = orders.map(o => {
            const customerEmail = o.customer?.email || o.customerEmail || null;
            const customerName =
                o.customer?.name ||
                [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') ||
                o.customerName ||
                null;

            return {
                orderId: o.orderId || o._id?.toString(),
                invoiceNumber: o.invoiceNumber || null,

                // Keep the existing nested shape (admin UI may already rely on it)
                customer: (customerEmail || customerName)
                    ? { email: customerEmail, name: customerName }
                    : null,

                // Deterministic fields for receipt/invoice lookups
                customerEmail,
                customerName,
                // In this backend, customer profiles are keyed by email (`GET /api/customers/:id` reads by { email: id }).
                // So the most reliable deterministic customerId for the admin route is the email itself.
                customerId: customerEmail,

                orderDate: o.createdAt || o.orderDate || o.date,
                paymentStatus: o.paymentStatus || 'unknown',
                fulfillmentStatus: o.fulfillmentStatus || o.status || 'pending',
                shippingMethod: o.shippingMethod?.name || o.shippingMethod || null,
                carrier: o.shippingProvider || null,
                trackingNumber: o.trackingNumber || null,
                total: o.totals?.total ?? o.total ?? 0,
                destinationCountry: o.shippingAddress?.country || o.customer?.country || null,
                warehouseId: o.warehouseId || null
            };
        });
        return res.json({ success: true, data, total, limit: Number(limit) || 50, offset: Number(offset) || 0 });
    } catch (error) {
        logger.error('orders_admin_list_error', { message: error.message });
        return res.status(500).json({ success: false, error: error.message || 'Failed to retrieve orders' });
    }
});

// POST /api/orders/bulk-action - Admin bulk actions
router.post('/bulk-action', authenticateAdmin, async (req, res) => {
    try {
        const { action, orderIds, trackingNumber, carrier } = req.body;
        if (!action || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ success: false, error: 'action and orderIds (array) are required' });
        }
        const results = { processed: 0, updated: [], failed: [] };
        for (const orderId of orderIds) {
            try {
                if (action === 'mark_shipped' && trackingNumber) {
                    const updateResult = await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'orders',
                        command: '--update',
                        data: {
                            filter: { orderId },
                            update: {
                                status: 'shipped',
                                trackingNumber: String(trackingNumber),
                                shippingProvider: carrier || null,
                                updatedAt: new Date().toISOString()
                            }
                        }
                    });
                    if (updateResult.success) results.updated.push(orderId);
                } else if (action === 'cancel') {
                    const updateResult = await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'orders',
                        command: '--update',
                        data: {
                            filter: { orderId },
                            update: { status: 'cancelled', updatedAt: new Date().toISOString() }
                        }
                    });
                    if (updateResult.success) results.updated.push(orderId);
                } else if (action === 'export') {
                    results.updated.push(orderId);
                }
                results.processed++;
            } catch (e) {
                results.failed.push({ orderId, error: e.message });
            }
        }
        return res.json({ success: true, ...results });
    } catch (error) {
        logger.error('orders_bulk_action_error', { message: error.message });
        return res.status(500).json({ success: false, error: error.message || 'Bulk action failed' });
    }
});

// POST /api/orders/generate-labels - Bulk label generation (stub; integrate carrier APIs later)
router.post('/generate-labels', authenticateAdmin, async (req, res) => {
    try {
        const { orderIds } = req.body || {};
        const ids = Array.isArray(orderIds) ? orderIds : [];
        return res.json({
            success: true,
            message: 'Label generation not integrated. Connect carrier APIs (PostNord, DHL, etc.) to enable.',
            orderIds: ids,
            labelUrls: [],
            generated: 0
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message || 'Failed' });
    }
});

// Get orders by customer email (path parameter - for backward compatibility; excludes soft-deleted)
router.get('/customer/:email', async (req, res) => {
    try {
        const { email } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { $and: [ { 'customer.email': email }, NOT_DELETED_FILTER ] }
        });
        
        res.json(result);
    } catch (error) {
        logger.error('orders_customer_list_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve customer orders'
        });
    }
});

// PUT /api/orders/:orderId - Update order (admin); 404 if order is soft-deleted
router.put('/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const updateData = req.body;
        
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!findResult.success || !findResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        const order = Array.isArray(findResult.data) ? findResult.data[0] : findResult.data;
        if (!order || isOrderDeleted(order)) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        // Prepare update data with timeline if status changed
        const finalUpdateData = {
            ...updateData,
            updatedAt: new Date().toISOString()
        };
        
        // Add timeline entry if status is being updated
        if (updateData.status && updateData.status !== order.status) {
            const timelineEntry = {
                status: updateData.status.charAt(0).toUpperCase() + updateData.status.slice(1),
                date: new Date().toISOString(),
                description: generateTimelineDescription(updateData.status, updateData.shippingProvider, updateData.trackingNumber)
            };
            
            finalUpdateData.timeline = [...(order.timeline || []), timelineEntry];
        }
        
        // Update the order
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: finalUpdateData
            }
        });
        
        if (updateResult.success) {
            res.json({
                success: true,
                message: 'Order updated successfully',
                order: updateResult.data
            });
        } else {
            res.status(400).json(updateResult);
        }
    } catch (error) {
        logger.error('orders_update_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to update order'
        });
    }
});

// POST /api/orders/:orderId/status - Update order status with email trigger; 404 if order is soft-deleted
router.post('/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, trackingNumber, shippingProvider, sendEmail = true, changedBy } = req.body;
        
        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Status is required',
                errorCode: 'VALIDATION_ERROR'
            });
        }
        
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!findResult.success || !findResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Order not found',
                errorCode: 'ORDER_NOT_FOUND'
            });
        }
        const order = Array.isArray(findResult.data) ? findResult.data[0] : findResult.data;
        if (!order || isOrderDeleted(order)) {
            return res.status(404).json({
                success: false,
                error: 'Order not found',
                errorCode: 'ORDER_NOT_FOUND'
            });
        }
        const currentStatus = order.status || 'pending';
        const newStatus = String(status).toLowerCase().trim();
        
        // Validate status transition
        const validation = validateTransition(currentStatus, newStatus);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: validation.error,
                errorCode: 'INVALID_STATUS_TRANSITION',
                currentStatus,
                requestedStatus: newStatus
            });
        }
        
        // Check if order is in final state
        if (isFinalState(currentStatus) && currentStatus !== newStatus) {
            return res.status(400).json({
                success: false,
                error: `Cannot update order status. Order is in final state: ${currentStatus}`,
                errorCode: 'FINAL_STATE_REACHED'
            });
        }
        
        // Create status history entry
        const statusHistoryEntry = createStatusHistoryEntry(newStatus, changedBy || 'system');
        
        // Update status timestamps
        const updatedStatusTimestamps = updateStatusTimestamps(order.statusTimestamps || {}, newStatus);
        
        // Prepare timeline entry (for backward compatibility)
        const timelineEntry = {
            status: status.charAt(0).toUpperCase() + status.slice(1),
            date: new Date().toISOString(),
            description: generateTimelineDescription(newStatus, shippingProvider, trackingNumber)
        };
        
        // Prepare update data
        const updateData = {
            status: newStatus,
            updatedAt: new Date().toISOString(),
            timeline: [...(order.timeline || []), timelineEntry],
            statusHistory: [...(order.statusHistory || []), statusHistoryEntry],
            statusTimestamps: updatedStatusTimestamps
        };
        
        // Add shipping fields if provided
        if (shippingProvider) updateData.shippingProvider = shippingProvider;
        if (trackingNumber) updateData.trackingNumber = trackingNumber;
        
        // Update the order
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: updateData
            }
        });
        
        if (updateResult.success) {
            let emailSent = false;
            
            // Send email notification if requested
            if (sendEmail) {
                try {
                    const updatedOrder = { ...order, ...updateData };
                    
                    switch (status) {
                        case 'processing':
                            await emailService.sendOrderProcessingEmail(
                                order.customer.email,
                                updatedOrder
                            );
                            emailSent = true;
                            devLog('Order processing email sent', { orderId });
                            break;
                        case 'shipped':
                            await emailService.sendShippingNotificationEmail(
                                order.customer.email,
                                updatedOrder
                            );
                            emailSent = true;
                            devLog('Shipping notification email sent', { orderId });
                            break;
                        case 'delivered':
                            await emailService.sendDeliveryConfirmationEmail(
                                order.customer.email,
                                updatedOrder
                            );
                            emailSent = true;
                            devLog('Delivery confirmation email sent', { orderId });
                            break;
                    }
                } catch (emailError) {
                    logger.warn('order_patch_status_email_failed', { orderId, message: emailError.message });
                }
            }
            
            res.json({
                success: true,
                message: 'Order status updated successfully',
                order: updateResult.data,
                emailSent
            });
        } else {
            res.status(400).json(updateResult);
        }
    } catch (error) {
        logger.error('order_patch_status_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to update order status'
        });
    }
});

// POST /api/orders/:orderId/notify - Send email notification for order status update
router.post('/:orderId/notify', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, notifyType = 'status_update' } = req.body;

        devLog('[ORDER NOTIFY] Request received', {
            orderId,
            status,
            notifyType,
            timestamp: new Date().toISOString()
        });

        // Validate required parameters
        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter: status',
                emailSent: false
            });
        }

        // Find order
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });

        if (!findResult.success || !findResult.data) {
            devWarn('[ORDER NOTIFY] Order not found:', orderId);
            return res.status(404).json({
                success: false,
                error: 'Order not found',
                emailSent: false
            });
        }

        const order = Array.isArray(findResult.data) ? findResult.data[0] : findResult.data;
        if (!order || isOrderDeleted(order)) {
            return res.status(404).json({
                success: false,
                error: 'Order not found',
                emailSent: false
            });
        }

        // Get customer email
        const customerEmail = order.customer?.email || order.customerEmail || order.email;
        if (!customerEmail) {
            devWarn('[ORDER NOTIFY] Order does not have email address:', orderId);
            return res.status(400).json({
                success: false,
                error: 'Order does not have an email address',
                emailSent: false
            });
        }

        devLog('[ORDER NOTIFY] Sending email notification', { orderId, status });

        // Send email notification
        const emailResult = await emailService.sendOrderStatusUpdateEmail(order, status);

        if (emailResult.success) {
            devLog('[ORDER NOTIFY] Email sent successfully', { orderId, status });
            return res.json({
                success: true,
                message: 'Email notification sent successfully',
                emailSent: true,
                emailTo: customerEmail
            });
        } else {
            logger.error('order_notify_email_failed', {
                orderId,
                message: emailResult.error || emailResult.details || 'unknown'
            });
            return res.status(500).json({
                success: false,
                error: emailResult.error || 'Failed to send email notification',
                emailSent: false,
                details: emailResult.details
            });
        }

    } catch (error) {
        logger.error('order_notify_unhandled_error', {
            message: error.message,
            orderId: req.params.orderId
        });
        
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Failed to send email notification',
                emailSent: false,
                message: error.message
            });
        }
    }
});

const SHIPMENTS_COLL = 'shipments';

// GET /api/orders/:orderId/shipments - List shipments for an order (split shipments)
router.get('/:orderId/shipments', authenticateAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: SHIPMENTS_COLL,
            command: '--read',
            data: { orderId }
        });
        const data = (result.success && Array.isArray(result.data)) ? result.data : [];
        return res.json({ success: true, data });
    } catch (e) {
        logger.error('orders_shipments_get_error', { message: e.message });
        return res.status(500).json({ success: false, error: e.message || 'Failed to get shipments' });
    }
});

// POST /api/orders/:orderId/shipments - Create a shipment (split shipment)
router.post('/:orderId/shipments', authenticateAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { carrier, trackingNumber, warehouseId, status, estimatedDelivery, items } = req.body || {};
        const coll = await db.getCollection('peakmode', SHIPMENTS_COLL);
        const existing = await coll.find({ orderId }).toArray();
        const shipmentIndex = existing.length + 1;
        const doc = {
            orderId,
            shipmentIndex,
            carrier: carrier || null,
            trackingNumber: trackingNumber || null,
            warehouseId: warehouseId || null,
            status: status || 'label_created',
            labelUrl: null,
            estimatedDelivery: estimatedDelivery || null,
            items: Array.isArray(items) ? items : [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const insertResult = await coll.insertOne(doc);
        return res.status(201).json({ success: true, data: { _id: insertResult.insertedId, ...doc } });
    } catch (e) {
        logger.error('orders_shipment_create_error', { message: e.message });
        return res.status(500).json({ success: false, error: e.message || 'Failed to create shipment' });
    }
});

// PUT /api/orders/:orderId/shipments/:shipmentId - Update a shipment
router.put('/:orderId/shipments/:shipmentId', authenticateAdmin, async (req, res) => {
    try {
        const { orderId, shipmentId } = req.params;
        const { carrier, trackingNumber, warehouseId, status, estimatedDelivery, labelUrl, items } = req.body || {};
        const filter = { orderId, _id: ObjectId.isValid(shipmentId) ? new ObjectId(shipmentId) : shipmentId };
        const update = { updatedAt: new Date().toISOString() };
        if (carrier !== undefined) update.carrier = carrier;
        if (trackingNumber !== undefined) update.trackingNumber = trackingNumber;
        if (warehouseId !== undefined) update.warehouseId = warehouseId;
        if (status !== undefined) update.status = status;
        if (estimatedDelivery !== undefined) update.estimatedDelivery = estimatedDelivery;
        if (labelUrl !== undefined) update.labelUrl = labelUrl;
        if (items !== undefined) update.items = Array.isArray(items) ? items : [];
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: SHIPMENTS_COLL,
            command: '--update',
            data: { filter, update }
        });
        if (!result.success) return res.status(result.error && result.error.includes('No document matched') ? 404 : 500).json({ success: false, error: result.error || 'Update failed' });
        return res.json({ success: true });
    } catch (e) {
        logger.error('orders_shipment_update_error', { message: e.message });
        return res.status(500).json({ success: false, error: e.message || 'Failed to update shipment' });
    }
});

// GET /api/orders/:orderId/receipt - Download PDF receipt (admin)
router.get('/:orderId/receipt', authenticateAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        const order = findResult.success && findResult.data ? (Array.isArray(findResult.data) ? findResult.data[0] : findResult.data) : null;
        if (!order || isOrderDeleted(order)) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        if (order.paymentStatus !== 'succeeded') {
            return res.status(400).json({ success: false, error: 'Receipt is only available for paid orders' });
        }
        const receiptPdfService = require('../services/receiptPdfService');
        await receiptPdfService.ensureInvoiceNumberOnOrder(order, db);
        const invoiceNumber = order.invoiceNumber || receiptPdfService.stableInvoiceNumber(orderId);
        const orderForPdf = { ...order, invoiceNumber };
        const { buffer, filename } = await receiptPdfService.generateReceiptPdfBuffer(orderForPdf);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
        return res.send(buffer);
    } catch (e) {
        logger.error('orders_receipt_get_error', { message: e.message });
        return res.status(500).json({ success: false, error: e.message || 'Failed to generate receipt' });
    }
});

// POST /api/orders/:orderId/receipt/email - Resend receipt PDF by email (admin)
router.post('/:orderId/receipt/email', authenticateAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        const order = findResult.success && findResult.data ? (Array.isArray(findResult.data) ? findResult.data[0] : findResult.data) : null;
        if (!order || isOrderDeleted(order)) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        const email = order.customer?.email || order.customerEmail;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Order has no customer email' });
        }
        if (order.paymentStatus !== 'succeeded') {
            return res.status(400).json({ success: false, error: 'Receipt only for paid orders' });
        }
        const receiptPdfService = require('../services/receiptPdfService');
        const emailService = require('../services/emailService');
        await receiptPdfService.ensureInvoiceNumberOnOrder(order, db);
        const invoiceNumber = order.invoiceNumber || receiptPdfService.stableInvoiceNumber(orderId);
        const orderForPdf = { ...order, invoiceNumber };
        const { buffer, filename } = await receiptPdfService.generateReceiptPdfBuffer(orderForPdf);
        const customerName = order.customer?.name || `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() || order.customerName || 'Customer';
        const lang = order.language || 'en';
        const result = await emailService.sendOrderReceiptEmail(email, customerName, orderForPdf, lang, buffer, filename);
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error || 'Send failed' });
        }
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: { receiptSentAt: new Date().toISOString(), invoiceNumber }
            }
        });
        return res.json({ success: true, message: 'Receipt sent', messageId: result.messageId });
    } catch (e) {
        logger.error('orders_receipt_email_error', { message: e.message });
        return res.status(500).json({ success: false, error: e.message || 'Failed to send receipt' });
    }
});

// POST /api/orders/:orderId/generate-label - Create shipment via SHIPIT and get label (logistics automation)
router.post('/:orderId/generate-label', authenticateAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const shipitService = require('../services/shipping/shipitService');
        if (!shipitService.isConfigured()) {
            return res.status(503).json({
                success: false,
                orderId,
                message: 'SHIPIT is not configured. Set SHIPIT_API_KEY and SHIPIT_BASE_URL.',
                labelUrl: null,
                generated: false
            });
        }
        const result = await shipitService.createShipment(orderId);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                orderId,
                message: result.error || 'Failed to create shipment',
                labelUrl: null,
                generated: false
            });
        }
        return res.json({
            success: true,
            orderId,
            message: 'Shipment created. Download label and send tracking to customer.',
            labelUrl: result.shipment?.label_url ?? result.shipment?.labelUrl ?? null,
            trackingNumber: result.shipment?.tracking_number ?? result.shipment?.trackingNumber ?? null,
            shipmentId: result.shipment?.shipit_shipment_id ?? result.shipment?.shipment_id ?? null,
            carrier: result.shipment?.carrier ?? null,
            generated: true
        });
    } catch (e) {
        logger.error('orders_shipit_label_error', { message: e.message });
        return res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

// GET /api/orders/:orderId - Get single order by business `orderId` (e.g. PM…) or (optional) _id; admin only; 404 if soft-deleted
router.get('/:orderId', authenticateAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!result.success || !result.data) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        const order = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!order || isOrderDeleted(order)) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        // Ensure API always returns backend-canonical totals (source of truth).
        // Older orders/drafts may have stale totals from frontend or older engines.
        try {
            const checkoutTotalsService = require('../services/checkoutTotalsService');
            const vatService = require('../services/vatService');
            const normalizeCountryCode = (c) => {
                if (!c || typeof c !== 'string') return '';
                const upper = c.toUpperCase().trim();
                if (upper.length === 2) return upper;
                const map = { SWEDEN: 'SE', GERMANY: 'DE', FRANCE: 'FR', DENMARK: 'DK', NORWAY: 'NO', FINLAND: 'FI', ITALY: 'IT', SPAIN: 'ES', NETHERLANDS: 'NL', POLAND: 'PL', AUSTRIA: 'AT', BELGIUM: 'BE', CROATIA: 'HR', CYPRUS: 'CY', CZECH: 'CZ', CZECHIA: 'CZ', ESTONIA: 'EE', GREECE: 'GR', HUNGARY: 'HU', IRELAND: 'IE', LATVIA: 'LV', LITHUANIA: 'LT', LUXEMBOURG: 'LU', MALTA: 'MT', PORTUGAL: 'PT', ROMANIA: 'RO', SLOVAKIA: 'SK', SLOVENIA: 'SI', BULGARIA: 'BG' };
                return map[upper] || upper;
            };
            const shippingCountryRaw =
                order?.shippingAddress?.country ||
                order?.shippingAddress?.countryCode ||
                order?.customer?.country ||
                order?.customer?.countryCode ||
                vatService.DEFAULT_COUNTRY;
            const country = normalizeCountryCode(String(shippingCountryRaw || ''));
            const vatRate = vatService.getVatRate(country || vatService.DEFAULT_COUNTRY);
            const items = Array.isArray(order?.items) ? order.items : [];
            const shippingGross =
                (order?.totals && (typeof order.totals.shippingGross === 'number' ? order.totals.shippingGross : undefined)) ??
                (order?.totals && (typeof order.totals.shipping === 'number' ? order.totals.shipping : undefined)) ??
                (typeof order?.shippingCost === 'number' ? order.shippingCost : undefined) ??
                0;
            const discountAmount =
                (order?.totals && (typeof order.totals.discountAmount === 'number' ? order.totals.discountAmount : undefined)) ??
                (order?.totals && (typeof order.totals.discount === 'number' ? order.totals.discount : undefined)) ??
                (order?.appliedDiscount && typeof order.appliedDiscount.amount === 'number' ? order.appliedDiscount.amount : undefined) ??
                0;
            const canonicalTotals = checkoutTotalsService.calculateTotals(items, shippingGross, discountAmount, 'SEK', vatRate, { country });
            order.totals = canonicalTotals;
            order.currency = 'SEK';
        } catch (e) {
            // Don't fail the request for totals calc issues
        }

        res.json({ success: true, data: order });
    } catch (error) {
        logger.error('orders_get_one_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve order'
        });
    }
});

/**
 * DELETE /api/orders/:orderId - Soft-delete order (admin)
 * Sets deletedAt on the order so it no longer appears in list (GET /all) or get-by-id.
 * Track (GET /track) returns 200 with orderUnavailable reason 'deleted' after email verification.
 * Idempotent: deleting an already-deleted or non-existent order returns success.
 */
router.delete('/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!findResult.success || !findResult.data) {
            return res.json({ success: true, message: 'Order deleted successfully' });
        }
        
        const order = Array.isArray(findResult.data) ? findResult.data[0] : findResult.data;
        if (!order) {
            return res.json({ success: true, message: 'Order deleted successfully' });
        }
        
        if (isOrderDeleted(order)) {
            return res.json({ success: true, message: 'Order deleted successfully' });
        }
        
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: {
                    deletedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });
        
        if (updateResult.success) {
            res.json({
                success: true,
                message: 'Order deleted successfully'
            });
        } else {
            res.status(400).json(updateResult);
        }
    } catch (error) {
        logger.error('orders_delete_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to delete order'
        });
    }
});

module.exports = router;

