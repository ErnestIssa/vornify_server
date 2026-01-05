const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

// Helper function to validate cart item structure
function validateCartItem(item) {
    const requiredFields = ['id', 'name', 'price', 'quantity'];
    const missingFields = requiredFields.filter(field => !item[field]);
    
    if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }
    
    // Validate variant fields if provided
    if (item.sizeId && typeof item.sizeId !== 'string') {
        throw new Error('sizeId must be a string');
    }
    if (item.colorId && typeof item.colorId !== 'string') {
        throw new Error('colorId must be a string');
    }
    if (item.variantId && typeof item.variantId !== 'string') {
        throw new Error('variantId must be a string');
    }
    
    return true;
}

// Helper function to generate cart item ID
function generateCartItemId() {
    return 'cart_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// GET /api/cart/:userId - Get user's cart
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });
        
        if (result.success) {
            // If cart exists, return it; otherwise return empty cart
            const cart = result.data || {
                userId,
                items: [],
                totals: {
                    subtotal: 0,
                    tax: 0,
                    shipping: 0,
                    discount: 0,
                    discountedSubtotal: 0,
                    total: 0
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            // CRITICAL: Ensure all discount fields are properly initialized to prevent NaN values
            // This fixes the issue where discount values show as NaN when returning from checkout
            if (!cart.totals) {
                cart.totals = {};
            }
            
            // Ensure all numeric values are valid numbers (not NaN or undefined)
            cart.totals.subtotal = typeof cart.totals.subtotal === 'number' && !isNaN(cart.totals.subtotal) ? cart.totals.subtotal : 0;
            cart.totals.tax = typeof cart.totals.tax === 'number' && !isNaN(cart.totals.tax) ? cart.totals.tax : 0;
            cart.totals.shipping = typeof cart.totals.shipping === 'number' && !isNaN(cart.totals.shipping) ? cart.totals.shipping : 0;
            cart.totals.discount = typeof cart.totals.discount === 'number' && !isNaN(cart.totals.discount) ? cart.totals.discount : 0;
            
            // Ensure discountedSubtotal is properly set
            if (typeof cart.totals.discountedSubtotal !== 'number' || isNaN(cart.totals.discountedSubtotal)) {
                cart.totals.discountedSubtotal = cart.totals.subtotal - cart.totals.discount;
            }
            
            // Recalculate total if needed (ensures consistency)
            const calculatedTotal = cart.totals.discountedSubtotal + cart.totals.shipping + cart.totals.tax;
            cart.totals.total = typeof cart.totals.total === 'number' && !isNaN(cart.totals.total) ? cart.totals.total : calculatedTotal;
            
            // If there's an applied discount, ensure it's properly formatted
            if (cart.appliedDiscount) {
                // Ensure discount amount is a valid number
                if (typeof cart.appliedDiscount.amount !== 'number' || isNaN(cart.appliedDiscount.amount)) {
                    cart.appliedDiscount.amount = cart.totals.discount;
                }
            }
            
            res.json({
                success: true,
                data: cart
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve cart'
            });
        }
    } catch (error) {
        console.error('Get cart error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve cart'
        });
    }
});

// POST /api/cart/:userId/add - Add item to cart
router.post('/:userId/add', async (req, res) => {
    try {
        const { userId } = req.params;
        const itemData = req.body;
        
        // Validate item data
        validateCartItem(itemData);
        
        // Generate cart item ID if not provided
        if (!itemData.cartItemId) {
            itemData.cartItemId = generateCartItemId();
        }
        
        // Get existing cart
        const cartResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });
        
        let cart = cartResult.success && cartResult.data ? cartResult.data : {
            userId,
            items: [],
            totals: {
                subtotal: 0,
                tax: 0,
                shipping: 0,
                discount: 0,
                total: 0
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        // Check if item with same product ID and variant already exists
        const existingItemIndex = cart.items.findIndex(item => 
            item.id === itemData.id && 
            item.sizeId === itemData.sizeId && 
            item.colorId === itemData.colorId &&
            item.variantId === itemData.variantId
        );
        
        if (existingItemIndex !== -1) {
            // Update quantity of existing item
            cart.items[existingItemIndex].quantity += itemData.quantity;
        } else {
            // Add new item to cart
            cart.items.push({
                cartItemId: itemData.cartItemId,
                id: itemData.id,
                name: itemData.name,
                price: itemData.price,
                image: itemData.image || '',
                size: itemData.size || null,
                color: itemData.color || null,
                sizeId: itemData.sizeId || null,
                colorId: itemData.colorId || null,
                variantId: itemData.variantId || null,
                quantity: itemData.quantity,
                currency: itemData.currency || 'SEK',
                source: itemData.source || null,
                addedAt: new Date().toISOString()
            });
        }
        
        // Update cart totals
        cart.totals.subtotal = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        cart.totals.total = cart.totals.subtotal + cart.totals.tax + cart.totals.shipping - cart.totals.discount;
        cart.updatedAt = new Date().toISOString();
        
        // Save cart to database
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--upsert',
            data: {
                filter: { userId },
                update: cart
            }
        });
        
        if (saveResult.success) {
            res.json({
                success: true,
                message: 'Item added to cart',
                data: cart
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to save cart'
            });
        }
    } catch (error) {
        console.error('Add to cart error:', error);
        res.status(400).json({
            success: false,
            error: error.message || 'Failed to add item to cart'
        });
    }
});

// PUT /api/cart/:userId/update - Update cart item quantity
router.put('/:userId/update', async (req, res) => {
    try {
        const { userId } = req.params;
        const { cartItemId, quantity } = req.body;
        
        if (!cartItemId || quantity === undefined) {
            return res.status(400).json({
                success: false,
                error: 'cartItemId and quantity are required'
            });
        }
        
        if (quantity < 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantity cannot be negative'
            });
        }
        
        // Get existing cart
        const cartResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });
        
        if (!cartResult.success || !cartResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Cart not found'
            });
        }
        
        const cart = cartResult.data;
        const itemIndex = cart.items.findIndex(item => item.cartItemId === cartItemId);
        
        if (itemIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Item not found in cart'
            });
        }
        
        if (quantity === 0) {
            // Remove item from cart
            cart.items.splice(itemIndex, 1);
        } else {
            // Update quantity
            cart.items[itemIndex].quantity = quantity;
        }
        
        // Update cart totals
        cart.totals.subtotal = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        cart.totals.total = cart.totals.subtotal + cart.totals.tax + cart.totals.shipping - cart.totals.discount;
        cart.updatedAt = new Date().toISOString();
        
        // Save updated cart
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--upsert',
            data: {
                filter: { userId },
                update: cart
            }
        });
        
        if (saveResult.success) {
            res.json({
                success: true,
                message: quantity === 0 ? 'Item removed from cart' : 'Cart item updated',
                data: cart
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to update cart'
            });
        }
    } catch (error) {
        console.error('Update cart error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update cart'
        });
    }
});

// DELETE /api/cart/:userId/remove/:cartItemId - Remove specific item from cart
router.delete('/:userId/remove/:cartItemId', async (req, res) => {
    try {
        const { userId, cartItemId } = req.params;
        
        // Get existing cart
        const cartResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });
        
        if (!cartResult.success || !cartResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Cart not found'
            });
        }
        
        const cart = cartResult.data;
        const itemIndex = cart.items.findIndex(item => item.cartItemId === cartItemId);
        
        if (itemIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Item not found in cart'
            });
        }
        
        // Remove item from cart
        cart.items.splice(itemIndex, 1);
        
        // Update cart totals
        cart.totals.subtotal = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        cart.totals.total = cart.totals.subtotal + cart.totals.tax + cart.totals.shipping - cart.totals.discount;
        cart.updatedAt = new Date().toISOString();
        
        // Save updated cart
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--upsert',
            data: {
                filter: { userId },
                update: cart
            }
        });
        
        if (saveResult.success) {
            res.json({
                success: true,
                message: 'Item removed from cart',
                data: cart
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to remove item from cart'
            });
        }
    } catch (error) {
        console.error('Remove from cart error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to remove item from cart'
        });
    }
});

// DELETE /api/cart/:userId/clear - Clear entire cart
router.delete('/:userId/clear', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--delete',
            data: { userId }
        });
        
        res.json({
            success: true,
            message: 'Cart cleared successfully'
        });
    } catch (error) {
        console.error('Clear cart error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear cart'
        });
    }
});

// PUT /api/cart/:userId/save-email - Save customer email to cart (for abandoned cart emails)
router.put('/:userId/save-email', async (req, res) => {
    try {
        const { userId } = req.params;
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }
        
        // Get existing cart
        const cartResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });
        
        // Create cart if it doesn't exist (for cases where user enters email before adding items)
        let cart = cartResult.success && cartResult.data ? cartResult.data : {
            userId,
            items: [],
            totals: {
                subtotal: 0,
                tax: 0,
                shipping: 0,
                discount: 0,
                total: 0
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        // Update email fields
        const normalizedEmail = email.trim().toLowerCase();
        cart.email = normalizedEmail;
        cart.customerEmail = normalizedEmail; // Also save as customerEmail for compatibility
        cart.emailUpdatedAt = new Date().toISOString(); // Track when email was saved
        cart.updatedAt = new Date().toISOString();
        
        // Save updated cart
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--upsert',
            data: {
                filter: { userId },
                update: cart
            }
        });
        
        if (saveResult.success) {
            console.log(`📧 [CART] Email saved to cart for user ${userId}:`, {
                email: normalizedEmail,
                hasItems: (cart.items?.length || 0) > 0,
                itemsCount: cart.items?.length || 0,
                total: cart.totals?.total || 0
            });
            
            res.json({
                success: true,
                message: 'Email saved to cart',
                data: {
                    userId: cart.userId,
                    email: cart.email,
                    itemsCount: cart.items?.length || 0,
                    hasItems: (cart.items?.length || 0) > 0
                }
            });
        } else {
            console.error(`❌ [CART] Failed to save email to cart for user ${userId}`);
            res.status(500).json({
                success: false,
                error: 'Failed to save email to cart'
            });
        }
    } catch (error) {
        console.error('Save email to cart error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save email to cart'
        });
    }
});

// POST /api/cart/:userId/apply-discount - Apply discount code to cart
router.post('/:userId/apply-discount', async (req, res) => {
    try {
        const { userId } = req.params;
        const { discountCode } = req.body;
        
        if (!discountCode) {
            return res.status(400).json({
                success: false,
                error: 'Discount code is required'
            });
        }
        
        // Get existing cart
        const cartResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });
        
        if (!cartResult.success || !cartResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Cart not found'
            });
        }
        
        const cart = cartResult.data;
        
        // IMPORTANT: All discount calculations MUST be done on the backend
        // Discount is calculated on product price (subtotal) BEFORE tax
        const discountService = require('../services/discountService');
        
        // Calculate totals with discount using backend service
        const calculationResult = await discountService.calculateOrderTotals(
            cart.totals.subtotal || 0,
            cart.totals.shipping || 0,
            cart.totals.tax || 0,
            discountCode
        );
        
        if (!calculationResult.success) {
            return res.status(400).json({
                success: false,
                error: calculationResult.error || 'Invalid discount code'
            });
        }
        
        // Update cart totals with calculated values
        // CRITICAL: Ensure all values are valid numbers (not NaN)
        cart.totals.discount = typeof calculationResult.totals.discount === 'number' && !isNaN(calculationResult.totals.discount) 
            ? calculationResult.totals.discount 
            : 0;
        cart.totals.discountedSubtotal = typeof calculationResult.totals.discountedSubtotal === 'number' && !isNaN(calculationResult.totals.discountedSubtotal)
            ? calculationResult.totals.discountedSubtotal
            : (cart.totals.subtotal || 0) - (cart.totals.discount || 0);
        cart.totals.total = typeof calculationResult.totals.total === 'number' && !isNaN(calculationResult.totals.total)
            ? calculationResult.totals.total
            : cart.totals.discountedSubtotal + (cart.totals.shipping || 0) + (cart.totals.tax || 0);
        
        // Store applied discount information
        if (calculationResult.appliedDiscount) {
            cart.appliedDiscount = {
                code: calculationResult.appliedDiscount.code || discountCode,
                percentage: typeof calculationResult.appliedDiscount.percentage === 'number' && !isNaN(calculationResult.appliedDiscount.percentage)
                    ? calculationResult.appliedDiscount.percentage
                    : 10,
                amount: typeof calculationResult.appliedDiscount.amount === 'number' && !isNaN(calculationResult.appliedDiscount.amount)
                    ? calculationResult.appliedDiscount.amount
                    : cart.totals.discount,
                appliedAt: calculationResult.appliedDiscount.appliedAt || new Date().toISOString()
            };
        }
        
        cart.updatedAt = new Date().toISOString();
        
        // Save updated cart
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--upsert',
            data: {
                filter: { userId },
                update: cart
            }
        });
        
        if (saveResult.success) {
            res.json({
                success: true,
                message: 'Discount applied successfully',
                data: cart
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to apply discount'
            });
        }
    } catch (error) {
        console.error('Apply discount error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to apply discount'
        });
    }
});

// POST /api/cart/:userId/remove-discount - Remove discount code from cart
router.post('/:userId/remove-discount', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Get existing cart
        const cartResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });
        
        if (!cartResult.success || !cartResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Cart not found'
            });
        }
        
        const cart = cartResult.data;
        
        // Remove discount - recalculate totals without discount
        const discountService = require('../services/discountService');
        const calculationResult = await discountService.calculateOrderTotals(
            cart.totals.subtotal || 0,
            cart.totals.shipping || 0,
            cart.totals.tax || 0,
            null // No discount code
        );
        
        if (!calculationResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to recalculate cart totals'
            });
        }
        
        // Update cart totals without discount
        cart.totals.discount = 0;
        cart.totals.discountedSubtotal = cart.totals.subtotal || 0;
        cart.totals.total = calculationResult.totals.total;
        cart.appliedDiscount = null; // Remove discount info
        cart.updatedAt = new Date().toISOString();
        
        // Save updated cart
        const saveResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--upsert',
            data: {
                filter: { userId },
                update: cart
            }
        });
        
        if (saveResult.success) {
            res.json({
                success: true,
                message: 'Discount removed successfully',
                data: cart
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to remove discount'
            });
        }
    } catch (error) {
        console.error('Remove discount error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to remove discount'
        });
    }
});

module.exports = router;
