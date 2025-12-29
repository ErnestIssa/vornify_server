const express = require('express');
const router = express.Router();
const paymentFailureService = require('../services/paymentFailureService');

/**
 * GET /api/payment-failure/recover/:retryToken
 * Recover failed checkout and return cart data
 * This endpoint is called when user clicks the retry link in payment failure email
 * 
 * Returns:
 * {
 *   "success": true,
 *   "checkout": { ... checkout data ... },
 *   "cartItems": [...],
 *   "total": 799,
 *   "email": "user@email.com"
 * }
 */
router.get('/recover/:retryToken', async (req, res) => {
    try {
        const { retryToken } = req.params;

        if (!retryToken) {
            return res.status(400).json({
                success: false,
                error: 'Retry token is required',
                errorCode: 'MISSING_RETRY_TOKEN'
            });
        }

        console.log(`🔍 [PAYMENT FAILURE] Recovering failed checkout with token: ${retryToken}`);

        // Get failed checkout by token
        const checkout = await paymentFailureService.getFailedCheckoutByToken(retryToken);

        if (!checkout) {
            console.warn(`⚠️ [PAYMENT FAILURE] Failed checkout not found for token: ${retryToken}`);
            return res.status(404).json({
                success: false,
                error: 'Failed checkout not found',
                errorCode: 'CHECKOUT_NOT_FOUND'
            });
        }

        // Check if checkout is completed
        if (checkout.status === 'completed') {
            return res.status(400).json({
                success: false,
                error: 'This checkout has already been completed',
                errorCode: 'CHECKOUT_COMPLETED'
            });
        }

        console.log(`✅ [PAYMENT FAILURE] Failed checkout recovered:`, {
            id: checkout.id,
            email: checkout.email,
            itemsCount: checkout.cart?.length || 0,
            total: checkout.total
        });

        res.json({
            success: true,
            message: 'Failed checkout recovered successfully',
            checkout: {
                id: checkout.id,
                email: checkout.email,
                total: checkout.total,
                orderId: checkout.orderId,
                createdAt: checkout.createdAt
            },
            cartItems: checkout.cart || [],
            total: checkout.total || 0,
            email: checkout.email,
            retryToken: retryToken,
            // Return customer information if available
            customer: checkout.customer || null,
            // Return shipping address if available
            shippingAddress: checkout.shippingAddress || null,
            // Return shipping method if available
            shippingMethod: checkout.shippingMethod || null
        });
    } catch (error) {
        console.error('❌ [PAYMENT FAILURE] Recover failed checkout error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to recover failed checkout',
            errorCode: 'INTERNAL_ERROR',
            details: error.message
        });
    }
});

/**
 * POST /api/payment-failure/process
 * Manually trigger processing of pending payment failures
 * (Background job runs automatically, but this can be used for testing)
 */
router.post('/process', async (req, res) => {
    if (process.env.ENABLE_PAYMENT_FAILURE_EMAIL === 'false') {
        return res.status(403).json({
            success: false,
            error: 'Payment failure email processing is disabled.'
        });
    }

    try {
        const result = await paymentFailureService.processPendingPaymentFailures();
        res.json(result);
    } catch (error) {
        console.error('Payment failure manual process error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router;
