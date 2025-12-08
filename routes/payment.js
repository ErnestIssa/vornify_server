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
 * GET /api/payments/config
 * Check Stripe configuration status (does not expose keys)
 */
router.get('/config', (req, res) => {
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
        }
    };

    res.json(config);
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

        // Prepare payment intent parameters
        const paymentIntentParams = {
            amount: amountInCents,
            currency: currency.toLowerCase(),
            metadata: paymentMetadata,
            automatic_payment_methods: {
                enabled: true
            },
            // Enable 3D Secure authentication
            payment_method_options: {
                card: {
                    request_three_d_secure: 'automatic' // Automatically request 3DS when required by card issuer
                }
            },
            // Use automatic confirmation method
            confirmation_method: 'automatic'
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
        const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
        console.log(`✅ [PAYMENT] Payment intent created: ${paymentIntent.id}, status: ${paymentIntent.status}`);

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

        res.json({
            success: true,
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.client_secret,
            amount: amount,
            currency: currency.toLowerCase(),
            orderId: tempOrderId,
            isTemporary: isTemporaryOrderId
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