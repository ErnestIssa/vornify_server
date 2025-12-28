const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

/**
 * POST /api/checkout/email-capture
 * Capture email early in checkout process (before payment)
 * This is CRITICAL for abandoned checkout emails to work
 * 
 * Body:
 * {
 *   "email": "user@email.com",
 *   "cartItems": [...],
 *   "total": 799,
 *   "userId": "user123" (optional)
 * }
 */
router.post('/email-capture', async (req, res) => {
    try {
        const { email, cartItems, total, userId } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required',
                errorCode: 'MISSING_EMAIL'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format',
                errorCode: 'INVALID_EMAIL_FORMAT'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const checkoutId = `checkout_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // Create abandoned checkout record
        const abandonedCheckout = {
            id: checkoutId,
            email: normalizedEmail,
            cart: cartItems || [],
            total: total || 0,
            status: 'pending', // Will be changed to 'completed' on payment success
            emailSent: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            userId: userId || null
        };

        // Save to abandoned_checkouts collection
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--create',
            data: abandonedCheckout
        });

        if (saveResult.success) {
            console.log(`✅ [CHECKOUT] Email captured for abandoned checkout:`, {
                checkoutId: checkoutId,
                email: normalizedEmail,
                total: total,
                itemsCount: cartItems?.length || 0
            });

            // Also save email to cart if userId provided (for backward compatibility)
            if (userId) {
                try {
                    const cartResult = await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'carts',
                        command: '--read',
                        data: { userId }
                    });

                    let cart = cartResult.success && cartResult.data ? cartResult.data : {
                        userId,
                        items: cartItems || [],
                        totals: { total: total || 0 },
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };

                    cart.email = normalizedEmail;
                    cart.customerEmail = normalizedEmail;
                    cart.updatedAt = new Date().toISOString();

                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'carts',
                        command: '--upsert',
                        data: {
                            filter: { userId },
                            update: cart
                        }
                    });
                } catch (cartError) {
                    // Don't fail if cart update fails
                    console.warn('⚠️ [CHECKOUT] Failed to update cart with email:', cartError.message);
                }
            }

            res.json({
                success: true,
                message: 'Email captured successfully',
                checkoutId: checkoutId,
                data: {
                    email: normalizedEmail,
                    total: total,
                    itemsCount: cartItems?.length || 0
                }
            });
        } else {
            console.error('❌ [CHECKOUT] Failed to save abandoned checkout:', saveResult);
            res.status(500).json({
                success: false,
                error: 'Failed to capture email',
                errorCode: 'DATABASE_ERROR'
            });
        }
    } catch (error) {
        console.error('❌ [CHECKOUT] Email capture error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to capture email',
            errorCode: 'INTERNAL_ERROR',
            details: error.message
        });
    }
});

/**
 * GET /api/checkout/recover/:checkoutId
 * Recover abandoned checkout and return cart data
 * This endpoint is called when user clicks the recovery link in abandoned checkout email
 * 
 * Returns:
 * {
 *   "success": true,
 *   "checkout": { ... checkout data ... },
 *   "cartItems": [...],
 *   "total": 799
 * }
 */
router.get('/recover/:checkoutId', async (req, res) => {
    try {
        const { checkoutId } = req.params;

        if (!checkoutId) {
            return res.status(400).json({
                success: false,
                error: 'Checkout ID is required',
                errorCode: 'MISSING_CHECKOUT_ID'
            });
        }

        console.log(`🔍 [CHECKOUT] Recovering checkout: ${checkoutId}`);

        // Find abandoned checkout
        const checkoutResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--read',
            data: { id: checkoutId }
        });

        if (!checkoutResult.success || !checkoutResult.data) {
            console.warn(`⚠️ [CHECKOUT] Checkout not found: ${checkoutId}`);
            return res.status(404).json({
                success: false,
                error: 'Checkout not found',
                errorCode: 'CHECKOUT_NOT_FOUND'
            });
        }

        const checkout = Array.isArray(checkoutResult.data) ? checkoutResult.data[0] : checkoutResult.data;

        // Check if checkout is completed
        if (checkout.status === 'completed') {
            return res.status(400).json({
                success: false,
                error: 'This checkout has already been completed',
                errorCode: 'CHECKOUT_COMPLETED'
            });
        }

        // Update checkout recovery timestamp
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--update',
            data: {
                filter: { id: checkoutId },
                update: {
                    recoveredAt: new Date().toISOString(),
                    recoveryCount: (checkout.recoveryCount || 0) + 1,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        console.log(`✅ [CHECKOUT] Checkout recovered: ${checkoutId}`, {
            email: checkout.email,
            itemsCount: checkout.cart?.length || 0,
            total: checkout.total
        });

        res.json({
            success: true,
            message: 'Checkout recovered successfully',
            checkout: {
                id: checkout.id,
                email: checkout.email,
                total: checkout.total,
                createdAt: checkout.createdAt
            },
            cartItems: checkout.cart || [],
            total: checkout.total || 0,
            userId: checkout.userId || null
        });
    } catch (error) {
        console.error('❌ [CHECKOUT] Recover checkout error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to recover checkout',
            errorCode: 'INTERNAL_ERROR',
            details: error.message
        });
    }
});

module.exports = router;

