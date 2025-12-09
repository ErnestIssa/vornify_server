const express = require('express');
const router = express.Router();
const VornifyPay = require('../vornifypay/vornifypay');
const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('../services/emailService');

// Validate Stripe configuration at startup
if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_SECRET_KEY is missing from environment variables');
} else {
    console.log('✅ STRIPE_SECRET_KEY loaded (length: ' + process.env.STRIPE_SECRET_KEY.length + ')');
}

if (!process.env.STRIPE_PUBLIC_KEY) {
    console.warn('⚠️ STRIPE_PUBLIC_KEY is missing from environment variables');
} else {
    console.log('✅ STRIPE_PUBLIC_KEY loaded (prefix: ' + process.env.STRIPE_PUBLIC_KEY.substring(0, 7) + '...)');
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('⚠️ STRIPE_WEBHOOK_SECRET is missing - webhook signature verification will be disabled');
} else {
    console.log('✅ STRIPE_WEBHOOK_SECRET loaded');
}

// Initialize Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initialize services
let paymentService;
try {
    paymentService = new VornifyPay();
    console.log('✅ VornifyPay service initialized');
} catch (error) {
    console.error('❌ Failed to initialize VornifyPay:', error.message);
}

const db = getDBInstance();

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
        console.error('Check payment methods error:', error);
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
            console.warn('Could not retrieve Apple Pay domains:', applePayError.message);
            config.applePay = {
                enabled: true,
                note: 'Apple Pay is enabled. Domain verification status should be checked in Stripe Dashboard.'
            };
        }

        res.json(config);
    } catch (error) {
        console.error('Config endpoint error:', error);
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
        console.warn('⚠️ STRIPE_WEBHOOK_SECRET not configured. Webhook verification disabled.');
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
        console.error('Webhook signature verification failed:', err.message);
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

        console.log(`Received Stripe webhook: ${event.type} (ID: ${event.id})`);

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
                console.log(`Unhandled event type: ${event.type}`);
        }

        // Always return 200 to acknowledge receipt
        res.json({ received: true });
    } catch (error) {
        console.error('Webhook handler error:', error);
        // Still return 200 to prevent Stripe from retrying
        res.status(200).json({ received: true, error: error.message });
    }
});

// Helper function to handle successful payment
async function handlePaymentIntentSucceeded(paymentIntent) {
    try {
        const orderId = paymentIntent.metadata.orderId;
        if (!orderId) {
            console.warn('Payment intent succeeded but no orderId in metadata');
            return;
        }

        // Find and update order
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });

        if (!findResult.success || !findResult.data) {
            console.error(`⚠️ [PAYMENT WEBHOOK] Payment intent ${paymentIntent.id} succeeded but order ${orderId} not found in database`);
            console.error(`⚠️ [PAYMENT WEBHOOK] This could indicate a duplicate payment or order creation failure`);
            console.error(`⚠️ [PAYMENT WEBHOOK] Payment amount: ${(paymentIntent.amount / 100).toFixed(2)} ${paymentIntent.currency.toUpperCase()}`);
            console.error(`⚠️ [PAYMENT WEBHOOK] Customer: ${paymentIntent.customer || 'N/A'}`);
            // DO NOT create order here - this could be a duplicate payment from a failed frontend attempt
            // Log for investigation but don't process
            return;
        }

        const order = findResult.data;

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

        // Add Stripe customer ID if available
        if (paymentIntent.customer) {
            updateData.stripeCustomerId = paymentIntent.customer;
        }

        // Update order status if it was pending payment
        if (order.status === 'pending' || order.status === 'processing') {
            updateData.status = 'processing';
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

        // Send order confirmation email if not already sent
        if (!order.emailSent && order.customer?.email) {
            try {
                const customerName = order.customer.name || 
                                   `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() ||
                                   order.customerName ||
                                   'Valued Customer';
                
                const orderLanguage = order.language || 'en';
                
                await emailService.sendOrderConfirmationEmail(
                    order.customer.email,
                    customerName,
                    order,
                    orderLanguage
                );
                
                // Mark email as sent
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'orders',
                    command: '--update',
                    data: {
                        filter: { orderId },
                        update: { emailSent: true }
                    }
                });
                
                console.log(`📧 [PAYMENT WEBHOOK] Order confirmation email sent to ${order.customer.email}`);
            } catch (emailError) {
                console.error('❌ [PAYMENT WEBHOOK] Failed to send order confirmation email:', emailError);
            }
        }

        console.log(`✅ [PAYMENT WEBHOOK] Order ${orderId} payment confirmed via webhook`);
    } catch (error) {
        console.error('Error handling payment_intent.succeeded:', error);
        throw error;
    }
}

// Helper function to handle failed payment
async function handlePaymentIntentFailed(paymentIntent) {
    try {
        const orderId = paymentIntent.metadata.orderId;
        if (!orderId) {
            console.warn('Payment intent failed but no orderId in metadata');
            return;
        }

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
                    updatedAt: new Date().toISOString(),
                    timeline: [
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

        console.log(`❌ Order ${orderId} payment failed via webhook`);
    } catch (error) {
        console.error('Error handling payment_intent.payment_failed:', error);
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

        console.log(`⚠️ Order ${orderId} payment canceled via webhook`);
    } catch (error) {
        console.error('Error handling payment_intent.canceled:', error);
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
            console.warn(`Order not found for refunded payment intent ${paymentIntentId}`);
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

        console.log(`💰 Order ${order.orderId} refunded via webhook`);
    } catch (error) {
        console.error('Error handling charge.refunded:', error);
        throw error;
    }
}

/**
 * POST /api/payments/create-intent
 * Create a Stripe payment intent for checkout
 * 
 * Body:
 * {
 *   "amount": 100.00,
 *   "currency": "sek",
 *   "orderId": "PM123456",
 *   "customerEmail": "customer@example.com",
 *   "paymentMethod": "card",
 *   "metadata": { ... }
 * }
 */
router.post('/create-intent', async (req, res) => {
    try {
        const { amount, currency, orderId, customerEmail, paymentMethod, metadata = {} } = req.body;

        // Validate required fields
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Valid amount is required'
            });
        }

        if (!currency) {
            return res.status(400).json({
                success: false,
                error: 'Currency is required'
            });
        }

        // orderId is now optional - can be temporary or added later
        // If not provided, generate a temporary ID
        const tempOrderId = orderId || `TEMP-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const isTemporaryOrderId = !orderId || orderId.startsWith('TEMP-');

        // Convert amount to cents
        const amountInCents = Math.round(parseFloat(amount) * 100);

        // Prepare payment intent metadata
        const paymentMetadata = {
            orderId: tempOrderId,
            isTemporary: isTemporaryOrderId.toString(),
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
                error: 'Amount must be at least 0.01 in the specified currency'
            });
        }

        const paymentIntentParams = {
            amount: amountInCents,
            currency: currencyLower,
            metadata: paymentMetadata,
            // PaymentElement requires automatic_payment_methods (not payment_method_types)
            // This enables Stripe to automatically show available payment methods:
            // - Card (credit/debit cards)
            // - Link (if customer has it saved)
            // - Klarna (if available for amount/currency)
            // - Apple Pay (if device supports it)
            // - Google Pay (if device supports it)
            // - Other wallet payment methods enabled in Stripe Dashboard
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: 'always' // Allows redirect-based payment methods like Klarna
            },
            // Enable 3D Secure authentication for card payments (SCA compliance)
            payment_method_options: {
                card: {
                    request_three_d_secure: 'automatic' // Automatically request 3DS when required (SCA compliance)
                }
            }
            // Note: Removed setup_future_usage to ensure PaymentElement compatibility
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
                console.error('Error creating/retrieving customer:', customerError);
                // Continue without customer - not critical
            }
        }

        // Create payment intent with logging
        console.log(`💳 [PAYMENT] Creating payment intent for order ${tempOrderId}, amount: ${amount} ${currency}`);
        
        // Log the EXACT parameters being sent to Stripe (for debugging)
        const logParams = {
            amount: amountInCents,
            currency: currencyLower,
            automatic_payment_methods: paymentIntentParams.automatic_payment_methods,
            payment_method_options: paymentIntentParams.payment_method_options,
            has_customer: !!paymentIntentParams.customer,
            has_metadata: !!paymentIntentParams.metadata
        };
        console.log(`💳 [PAYMENT] Payment intent params (EXACT):`, JSON.stringify(logParams, null, 2));
        
        // CRITICAL: Verify automatic_payment_methods is set correctly
        if (!paymentIntentParams.automatic_payment_methods || !paymentIntentParams.automatic_payment_methods.enabled) {
            console.error('❌ [PAYMENT] CRITICAL ERROR: automatic_payment_methods is not enabled!');
            return res.status(500).json({
                success: false,
                error: 'Payment intent configuration error: automatic_payment_methods must be enabled',
                code: 'invalid_payment_intent_config'
            });
        }
        
        // CRITICAL: Verify payment_method_types is NOT set (conflicts with automatic_payment_methods)
        if (paymentIntentParams.payment_method_types) {
            console.error('❌ [PAYMENT] CRITICAL ERROR: payment_method_types is set! This conflicts with automatic_payment_methods!');
            return res.status(500).json({
                success: false,
                error: 'Payment intent configuration error: Cannot use both payment_method_types and automatic_payment_methods',
                code: 'conflicting_payment_method_config'
            });
        }
        
        const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
        
        // CRITICAL: Validate payment intent was created correctly
        if (!paymentIntent.client_secret) {
            console.error('❌ [PAYMENT] Payment intent created but client_secret is missing!');
            return res.status(500).json({
                success: false,
                error: 'Payment intent created but client secret is missing',
                code: 'missing_client_secret'
            });
        }
        
        // CRITICAL: Validate status is requires_payment_method (required for PaymentElement)
        if (paymentIntent.status !== 'requires_payment_method') {
            console.error(`❌ [PAYMENT] CRITICAL: Payment intent status is ${paymentIntent.status}, expected 'requires_payment_method'`);
            console.error(`❌ [PAYMENT] PaymentElement will NOT work with status: ${paymentIntent.status}`);
            return res.status(500).json({
                success: false,
                error: `Payment intent status is ${paymentIntent.status}, expected 'requires_payment_method' for PaymentElement`,
                code: 'invalid_payment_intent_status',
                actualStatus: paymentIntent.status,
                expectedStatus: 'requires_payment_method'
            });
        }
        
        // CRITICAL: Validate automatic_payment_methods is enabled (required for PaymentElement)
        if (!paymentIntent.automatic_payment_methods?.enabled) {
            console.error('❌ [PAYMENT] CRITICAL: Payment intent created but automatic_payment_methods is not enabled!');
            console.error('❌ [PAYMENT] PaymentElement will NOT render without automatic_payment_methods enabled!');
            return res.status(500).json({
                success: false,
                error: 'Payment intent created but automatic_payment_methods is not enabled. PaymentElement requires this.',
                code: 'automatic_payment_methods_not_enabled',
                automatic_payment_methods: paymentIntent.automatic_payment_methods
            });
        }
        
        // CRITICAL: Verify payment_method_types is NOT present (conflicts with automatic_payment_methods)
        if (paymentIntent.payment_method_types && paymentIntent.payment_method_types.length > 0) {
            console.warn(`⚠️ [PAYMENT] Warning: Payment intent has payment_method_types: ${paymentIntent.payment_method_types.join(', ')}`);
            console.warn(`⚠️ [PAYMENT] This might conflict with automatic_payment_methods for PaymentElement`);
        }
        
        console.log(`✅ [PAYMENT] Payment intent created: ${paymentIntent.id}`);
        console.log(`✅ [PAYMENT] Status: ${paymentIntent.status} ✅ (correct for PaymentElement)`);
        console.log(`✅ [PAYMENT] Client secret: ${paymentIntent.client_secret ? 'Present ✅' : 'Missing ❌'}`);
        console.log(`✅ [PAYMENT] Automatic payment methods: ${paymentIntent.automatic_payment_methods?.enabled ? 'Enabled ✅' : 'Disabled ❌'}`);
        console.log(`✅ [PAYMENT] Automatic payment methods allow_redirects: ${paymentIntent.automatic_payment_methods?.allow_redirects || 'Not set'}`);
        console.log(`✅ [PAYMENT] Payment method types (auto-determined by Stripe): ${paymentIntent.payment_method_types?.join(', ') || 'None (auto-determined)'}`);
        console.log(`✅ [PAYMENT] Amount: ${paymentIntent.amount} ${paymentIntent.currency}`);
        
        // Log the complete payment intent object for debugging (redact sensitive data)
        console.log(`🔍 [PAYMENT] Payment intent details (VERIFICATION):`, JSON.stringify({
            id: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            automatic_payment_methods: {
                enabled: paymentIntent.automatic_payment_methods?.enabled,
                allow_redirects: paymentIntent.automatic_payment_methods?.allow_redirects
            },
            payment_method_types: paymentIntent.payment_method_types || [],
            payment_method_options: paymentIntent.payment_method_options,
            client_secret_present: !!paymentIntent.client_secret,
            client_secret_prefix: paymentIntent.client_secret ? paymentIntent.client_secret.substring(0, 25) + '...' : 'Missing',
            // Verification flags
            verification: {
                has_client_secret: !!paymentIntent.client_secret,
                status_correct: paymentIntent.status === 'requires_payment_method',
                automatic_payment_methods_enabled: paymentIntent.automatic_payment_methods?.enabled === true,
                ready_for_payment_element: paymentIntent.status === 'requires_payment_method' && 
                                          paymentIntent.automatic_payment_methods?.enabled === true &&
                                          !!paymentIntent.client_secret
            }
        }, null, 2));

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
                console.error('Error updating order with payment intent:', dbError);
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
            amount: amount,
            currency: currency.toLowerCase(),
            orderId: tempOrderId,
            isTemporary: isTemporaryOrderId,
            status: paymentIntent.status,
            // Payment intent uses automatic_payment_methods (PaymentElement requirement)
            automaticPaymentMethods: {
                enabled: paymentIntent.automatic_payment_methods?.enabled || false,
                allow_redirects: paymentIntent.automatic_payment_methods?.allow_redirects || 'always'
            },
            // Actual payment method types available (determined by Stripe based on availability)
            paymentMethodTypes: actualPaymentMethodTypes,
            // Payment methods that will be available in PaymentElement (when supported)
            paymentMethods: {
                card: true,        // Always available with automatic_payment_methods
                link: true,        // Available if customer has Link saved
                klarna: true,      // Available if amount/currency supports it
                applePay: true,    // Available on Safari (iOS/macOS) when device supports it
                googlePay: true   // Available on Chrome/Edge when device supports it
            },
            // Debug info (can be removed in production)
            debug: {
                automatic_payment_methods_enabled: paymentIntent.automatic_payment_methods?.enabled,
                status: paymentIntent.status,
                requires_payment_method: paymentIntent.status === 'requires_payment_method'
            }
        });
    } catch (error) {
        console.error('Create payment intent error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create payment intent',
            code: error.code || 'payment_intent_creation_failed'
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

        console.log(`🔄 [PAYMENT] Updating payment intent ${paymentIntentId} with order ID ${orderId}`);

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
            console.log(`✅ [PAYMENT] Order ${orderId} updated with payment intent ${paymentIntentId}`);
        } catch (dbError) {
            console.error('Error updating order with payment intent:', dbError);
            // Continue even if order update fails
        }

        res.json({
            success: true,
            paymentIntentId: paymentIntent.id,
            orderId: orderId,
            metadata: paymentIntent.metadata
        });
    } catch (error) {
        console.error('Update payment intent error:', error);
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

        // Check payment intent status - prevent duplicate confirmations
        if (paymentIntent.status === 'succeeded') {
            console.log(`⚠️ [PAYMENT] Payment intent ${paymentIntentId} already succeeded`);
            return res.json({
                success: true,
                paymentStatus: 'succeeded',
                orderId: orderId || paymentIntent.metadata.orderId,
                amount: paymentIntent.amount / 100,
                currency: paymentIntent.currency,
                alreadyConfirmed: true,
                message: 'Payment was already confirmed'
            });
        }

        if (paymentIntent.status === 'processing') {
            console.log(`⚠️ [PAYMENT] Payment intent ${paymentIntentId} is already processing`);
            return res.json({
                success: true,
                paymentStatus: 'processing',
                orderId: orderId || paymentIntent.metadata.orderId,
                amount: paymentIntent.amount / 100,
                currency: paymentIntent.currency,
                alreadyProcessing: true,
                message: 'Payment is already being processed - do not call confirmCardPayment again',
                action: 'wait_for_webhook', // Frontend should wait for webhook or poll status
                shouldNotConfirm: true // Explicit flag for frontend
            });
        }

        if (paymentIntent.status === 'canceled') {
            return res.status(400).json({
                success: false,
                error: 'Payment intent has been canceled',
                paymentStatus: 'canceled',
                code: 'payment_canceled'
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

            if (findResult.success && findResult.data) {
                const order = findResult.data;
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

        res.json({
            success: true,
            paymentStatus: paymentIntent.status,
            orderId: targetOrderId,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency
        });
    } catch (error) {
        console.error('Confirm payment error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to confirm payment',
            code: error.code || 'payment_confirmation_failed'
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

        res.json({
            success: true,
            paymentIntentId: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency,
            orderId: paymentIntent.metadata.orderId,
            created: new Date(paymentIntent.created * 1000).toISOString(),
            canConfirm,
            isProcessing,
            isCompleted,
            message: isProcessing 
                ? 'Payment is currently being processed' 
                : isCompleted 
                    ? `Payment is ${paymentIntent.status}` 
                    : canConfirm 
                        ? 'Payment can be confirmed' 
                        : 'Payment status unknown'
        });
    } catch (error) {
        console.error('Get payment status error:', error);
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
                        : `Payment status is ${status} - check Stripe documentation`
        });
    } catch (error) {
        console.error('Check before confirm error:', error);
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
                console.error('Error updating order after refund:', dbError);
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
        console.error('Refund error:', error);
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
        // Log incoming request
        console.log('Payment Request:', JSON.stringify(req.body, null, 2));

        // Process the payment using VornifyPay
        const result = await paymentService.processPayment(req.body);
        
        // Log the result
        console.log('Payment Response:', JSON.stringify(result, null, 2));
        
        // Send response
        if (result.status) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Payment route error:', error);
        res.status(500).json({
            status: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router; 