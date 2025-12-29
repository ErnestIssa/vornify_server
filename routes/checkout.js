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
 *   "userId": "user123" (optional),
 *   "customer": { ... } (optional - customer information),
 *   "shippingAddress": { ... } (optional - shipping address),
 *   "shippingMethod": { ... } (optional - selected shipping method)
 * }
 */
router.post('/email-capture', async (req, res) => {
    // CRITICAL: Log that endpoint was hit
    console.log('🔔 [CHECKOUT] Email capture endpoint HIT:', {
        timestamp: new Date().toISOString(),
        hasEmail: !!req.body.email,
        hasCartItems: !!req.body.cartItems,
        email: req.body.email ? req.body.email.substring(0, 10) + '...' : 'missing',
        cartItemsCount: req.body.cartItems?.length || 0
    });

    try {
        const { email, cartItems, total, userId, customer, shippingAddress, shippingMethod } = req.body;

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
        const now = new Date().toISOString();
        
        console.log('🔍 [CHECKOUT] Checking for existing checkout:', {
            email: normalizedEmail,
            database: 'peakmode',
            collection: 'abandoned_checkouts'
        });
        
        // Check if checkout already exists (user updating existing checkout)
        const existingCheckoutResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--read',
            data: { email: normalizedEmail, status: 'pending' }
        });

        console.log('🔍 [CHECKOUT] Existing checkout check result:', {
            success: existingCheckoutResult.success,
            hasData: !!existingCheckoutResult.data,
            dataType: existingCheckoutResult.data ? (Array.isArray(existingCheckoutResult.data) ? 'array' : 'object') : 'null'
        });
        
        let checkoutId;
        let saveResult;
        let existingCheckout = null;
        
        if (existingCheckoutResult.success && existingCheckoutResult.data) {
            // Extract existing checkout data
            if (Array.isArray(existingCheckoutResult.data)) {
                existingCheckout = existingCheckoutResult.data.length > 0 ? existingCheckoutResult.data[0] : null;
            } else {
                existingCheckout = existingCheckoutResult.data;
            }
            
            // Validate existing checkout has valid ID
            if (existingCheckout && existingCheckout.id) {
                checkoutId = existingCheckout.id;
                
                // Build update object - DO NOT include _id (it's immutable)
                // Only include fields we want to update
                const updateData = {
                    email: normalizedEmail,
                    cart: Array.isArray(cartItems) ? cartItems : (existingCheckout.cart || []),
                    total: typeof total === 'number' ? total : (existingCheckout.total || 0),
                    lastActivityAt: now, // Update activity time (user is active)
                    updatedAt: now
                };

                // Only add optional fields if they have values
                if (userId) updateData.userId = userId;
                if (customer && typeof customer === 'object' && Object.keys(customer).length > 0) {
                    updateData.customer = customer;
                } else if (existingCheckout.customer) {
                    updateData.customer = existingCheckout.customer;
                }
                if (shippingAddress && typeof shippingAddress === 'object' && Object.keys(shippingAddress).length > 0) {
                    updateData.shippingAddress = shippingAddress;
                } else if (existingCheckout.shippingAddress) {
                    updateData.shippingAddress = existingCheckout.shippingAddress;
                }
                if (shippingMethod && typeof shippingMethod === 'object' && Object.keys(shippingMethod).length > 0) {
                    updateData.shippingMethod = shippingMethod;
                } else if (existingCheckout.shippingMethod) {
                    updateData.shippingMethod = existingCheckout.shippingMethod;
                }

                // Log before update for debugging
                console.log('💾 [CHECKOUT] Attempting to update abandoned checkout:', {
                    checkoutId: checkoutId,
                    email: normalizedEmail,
                    hasCartItems: !!cartItems && cartItems.length > 0,
                    cartItemsCount: cartItems?.length || 0,
                    total: total
                });

                saveResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'abandoned_checkouts',
                    command: '--update',
                    data: {
                        filter: { id: checkoutId },
                        update: updateData  // Only update fields, don't include _id
                    }
                });

                // Log result for debugging
                console.log('💾 [CHECKOUT] Database update result:', {
                    success: saveResult.success,
                    status: saveResult.status,
                    message: saveResult.message,
                    error: saveResult.error,
                    data: saveResult.data ? 'present' : 'missing'
                });
            } else {
                // Existing checkout data found but invalid, will create new one
                console.log('⚠️ [CHECKOUT] Existing checkout data found but no valid checkout ID, creating new checkout instead');
                existingCheckout = null; // Clear invalid checkout
            }
        }
        
        // If no checkoutId yet, create new checkout record
        if (!checkoutId) {
            // Create new checkout record
            checkoutId = `checkout_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            // Build abandoned checkout object, only including fields with values (avoid null)
            const abandonedCheckout = {
                id: checkoutId,
                email: normalizedEmail,
                cart: Array.isArray(cartItems) ? cartItems : [],
                total: typeof total === 'number' ? total : 0,
                status: 'pending', // Will be changed to 'completed' on payment success
                emailSent: false,
                createdAt: now,
                lastActivityAt: now, // Track last activity time (user activity, not creation time)
                updatedAt: now
            };

            // Only add optional fields if they have values
            if (userId) abandonedCheckout.userId = userId;
            if (customer && typeof customer === 'object' && Object.keys(customer).length > 0) {
                abandonedCheckout.customer = customer;
            }
            if (shippingAddress && typeof shippingAddress === 'object' && Object.keys(shippingAddress).length > 0) {
                abandonedCheckout.shippingAddress = shippingAddress;
            }
            if (shippingMethod && typeof shippingMethod === 'object' && Object.keys(shippingMethod).length > 0) {
                abandonedCheckout.shippingMethod = shippingMethod;
            }
            
            // Log before save for debugging
            console.log('💾 [CHECKOUT] Attempting to save abandoned checkout:', {
                checkoutId: checkoutId,
                email: normalizedEmail,
                hasCartItems: !!cartItems && cartItems.length > 0,
                cartItemsCount: cartItems?.length || 0,
                total: total
            });

            saveResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'abandoned_checkouts',
                command: '--create',
                data: abandonedCheckout
            });

            // Log result for debugging
            console.log('💾 [CHECKOUT] Database save result:', {
                success: saveResult.success,
                status: saveResult.status,
                message: saveResult.message,
                error: saveResult.error,
                data: saveResult.data ? 'present' : 'missing'
            });
        }

        // Check both success and status (VornifyDB may use either)
        const isSuccess = saveResult.success === true || saveResult.status === true || saveResult.success !== false;
        
        if (isSuccess) {
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
            console.error('❌ [CHECKOUT] Failed to save abandoned checkout:', {
                success: saveResult.success,
                status: saveResult.status,
                message: saveResult.message,
                error: saveResult.error,
                fullResult: JSON.stringify(saveResult, null, 2),
                database: 'peakmode',
                collection: 'abandoned_checkouts',
                checkoutId: checkoutId,
                email: normalizedEmail
            });
            res.status(500).json({
                success: false,
                error: 'Failed to capture email',
                errorCode: 'DATABASE_ERROR',
                details: saveResult.message || saveResult.error || 'Unknown database error',
                database: 'peakmode',
                collection: 'abandoned_checkouts'
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

        // Update checkout recovery timestamp and last activity (user is active again)
        const now = new Date().toISOString();
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--update',
            data: {
                filter: { id: checkoutId },
                update: {
                    recoveredAt: now,
                    lastActivityAt: now, // User is active again
                    recoveryCount: (checkout.recoveryCount || 0) + 1,
                    updatedAt: now
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
            userId: checkout.userId || null,
            // Return customer information if available
            customer: checkout.customer || null,
            // Return shipping address if available
            shippingAddress: checkout.shippingAddress || null,
            // Return shipping method if available
            shippingMethod: checkout.shippingMethod || null
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

/**
 * PUT /api/checkout/activity/:checkoutId
 * Update last activity timestamp for a checkout
 * This should be called periodically while user is active on the site
 * 
 * Body: (optional - no body required, just update timestamp)
 */
router.put('/activity/:checkoutId', async (req, res) => {
    try {
        const { checkoutId } = req.params;

        if (!checkoutId) {
            return res.status(400).json({
                success: false,
                error: 'Checkout ID is required',
                errorCode: 'MISSING_CHECKOUT_ID'
            });
        }

        // Update last activity timestamp
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--update',
            data: {
                filter: { id: checkoutId, status: 'pending' }, // Only update if still pending
                update: {
                    lastActivityAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (updateResult.success) {
            res.json({
                success: true,
                message: 'Activity updated successfully',
                checkoutId: checkoutId
            });
        } else {
            // Checkout might not exist or already completed - that's okay
            res.json({
                success: false,
                message: 'Checkout not found or already completed',
                checkoutId: checkoutId
            });
        }
    } catch (error) {
        console.error('❌ [CHECKOUT] Update activity error:', error);
        // Don't fail - activity updates are best effort
        res.json({
            success: false,
            error: 'Failed to update activity',
            errorCode: 'INTERNAL_ERROR'
        });
    }
});

/**
 * GET /api/checkout/diagnostic
 * Diagnostic endpoint to verify database connectivity and collection access
 */
router.get('/diagnostic', async (req, res) => {
    try {
        console.log('🔍 [CHECKOUT DIAGNOSTIC] Running diagnostic check...');
        
        // Test 1: Check database connection
        const testRead = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--read',
            data: {}
        });
        
        // Test 2: Try to create a test record
        const testCheckout = {
            id: `diagnostic_${Date.now()}`,
            email: 'diagnostic@test.com',
            cart: [{ name: 'Test', quantity: 1 }],
            total: 0,
            status: 'pending',
            emailSent: false,
            createdAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        const testCreate = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'abandoned_checkouts',
            command: '--create',
            data: testCheckout
        });
        
        // Test 3: Try to read it back
        let testReadBack = null;
        if (testCreate.success || testCreate.status) {
            testReadBack = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'abandoned_checkouts',
                command: '--read',
                data: { id: testCheckout.id }
            });
            
            // Clean up test record
            if (testReadBack.success && testReadBack.data) {
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'abandoned_checkouts',
                    command: '--delete',
                    data: { id: testCheckout.id }
                });
            }
        }
        
        res.json({
            success: true,
            diagnostic: {
                database: 'peakmode',
                collection: 'abandoned_checkouts',
                readTest: {
                    success: testRead.success || testRead.status,
                    recordCount: Array.isArray(testRead.data) ? testRead.data.length : (testRead.data ? 1 : 0),
                    error: testRead.error || testRead.message
                },
                createTest: {
                    success: testCreate.success || testCreate.status,
                    error: testCreate.error || testCreate.message,
                    insertedId: testCreate.data?.insertedId || null
                },
                readBackTest: testReadBack ? {
                    success: testReadBack.success || testReadBack.status,
                    found: !!testReadBack.data,
                    error: testReadBack.error || testReadBack.message
                } : null,
                endpoint: 'POST /api/checkout/email-capture',
                routeRegistered: true
            }
        });
    } catch (error) {
        console.error('❌ [CHECKOUT DIAGNOSTIC] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Diagnostic failed',
            details: error.message,
            stack: error.stack
        });
    }
});

module.exports = router;

