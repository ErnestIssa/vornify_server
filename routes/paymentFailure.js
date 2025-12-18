const express = require('express');
const router = express.Router();
const paymentFailureService = require('../services/paymentFailureService');
const emailService = require('../services/emailService');
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

/**
 * POST /api/payment-failure/process
 * Manually trigger processing of pending payment failure emails
 */
router.post('/process', async (req, res) => {
    try {
        const result = await paymentFailureService.processPendingPaymentFailures();
        
        if (result.success) {
            return res.status(200).json({
                success: true,
                message: 'Payment failure processing completed',
                data: result
            });
        } else {
            return res.status(500).json({
                success: false,
                error: 'Failed to process payment failures',
                details: result.error
            });
        }
    } catch (error) {
        console.error('Payment failure processing error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/payment-failure/test
 * Test payment failure email for a specific order
 */
router.post('/test', async (req, res) => {
    try {
        const { orderId, email } = req.body;
        
        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: 'orderId is required'
            });
        }
        
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'email is required for testing'
            });
        }
        
        // Get order
        const orderResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!orderResult.success || !orderResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        const order = orderResult.data;
        const paymentIntentId = order.paymentIntentId || 'test_payment_intent';
        
        // Generate retry URL
        const paymentRetryUrl = paymentFailureService.generatePaymentRetryUrl(orderId, paymentIntentId);
        
        // Get customer name
        const customerName = order.customer?.name || 
                           `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() ||
                           order.customerName ||
                           'Test Customer';
        
        // Send test email
        const emailResult = await emailService.sendPaymentFailedEmail(
            email,
            customerName,
            orderId,
            paymentRetryUrl
        );
        
        if (emailResult.success) {
            return res.status(200).json({
                success: true,
                message: 'Test payment failure email sent',
                data: {
                    email: email,
                    messageId: emailResult.messageId,
                    orderId: orderId,
                    paymentRetryUrl: paymentRetryUrl
                }
            });
        } else {
            return res.status(500).json({
                success: false,
                error: 'Failed to send test email',
                details: emailResult.error
            });
        }
    } catch (error) {
        console.error('Payment failure test error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router;

