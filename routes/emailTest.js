const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const getDBInstance = require('../vornifydb/dbInstance');
const abandonedCheckoutService = require('../services/abandonedCheckoutService');
const paymentFailureService = require('../services/paymentFailureService');

const db = getDBInstance();

/**
 * POST /api/email-test/all
 * Test all email automations by sending test emails
 * 
 * Body:
 * {
 *   "email": "test@example.com"
 * }
 */
router.post('/all', async (req, res) => {
    try {
        const { email = 'ernestissa32@gmail.com' } = req.body;
        
        console.log(`🧪 [EMAIL TEST] Testing all email automations for: ${email}`);
        
        const results = {
            success: true,
            email: email,
            tests: {},
            summary: {
                total: 0,
                passed: 0,
                failed: 0
            }
        };

        // Test 1: Order Confirmation Email
        try {
            console.log('🧪 [EMAIL TEST] Testing order confirmation email...');
            const testOrder = {
                orderId: 'PM-TEST-123456',
                orderDate: new Date().toISOString(),
                items: [
                    { name: 'Test Product', quantity: 1, price: 299, total: 299 }
                ],
                totals: { subtotal: 299, shipping: 79, tax: 0, discount: 0, total: 378 },
                shippingAddress: {
                    street: 'Test Street 123',
                    city: 'Stockholm',
                    postalCode: '12345',
                    country: 'SE'
                },
                currency: 'SEK',
                baseCurrency: 'SEK'
            };
            
            const orderConfirmationResult = await emailService.sendOrderConfirmationEmail(
                email,
                'Test Customer',
                testOrder,
                'en'
            );
            
            results.tests.orderConfirmation = orderConfirmationResult;
            results.summary.total++;
            if (orderConfirmationResult.success) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
            }
        } catch (error) {
            results.tests.orderConfirmation = { success: false, error: error.message };
            results.summary.total++;
            results.summary.failed++;
        }

        // Test 2: Abandoned Checkout Email
        try {
            console.log('🧪 [EMAIL TEST] Testing abandoned checkout email...');
            const testCartItems = [
                { name: 'Test Product', quantity: 1, displayPrice: '299 SEK' }
            ];
            const testCartUrl = 'https://peakmode.se/checkout?recover=test_checkout_123';
            
            const abandonedCartResult = await emailService.sendAbandonedCartEmail(
                email,
                'Test Customer',
                testCartItems,
                '299 SEK',
                testCartUrl,
                'first'
            );
            
            results.tests.abandonedCheckout = abandonedCartResult;
            results.summary.total++;
            if (abandonedCartResult.success) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
            }
        } catch (error) {
            results.tests.abandonedCheckout = { success: false, error: error.message };
            results.summary.total++;
            results.summary.failed++;
        }

        // Test 3: Payment Failed Email
        try {
            console.log('🧪 [EMAIL TEST] Testing payment failed email...');
            const testRetryUrl = 'https://peakmode.se/retry-payment/test-retry-token-123';
            
            const paymentFailedResult = await emailService.sendPaymentFailedEmail(
                email,
                'Test Customer',
                'PM-TEST-123456',
                testRetryUrl
            );
            
            results.tests.paymentFailed = paymentFailedResult;
            results.summary.total++;
            if (paymentFailedResult.success) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
            }
        } catch (error) {
            results.tests.paymentFailed = { success: false, error: error.message };
            results.summary.total++;
            results.summary.failed++;
        }

        // Test 4: Newsletter Welcome Email
        try {
            console.log('🧪 [EMAIL TEST] Testing newsletter welcome email...');
            const newsletterResult = await emailService.sendNewsletterWelcomeEmail(
                email,
                'Test Customer',
                'TEST10-OFF'
            );
            
            results.tests.newsletterWelcome = newsletterResult;
            results.summary.total++;
            if (newsletterResult.success) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
            }
        } catch (error) {
            results.tests.newsletterWelcome = { success: false, error: error.message };
            results.summary.total++;
            results.summary.failed++;
        }

        // Test 5: Shipping Notification Email
        try {
            console.log('🧪 [EMAIL TEST] Testing shipping notification email...');
            const shippingOrder = {
                orderId: 'PM-TEST-123456',
                trackingNumber: 'TEST123456',
                trackingUrl: 'https://tracking.test',
                items: [{ name: 'Test Product', quantity: 1 }]
            };
            
            const shippingResult = await emailService.sendShippingNotificationEmail(
                email,
                shippingOrder
            );
            
            results.tests.shippingNotification = shippingResult;
            results.summary.total++;
            if (shippingResult.success) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
            }
        } catch (error) {
            results.tests.shippingNotification = { success: false, error: error.message };
            results.summary.total++;
            results.summary.failed++;
        }

        // Test 6: Delivery Confirmation Email
        try {
            console.log('🧪 [EMAIL TEST] Testing delivery confirmation email...');
            const deliveryOrder = {
                orderId: 'PM-TEST-123456',
                items: [{ name: 'Test Product', quantity: 1 }]
            };
            
            const deliveryResult = await emailService.sendDeliveryConfirmationEmail(
                email,
                deliveryOrder
            );
            
            results.tests.deliveryConfirmation = deliveryResult;
            results.summary.total++;
            if (deliveryResult.success) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
            }
        } catch (error) {
            results.tests.deliveryConfirmation = { success: false, error: error.message };
            results.summary.total++;
            results.summary.failed++;
        }

        results.success = results.summary.failed === 0;
        
        console.log(`🧪 [EMAIL TEST] Test completed: ${results.summary.passed}/${results.summary.total} passed`);
        
        res.json(results);
    } catch (error) {
        console.error('❌ [EMAIL TEST] Error testing emails:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to test emails',
            details: error.message
        });
    }
});

/**
 * POST /api/email-test/abandoned-checkout
 * Test abandoned checkout email capture and processing
 * 
 * Body:
 * {
 *   "email": "test@example.com"
 * }
 */
router.post('/abandoned-checkout', async (req, res) => {
    try {
        const { email = 'ernestissa32@gmail.com' } = req.body;
        
        console.log(`🧪 [EMAIL TEST] Testing abandoned checkout flow for: ${email}`);
        
        // Step 1: Create test checkout record
        const testCheckout = {
            id: `test_checkout_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            email: email.toLowerCase().trim(),
            cart: [
                { name: 'Test Product', quantity: 1, price: 299, id: 'test-product-1' }
            ],
            total: 299,
            status: 'pending',
            emailSent: false,
            secondEmailSent: false,
            createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(), // 11 minutes ago
            lastActivityAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(), // 11 minutes ago (inactive)
            updatedAt: new Date().toISOString()
        };
        
        // Save test checkout
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--create',
            data: testCheckout
        });
        
        if (!saveResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to create test checkout',
                details: saveResult.error
            });
        }
        
        console.log(`✅ [EMAIL TEST] Test checkout created: ${testCheckout.id}`);
        
        // Step 2: Process abandoned checkouts (should find and email this one)
        const processResult = await abandonedCheckoutService.processAbandonedCheckouts();
        
        res.json({
            success: true,
            message: 'Abandoned checkout test completed',
            testCheckout: {
                id: testCheckout.id,
                email: testCheckout.email,
                createdAt: testCheckout.createdAt,
                lastActivityAt: testCheckout.lastActivityAt
            },
            processingResult: processResult
        });
    } catch (error) {
        console.error('❌ [EMAIL TEST] Error testing abandoned checkout:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to test abandoned checkout',
            details: error.message
        });
    }
});

/**
 * POST /api/email-test/payment-failure
 * Test payment failure email flow
 * 
 * Body:
 * {
 *   "email": "test@example.com"
 * }
 */
router.post('/payment-failure', async (req, res) => {
    try {
        const { email = 'ernestissa32@gmail.com' } = req.body;
        
        console.log(`🧪 [EMAIL TEST] Testing payment failure flow for: ${email}`);
        
        // Step 1: Create test failed checkout record (simulating payment failure)
        const testFailedCheckout = {
            id: `test_failed_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            email: email.toLowerCase().trim(),
            cart: [
                { name: 'Test Product', quantity: 1, price: 299, id: 'test-product-1' }
            ],
            total: 299,
            status: 'failed',
            retryToken: require('crypto').randomUUID(),
            emailSent: false,
            orderId: 'PM-TEST-123456',
            paymentIntentId: 'pi_test_123',
            createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(), // 4 minutes ago
            updatedAt: new Date().toISOString(),
            customer: {
                email: email,
                name: 'Test Customer'
            }
        };
        
        // Save test failed checkout
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'failed_checkouts',
            command: '--create',
            data: testFailedCheckout
        });
        
        if (!saveResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to create test failed checkout',
                details: saveResult.error
            });
        }
        
        console.log(`✅ [EMAIL TEST] Test failed checkout created: ${testFailedCheckout.id}`);
        
        // Step 2: Process payment failures (should find and email this one)
        const processResult = await paymentFailureService.processPendingPaymentFailures();
        
        res.json({
            success: true,
            message: 'Payment failure test completed',
            testFailedCheckout: {
                id: testFailedCheckout.id,
                email: testFailedCheckout.email,
                retryToken: testFailedCheckout.retryToken,
                createdAt: testFailedCheckout.createdAt
            },
            processingResult: processResult
        });
    } catch (error) {
        console.error('❌ [EMAIL TEST] Error testing payment failure:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to test payment failure',
            details: error.message
        });
    }
});

/**
 * POST /api/email-test/checkout-capture
 * Test checkout email capture endpoint
 * 
 * Body:
 * {
 *   "email": "test@example.com"
 * }
 */
router.post('/checkout-capture', async (req, res) => {
    try {
        const { email = 'ernestissa32@gmail.com' } = req.body;
        
        console.log(`🧪 [EMAIL TEST] Testing checkout email capture for: ${email}`);
        
        // Call the email capture endpoint
        const testCartItems = [
            { name: 'Test Product', quantity: 1, price: 299, id: 'test-product-1' }
        ];
        
        const captureResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--create',
            data: {
                id: `test_capture_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                email: email.toLowerCase().trim(),
                cart: testCartItems,
                total: 299,
                status: 'pending',
                emailSent: false,
                createdAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        });
        
        if (captureResult.success) {
            // Verify it was saved
            const verifyResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'abandoned_checkouts',
                command: '--read',
                data: { email: email.toLowerCase().trim(), status: 'pending' }
            });
            
            res.json({
                success: true,
                message: 'Checkout email capture test completed',
                captureResult: captureResult,
                verification: {
                    found: verifyResult.success && verifyResult.data,
                    count: Array.isArray(verifyResult.data) ? verifyResult.data.length : (verifyResult.data ? 1 : 0)
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to capture checkout email',
                details: captureResult.error
            });
        }
    } catch (error) {
        console.error('❌ [EMAIL TEST] Error testing checkout capture:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to test checkout capture',
            details: error.message
        });
    }
});

module.exports = router;
