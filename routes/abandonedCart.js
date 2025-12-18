const express = require('express');
const router = express.Router();
const abandonedCartService = require('../services/abandonedCartService');

/**
 * POST /api/abandoned-cart/process
 * Manually trigger abandoned cart processing
 * (Also runs automatically via cron job)
 */
router.post('/process', async (req, res) => {
    try {
        const result = await abandonedCartService.processAbandonedCarts();
        
        if (result.success) {
            return res.status(200).json({
                success: true,
                message: 'Abandoned cart processing completed',
                data: result
            });
        } else {
            return res.status(500).json({
                success: false,
                error: 'Failed to process abandoned carts',
                details: result.error
            });
        }
    } catch (error) {
        console.error('Abandoned cart processing error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/abandoned-cart/test
 * Test abandoned cart email for a specific user
 */
router.post('/test', async (req, res) => {
    try {
        const { userId, email } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId is required'
            });
        }
        
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'email is required for testing'
            });
        }
        
        // Get cart for user
        const getDBInstance = require('../vornifydb/dbInstance');
        const db = getDBInstance();
        
        const cartResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });
        
        if (!cartResult.success || !cartResult.data || !cartResult.data.items || cartResult.data.items.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Cart not found or empty'
            });
        }
        
        const cart = cartResult.data;
        
        // Format cart data
        const formattedItems = abandonedCartService.formatCartItemsForEmail(cart.items);
        const cartTotal = abandonedCartService.formatCartTotal(cart.totals);
        const cartUrl = abandonedCartService.generateCartUrl(userId);
        
        // Send test email
        const emailService = require('../services/emailService');
        const emailResult = await emailService.sendAbandonedCartEmail(
            email,
            'Test Customer',
            formattedItems,
            cartTotal,
            cartUrl
        );
        
        if (emailResult.success) {
            return res.status(200).json({
                success: true,
                message: 'Test abandoned cart email sent',
                data: {
                    email: email,
                    messageId: emailResult.messageId,
                    cartItems: formattedItems,
                    cartTotal: cartTotal,
                    cartUrl: cartUrl
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
        console.error('Abandoned cart test error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router;

