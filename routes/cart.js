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

// VAT Rate constant (Sweden uses 25% VAT)
const VAT_RATE = 0.25; // 25%

// Helper function to round currency values to 2 decimal places
// Ensures all monetary values are displayed with proper decimal formatting (e.g., 50.00 instead of 50)
function roundToCurrency(value) {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    // Round to 2 decimal places for currency display
    return Math.round(value * 100) / 100;
}

// Helper function to calculate cart totals from items
// CRITICAL: Product prices are VAT-INCLUDED (B2C pricing in Sweden)
// Calculation flow: Gross price (includes VAT) → Apply discount to gross → Extract net and VAT from discounted gross
function calculateCartTotals(cart) {
    const items = cart.items || [];
    
    // Calculate gross subtotal from items (product prices ALREADY include VAT)
    const grossSubtotal = items.reduce((sum, item) => {
        const itemPrice = typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0;
        const itemQuantity = typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : 0;
        return sum + (itemPrice * itemQuantity);
    }, 0);
    
    // Extract net (ex-VAT) from gross price
    // Formula: Net = Gross / (1 + VAT_RATE) = Gross / 1.25
    const netSubtotal = roundToCurrency(grossSubtotal / (1 + VAT_RATE));
    const vatFromGross = roundToCurrency(grossSubtotal - netSubtotal);
    
    // Ensure existing totals are preserved or initialized
    const existingTotals = cart.totals || {};
    const shipping = roundToCurrency(typeof existingTotals.shipping === 'number' && !isNaN(existingTotals.shipping) 
        ? existingTotals.shipping 
        : 0);
    
    const discount = roundToCurrency(typeof existingTotals.discount === 'number' && !isNaN(existingTotals.discount) 
        ? existingTotals.discount 
        : 0);
    
    // Apply discount to GROSS price (VAT-included price)
    const discountedGross = roundToCurrency(Math.max(0, grossSubtotal - discount));
    
    // Extract net and VAT from discounted gross price
    // Net = Discounted Gross / 1.25
    const discountedNet = roundToCurrency(discountedGross / (1 + VAT_RATE));
    const discountedVat = roundToCurrency(discountedGross - discountedNet);
    
    // Total is the discounted gross price + shipping
    const total = roundToCurrency(discountedGross + shipping);
    
    return {
        subtotal: netSubtotal,                            // Net price (ex-VAT) for display
        discount: discount,                               // Discount amount (applied to gross)
        discountedSubtotal: discountedNet,                // Net price after discount (ex-VAT)
        shipping: shipping,                               // Shipping cost
        tax: discountedVat,                               // VAT extracted from discounted gross price
        total: total,                                     // Final total: discounted gross + shipping
        grossSubtotal: grossSubtotal,                     // Original gross price (for reference)
        discountedGross: discountedGross                  // Discounted gross price (for reference)
    };
}

// Helper function to save cart to database (handles full document replacement correctly)
async function saveCartToDatabase(userId, cart, originalCart = null) {
    const cartExists = originalCart !== null;
    
    // CRITICAL: Ensure cart is a plain object, not an array
    if (Array.isArray(cart)) {
        console.error(`❌ [CART SAVE] Cart is an array, expected object for userId: ${userId}`);
        return {
            success: false,
            error: 'Invalid cart data: expected object, received array'
        };
    }
    
    // Ensure cart is a valid object with required fields
    if (!cart || typeof cart !== 'object') {
        console.error(`❌ [CART SAVE] Invalid cart data type for userId: ${userId}`, typeof cart);
        return {
            success: false,
            error: 'Invalid cart data: expected object'
        };
    }
    
    // Ensure cart has required structure
    if (!cart.userId) {
        cart.userId = userId;
    }
    
    // Ensure items is an array (not undefined)
    if (!Array.isArray(cart.items)) {
        cart.items = [];
    }
    
    // Ensure totals object exists
    if (!cart.totals || typeof cart.totals !== 'object') {
        cart.totals = {
            subtotal: 0,
            tax: 0,
            shipping: 0,
            discount: 0,
            discountedSubtotal: 0,
            total: 0
        };
    }
    
    if (cartExists) {
        // Cart exists - use delete + create for full replacement
        // This avoids MongoDB $set issues with arrays/nested objects
        const originalId = originalCart._id;
        
        // Delete existing cart first
        const deleteResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--delete',
            data: { userId }
        });
        
        if (!deleteResult.success) {
            return {
                success: false,
                error: 'Failed to delete existing cart',
                details: deleteResult.error || deleteResult.message || 'Database operation failed'
            };
        }
        
        // Preserve original _id if it exists
        if (originalId) {
            cart._id = originalId;
        }
        
        // Create new cart with updated data - ensure we pass a plain object
        const cartToSave = { ...cart }; // Create a shallow copy to ensure it's a plain object
        const createResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--create',
            data: cartToSave
        });
        
        return createResult;
    } else {
        // Cart doesn't exist - create new one - ensure we pass a plain object
        const cartToSave = { ...cart }; // Create a shallow copy to ensure it's a plain object
        return await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--create',
            data: cartToSave
        });
    }
}

// Helper function to ensure cart has totals calculated
function ensureCartTotals(cart) {
    if (!cart.totals) {
        cart.totals = {};
    }
    
    // CRITICAL: Sync discount from appliedDiscount BEFORE any calculations
    // This ensures discount is properly applied when calculating VAT
    if (cart.appliedDiscount && typeof cart.appliedDiscount.amount === 'number' && !isNaN(cart.appliedDiscount.amount)) {
        cart.totals.discount = roundToCurrency(cart.appliedDiscount.amount);
    }
    
    // If cart has items, recalculate totals from items
    if (cart.items && cart.items.length > 0) {
        const calculatedTotals = calculateCartTotals(cart);
        
        // Use calculated totals to ensure consistency
        cart.totals.subtotal = calculatedTotals.subtotal;
        // Keep discount if already synced from appliedDiscount, otherwise use calculated
        if (!(cart.appliedDiscount && typeof cart.appliedDiscount.amount === 'number' && !isNaN(cart.appliedDiscount.amount))) {
            cart.totals.discount = calculatedTotals.discount;
        }
        cart.totals.discountedSubtotal = calculatedTotals.discountedSubtotal;
        cart.totals.shipping = calculatedTotals.shipping;
        cart.totals.tax = calculatedTotals.tax; // Tax calculated on discounted amount by calculateCartTotals
        cart.totals.total = calculatedTotals.total;
    } else {
        // Cart has no items - ensure all totals are 0 (except shipping if set)
        cart.totals.subtotal = 0;
        cart.totals.discount = roundToCurrency(cart.totals.discount || 0); // Preserve if set from appliedDiscount
        cart.totals.discountedSubtotal = 0;
        cart.totals.shipping = roundToCurrency(typeof cart.totals.shipping === 'number' && !isNaN(cart.totals.shipping) ? cart.totals.shipping : 0);
        cart.totals.tax = 0;
        cart.totals.total = cart.totals.shipping;
    }
    
    // CRITICAL: calculateCartTotals already handles VAT-included pricing correctly
    // It extracts net and VAT from gross prices, applies discount to gross, and recalculates
    // No need to recalculate here - use the values from calculateCartTotals
    // Just ensure all values are properly rounded
    cart.totals.subtotal = roundToCurrency(cart.totals.subtotal || 0);
    cart.totals.discount = roundToCurrency(cart.totals.discount || 0);
    cart.totals.discountedSubtotal = roundToCurrency(cart.totals.discountedSubtotal || 0);
    cart.totals.shipping = roundToCurrency(cart.totals.shipping || 0);
    cart.totals.tax = roundToCurrency(cart.totals.tax || 0);
    cart.totals.total = roundToCurrency(cart.totals.total || 0);
    
    return cart;
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
            
            // CRITICAL: Handle array result from database
            let cartData = cart;
            if (Array.isArray(cart)) {
                cartData = cart.length > 0 ? cart[0] : {
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
            }
            cart = cartData;
            
            // CRITICAL: Ensure all discount fields are properly initialized to prevent NaN values
            // This fixes the issue where discount values show as NaN when returning from checkout
            if (!cart.totals) {
                cart.totals = {};
            }
            
            // Recalculate subtotal from items if missing
            if (!cart.totals.subtotal || isNaN(cart.totals.subtotal) || cart.totals.subtotal === 0) {
                cart.totals.subtotal = (cart.items || []).reduce((sum, item) => {
                    const itemPrice = typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0;
                    const itemQuantity = typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : 0;
                    return sum + (itemPrice * itemQuantity);
                }, 0);
            }
            
            // CRITICAL: Use ensureCartTotals to ensure all calculations are correct
            // This ensures VAT is always calculated on discounted amount (Swedish VAT compliance)
            ensureCartTotals(cart);
            
            // If there's an applied discount, ensure discount totals match appliedDiscount amount
            if (cart.appliedDiscount && typeof cart.appliedDiscount.amount === 'number' && !isNaN(cart.appliedDiscount.amount)) {
                // Sync discount amount from appliedDiscount to totals.discount if they don't match
                if (Math.abs(cart.appliedDiscount.amount - (cart.totals.discount || 0)) > 0.01) {
                    cart.totals.discount = roundToCurrency(cart.appliedDiscount.amount);
                    // Recalculate discountedSubtotal and tax when discount is synced
                    cart.totals.discountedSubtotal = roundToCurrency(cart.totals.subtotal - cart.totals.discount);
                    // CRITICAL SWEDISH VAT COMPLIANCE: Recalculate VAT on discounted amount
                    cart.totals.tax = roundToCurrency(cart.totals.discountedSubtotal * VAT_RATE);
                    cart.totals.total = roundToCurrency(cart.totals.discountedSubtotal + cart.totals.tax + (cart.totals.shipping || 0));
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
        
        // CRITICAL: Ensure we get a single object, not an array
        let existingCartData = null;
        if (cartResult.success && cartResult.data) {
            if (Array.isArray(cartResult.data)) {
                existingCartData = cartResult.data.length > 0 ? cartResult.data[0] : null;
            } else if (typeof cartResult.data === 'object') {
                existingCartData = cartResult.data;
            }
        }
        
        let cart = existingCartData || {
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
        
        // Store original cart BEFORE modifications
        const originalCart = existingCartData ? { ...existingCartData } : null;
        
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
        
        // Update cart totals - all values rounded to 2 decimal places
        const calculatedSubtotal = cart.items.reduce((sum, item) => {
            const itemPrice = typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0;
            const itemQuantity = typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : 0;
            return sum + (itemPrice * itemQuantity);
        }, 0);
        cart.totals.subtotal = roundToCurrency(calculatedSubtotal);
        
        // Ensure discount and discountedSubtotal are calculated correctly (rounded to 2 decimals)
        if (!cart.totals.discount || isNaN(cart.totals.discount)) {
            cart.totals.discount = 0;
        } else {
            cart.totals.discount = roundToCurrency(cart.totals.discount);
        }
        cart.totals.discountedSubtotal = roundToCurrency(cart.totals.subtotal - cart.totals.discount);
        
        // CRITICAL SWEDISH VAT COMPLIANCE: VAT must be calculated on DISCOUNTED subtotal
        // Formula: VAT = (Subtotal - Discount) × VAT_RATE
        // This ensures VAT is charged on the amount actually paid (legally correct)
        if (cart.totals.discountedSubtotal > 0) {
            cart.totals.tax = roundToCurrency(cart.totals.discountedSubtotal * VAT_RATE);
        } else if (cart.totals.subtotal > 0) {
            // Fallback: calculate from subtotal if no discount
            cart.totals.tax = roundToCurrency(cart.totals.subtotal * VAT_RATE);
        } else {
            cart.totals.tax = 0;
        }
        
        // Calculate total: (Subtotal - Discount) + VAT + Shipping (rounded to 2 decimals)
        cart.totals.total = roundToCurrency(cart.totals.discountedSubtotal + cart.totals.tax + cart.totals.shipping);
        cart.updatedAt = new Date().toISOString();
        
        // Save cart to database using helper function (originalCart was set before modifications)
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
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
        
        // Save updated cart using helper function (originalCart was set before modifications)
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
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
        
        // CRITICAL: Ensure we get a single object, not an array
        let cart = cartResult.data;
        if (Array.isArray(cart)) {
            cart = cart.length > 0 ? cart[0] : null;
        }
        
        if (!cart || typeof cart !== 'object') {
            return res.status(404).json({
                success: false,
                error: 'Cart not found'
            });
        }
        
        // Store original cart BEFORE modifications
        const originalCart = { ...cart };
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
        
        // Save updated cart using helper function (originalCart was set before modifications)
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
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
        
        // CRITICAL: Ensure we get a single object, not an array
        let existingCartData = null;
        if (cartResult.success && cartResult.data) {
            if (Array.isArray(cartResult.data)) {
                existingCartData = cartResult.data.length > 0 ? cartResult.data[0] : null;
            } else if (typeof cartResult.data === 'object') {
                existingCartData = cartResult.data;
            }
        }
        
        // Create cart if it doesn't exist (for cases where user enters email before adding items)
        let cart = existingCartData || {
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
        
        // Store original cart BEFORE modifications
        const originalCart = existingCartData ? { ...existingCartData } : null;
        
        // Update email fields
        const normalizedEmail = email.trim().toLowerCase();
        cart.email = normalizedEmail;
        cart.customerEmail = normalizedEmail; // Also save as customerEmail for compatibility
        cart.emailUpdatedAt = new Date().toISOString(); // Track when email was saved
        cart.updatedAt = new Date().toISOString();
        
        // Save updated cart using helper function (originalCart was set before modifications)
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
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

// IMPORTANT: More specific routes must come BEFORE generic routes
// POST /api/cart/:userId/apply-discount - Apply discount code to cart (must come before generic POST /:userId)
// POST /api/cart/:userId/remove-discount - Remove discount from cart (must come before generic POST /:userId)

// POST /api/cart/:userId - Create or update cart with items (sync cart to backend)
// NOTE: This comes after more specific routes to avoid route conflicts
router.post('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { items } = req.body;
        
        console.log(`🛒 [CART SYNC] Syncing cart for userId: ${userId}, items count: ${items?.length || 0}`);
        
        if (!items || !Array.isArray(items)) {
            console.error(`❌ [CART SYNC] Invalid items array for userId: ${userId}`);
            return res.status(400).json({
                success: false,
                error: 'Items array is required'
            });
        }
        
        // Get existing cart or create new one
        const cartResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--read',
            data: { userId }
        });
        
        // CRITICAL: Ensure we get a single object, not an array
        let existingCartData = null;
        if (cartResult.success && cartResult.data) {
            if (Array.isArray(cartResult.data)) {
                // If data is an array, take the first element
                existingCartData = cartResult.data.length > 0 ? cartResult.data[0] : null;
            } else if (typeof cartResult.data === 'object') {
                // If data is an object, use it directly
                existingCartData = cartResult.data;
            }
        }
        
        let cart = existingCartData || {
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
        
        // CRITICAL: Ensure cart is an object, not an array
        if (Array.isArray(cart)) {
            console.error(`❌ [CART SYNC] Cart is an array after initialization for userId: ${userId}`);
            cart = {
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
        }
        
        // Validate and map items
        try {
            cart.items = items.map((item, index) => {
                // Ensure required fields exist
                if (!item.id && !item.productId) {
                    console.warn(`⚠️ [CART SYNC] Item at index ${index} missing id/productId`);
                }
                if (!item.name) {
                    console.warn(`⚠️ [CART SYNC] Item at index ${index} missing name`);
                }
                
                return {
                    cartItemId: item.cartItemId || generateCartItemId(),
                    id: item.id || item.productId || `item_${index}`,
                    name: item.name || 'Unknown Product',
                    price: typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0,
                    image: item.image || '',
                    size: item.size || null,
                    color: item.color || null,
                    sizeId: item.sizeId || null,
                    colorId: item.colorId || null,
                    variantId: item.variantId || null,
                    quantity: typeof item.quantity === 'number' && !isNaN(item.quantity) && item.quantity > 0 ? item.quantity : 1,
                    currency: item.currency || 'SEK',
                    source: item.source || null,
                    addedAt: item.addedAt || new Date().toISOString()
                };
            });
        } catch (mapError) {
            console.error(`❌ [CART SYNC] Error mapping items:`, mapError);
            return res.status(400).json({
                success: false,
                error: 'Invalid cart items format',
                details: mapError.message
            });
        }
        
        // Calculate totals from items
        // CRITICAL: Preserve existing discount if any
        const existingDiscount = (cart.totals && typeof cart.totals.discount === 'number' && !isNaN(cart.totals.discount)) ? cart.totals.discount : 0;
        const existingShipping = (cart.totals && typeof cart.totals.shipping === 'number' && !isNaN(cart.totals.shipping)) ? cart.totals.shipping : 0;
        const existingTax = (cart.totals && typeof cart.totals.tax === 'number' && !isNaN(cart.totals.tax)) ? cart.totals.tax : 0;
        const existingAppliedDiscount = cart.appliedDiscount || null;
        
        // Calculate new totals
        try {
            cart.totals = calculateCartTotals(cart);
        } catch (calcError) {
            console.error(`❌ [CART SYNC] Error calculating totals:`, calcError);
            return res.status(500).json({
                success: false,
                error: 'Failed to calculate cart totals',
                details: calcError.message
            });
        }
        
        // Preserve existing shipping if it was set
        if (existingShipping > 0) {
            cart.totals.shipping = existingShipping;
        }
        
        // Round all totals to 2 decimal places first
        cart.totals.subtotal = roundToCurrency(cart.totals.subtotal);
        cart.totals.discount = roundToCurrency(cart.totals.discount || 0);
        cart.totals.discountedSubtotal = roundToCurrency(cart.totals.discountedSubtotal);
        cart.totals.shipping = roundToCurrency(cart.totals.shipping);
        
        // CRITICAL SWEDISH VAT COMPLIANCE: VAT must be calculated on DISCOUNTED subtotal
        // Formula: VAT = (Subtotal - Discount) × VAT_RATE
        // This ensures VAT is charged on the amount actually paid (legally correct)
        if (cart.totals.discountedSubtotal > 0) {
            cart.totals.tax = roundToCurrency(cart.totals.discountedSubtotal * VAT_RATE);
        } else if (cart.totals.subtotal > 0) {
            // Fallback: calculate from subtotal if no discount
            cart.totals.tax = roundToCurrency(cart.totals.subtotal * VAT_RATE);
        } else {
            // Only use existing tax if subtotal is 0
            cart.totals.tax = roundToCurrency(existingTax);
        }
        
        // Recalculate total: (Subtotal - Discount) + VAT + Shipping
        cart.totals.total = roundToCurrency(cart.totals.discountedSubtotal + cart.totals.tax + cart.totals.shipping);
        
        // If there was an existing discount, reapply it
        if (existingAppliedDiscount && existingAppliedDiscount.code && existingDiscount > 0) {
            try {
                // Recalculate totals with existing discount
                // CRITICAL: cart.totals.subtotal is NET price, but discount must be applied to GROSS price
                const grossSubtotal = roundToCurrency((cart.totals.subtotal || 0) * (1 + VAT_RATE));
                const discountService = require('../services/discountService');
                const recalculationResult = await discountService.calculateOrderTotals(
                    grossSubtotal, // Pass GROSS price (VAT-included), not NET
                    cart.totals.shipping,
                    0, // Tax will be recalculated by service
                    existingAppliedDiscount.code
                );
                
                if (recalculationResult.success) {
                    // All values from discountService are already rounded to 2 decimals
                    cart.totals.discount = recalculationResult.totals.discount;
                    cart.totals.discountedSubtotal = recalculationResult.totals.discountedSubtotal;
                    // CRITICAL SWEDISH VAT COMPLIANCE: Use tax calculated by service (on discounted amount)
                    cart.totals.tax = typeof recalculationResult.totals.tax === 'number' && !isNaN(recalculationResult.totals.tax)
                        ? recalculationResult.totals.tax
                        : roundToCurrency(cart.totals.discountedSubtotal * VAT_RATE);
                    cart.totals.total = roundToCurrency(cart.totals.discountedSubtotal + cart.totals.tax + cart.totals.shipping);
                    
                    // Ensure appliedDiscount amount is rounded
                    if (existingAppliedDiscount && typeof existingAppliedDiscount.amount === 'number') {
                        existingAppliedDiscount.amount = roundToCurrency(existingAppliedDiscount.amount);
                    }
                    cart.appliedDiscount = existingAppliedDiscount;
                } else {
                    // Discount became invalid, remove it - round all values to 2 decimals
                    console.log(`⚠️ [CART SYNC] Existing discount ${existingAppliedDiscount.code} is no longer valid, removing`);
                    cart.totals.discount = 0;
                    cart.totals.discountedSubtotal = roundToCurrency(cart.totals.subtotal);
                    // CRITICAL SWEDISH VAT COMPLIANCE: Recalculate VAT on full subtotal (no discount)
                    cart.totals.tax = roundToCurrency(cart.totals.discountedSubtotal * VAT_RATE);
                    cart.totals.total = roundToCurrency(cart.totals.discountedSubtotal + cart.totals.tax + cart.totals.shipping);
                    cart.appliedDiscount = null;
                }
            } catch (discountError) {
                console.error(`❌ [CART SYNC] Error reapplying discount:`, discountError);
                // Continue without discount if there's an error - round all values
                cart.totals.discount = 0;
                cart.totals.discountedSubtotal = roundToCurrency(cart.totals.subtotal);
                // CRITICAL SWEDISH VAT COMPLIANCE: Recalculate VAT on full subtotal
                cart.totals.tax = roundToCurrency(cart.totals.discountedSubtotal * VAT_RATE);
                cart.totals.total = roundToCurrency(cart.totals.discountedSubtotal + cart.totals.tax + cart.totals.shipping);
                cart.appliedDiscount = null;
            }
        } else {
            // No discount - round all values to 2 decimals
            cart.totals.discount = 0;
            cart.totals.discountedSubtotal = roundToCurrency(cart.totals.subtotal);
            // CRITICAL SWEDISH VAT COMPLIANCE: Calculate VAT on full subtotal (no discount)
            cart.totals.tax = roundToCurrency(cart.totals.discountedSubtotal * VAT_RATE);
            cart.totals.total = roundToCurrency(cart.totals.discountedSubtotal + cart.totals.tax + cart.totals.shipping);
            cart.appliedDiscount = null;
        }
        
        // Ensure all values are valid numbers
        try {
            ensureCartTotals(cart);
        } catch (ensureError) {
            console.error(`❌ [CART SYNC] Error ensuring totals:`, ensureError);
            return res.status(500).json({
                success: false,
                error: 'Failed to validate cart totals',
                details: ensureError.message
            });
        }
        
        cart.updatedAt = new Date().toISOString();
        if (!cart.createdAt) {
            cart.createdAt = new Date().toISOString();
        }
        
        // Use helper function to save cart (handles delete+create for updates)
        // Ensure originalCart is an object, not an array
        let originalCart = existingCartData;
        if (Array.isArray(originalCart)) {
            originalCart = originalCart.length > 0 ? originalCart[0] : null;
        }
        
        // Final validation before saving
        if (Array.isArray(cart)) {
            console.error(`❌ [CART SYNC] Cart is still an array before save for userId: ${userId}`);
            return res.status(500).json({
                success: false,
                error: 'Invalid cart data: cart is an array',
                details: 'Cart must be an object, not an array'
            });
        }
        
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
        if (saveResult.success) {
            console.log(`✅ [CART SYNC] Cart synced successfully for userId: ${userId}, items: ${cart.items.length}, total: ${cart.totals.total}`);
            res.json({
                success: true,
                message: 'Cart synced successfully',
                data: cart
            });
        } else {
            console.error(`❌ [CART SYNC] Database save failed for userId: ${userId}:`, saveResult);
            res.status(500).json({
                success: false,
                error: 'Failed to save cart to database',
                details: saveResult.error || 'Database operation failed'
            });
        }
    } catch (error) {
        console.error(`❌ [CART SYNC] Exception for userId ${req.params.userId}:`, error);
        console.error(`❌ [CART SYNC] Error stack:`, error.stack);
        res.status(500).json({
            success: false,
            error: 'Failed to sync cart',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
                error: 'Cart not found. Please add items to cart first.'
            });
        }
        
        // CRITICAL: Ensure we get a single object, not an array
        let cart = cartResult.data;
        if (Array.isArray(cart)) {
            cart = cart.length > 0 ? cart[0] : null;
        }
        
        if (!cart || typeof cart !== 'object') {
            return res.status(404).json({
                success: false,
                error: 'Cart not found'
            });
        }
        
        // Store original cart BEFORE modifications
        const originalCart = { ...cart };
        
        // CRITICAL: Ensure cart has items before applying discount
        if (!cart.items || cart.items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot apply discount to empty cart. Please add items to cart first.'
            });
        }
        
        // CRITICAL: Ensure cart has totals calculated before applying discount
        // If totals are missing or invalid, calculate them from items
        ensureCartTotals(cart);
        
        // Verify subtotal is valid after ensuring totals
        if (!cart.totals || !cart.totals.subtotal || isNaN(cart.totals.subtotal) || cart.totals.subtotal <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Cart subtotal is invalid. Please ensure cart items have valid prices.'
            });
        }
        
        // CRITICAL: Product prices are VAT-INCLUDED (B2C pricing)
        // cart.totals.subtotal is NET price, but discount must be applied to GROSS price
        // Convert NET to GROSS: Gross = Net × 1.25
        const grossSubtotal = roundToCurrency((cart.totals.subtotal || 0) * (1 + VAT_RATE));
        
        // IMPORTANT: All discount calculations MUST be done on the backend
        // Pass GROSS price so discount is calculated on gross (customer-facing price)
        const discountService = require('../services/discountService');
        
        // Calculate totals with discount using backend service
        // Pass gross price (not net) so discount is calculated correctly on VAT-included price
        const calculationResult = await discountService.calculateOrderTotals(
            grossSubtotal, // Pass GROSS price (VAT-included), not NET
            cart.totals.shipping || 0,
            0, // Tax will be recalculated by service
            discountCode
        );
        
        if (!calculationResult.success) {
            return res.status(400).json({
                success: false,
                error: calculationResult.error || 'Invalid discount code'
            });
        }
        
        // Update cart totals with calculated values from discount service
        // CRITICAL: All values from discountService are already rounded to 2 decimal places
        // The service correctly calculates VAT on discounted amount (Swedish VAT compliance)
        cart.totals.subtotal = typeof calculationResult.totals.subtotal === 'number' && !isNaN(calculationResult.totals.subtotal) 
            ? calculationResult.totals.subtotal 
            : cart.totals.subtotal || 0;
        cart.totals.discount = typeof calculationResult.totals.discount === 'number' && !isNaN(calculationResult.totals.discount) 
            ? calculationResult.totals.discount 
            : 0;
        cart.totals.discountedSubtotal = typeof calculationResult.totals.discountedSubtotal === 'number' && !isNaN(calculationResult.totals.discountedSubtotal)
            ? calculationResult.totals.discountedSubtotal
            : (cart.totals.subtotal || 0) - (cart.totals.discount || 0);
        
        // CRITICAL SWEDISH VAT COMPLIANCE: Use the tax calculated by discountService
        // This tax is calculated on the DISCOUNTED amount (legally correct)
        cart.totals.tax = typeof calculationResult.totals.tax === 'number' && !isNaN(calculationResult.totals.tax)
            ? calculationResult.totals.tax
            : roundToCurrency(cart.totals.discountedSubtotal * VAT_RATE);
        
        // Round all totals to 2 decimal places for proper currency formatting
        cart.totals.subtotal = roundToCurrency(cart.totals.subtotal);
        cart.totals.discount = roundToCurrency(cart.totals.discount);
        cart.totals.discountedSubtotal = roundToCurrency(cart.totals.discountedSubtotal);
        cart.totals.shipping = roundToCurrency(cart.totals.shipping || 0);
        
        cart.totals.total = roundToCurrency(typeof calculationResult.totals.total === 'number' && !isNaN(calculationResult.totals.total)
            ? calculationResult.totals.total
            : cart.totals.discountedSubtotal + cart.totals.shipping + cart.totals.tax);
        
        // Ensure appliedDiscount amount is also rounded
        if (cart.appliedDiscount && typeof cart.appliedDiscount.amount === 'number') {
            cart.appliedDiscount.amount = roundToCurrency(cart.appliedDiscount.amount);
        }
        
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
        
        // Save updated cart using helper function (originalCart was set before modifications)
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
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
                error: 'Cart not found. Please add items to cart first.'
            });
        }
        
        // CRITICAL: Ensure we get a single object, not an array
        let cart = cartResult.data;
        if (Array.isArray(cart)) {
            cart = cart.length > 0 ? cart[0] : null;
        }
        
        if (!cart || typeof cart !== 'object') {
            return res.status(404).json({
                success: false,
                error: 'Cart not found'
            });
        }
        
        // Store original cart BEFORE modifications
        const originalCart = { ...cart };
        
        // CRITICAL: Ensure cart has totals calculated before removing discount
        // If totals are missing or invalid, calculate them from items
        ensureCartTotals(cart);
        
        // CRITICAL SWEDISH VAT COMPLIANCE: ensureCartTotals already calculated tax correctly on discounted amount
        // Do NOT recalculate tax here - ensureCartTotals handles it correctly
        
        // Remove discount - recalculate totals without discount
        // CRITICAL: cart.totals.subtotal is NET price, convert to GROSS for calculation
        const grossSubtotal = roundToCurrency((cart.totals.subtotal || 0) * (1 + VAT_RATE));
        const discountService = require('../services/discountService');
        
        const calculationResult = await discountService.calculateOrderTotals(
            grossSubtotal, // Pass GROSS price (VAT-included), not NET
            cart.totals.shipping || 0,
            0, // Tax will be recalculated by service
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
        cart.totals.subtotal = roundToCurrency(cart.totals.subtotal || 0);
        cart.totals.discountedSubtotal = roundToCurrency(cart.totals.subtotal); // No discount = discountedSubtotal = subtotal
        cart.totals.shipping = roundToCurrency(cart.totals.shipping || 0);
        
        // CRITICAL SWEDISH VAT COMPLIANCE: VAT is calculated on discounted amount
        // Since discount is removed, discountedSubtotal = subtotal, so VAT = subtotal * VAT_RATE
        cart.totals.tax = typeof calculationResult.totals.tax === 'number' && !isNaN(calculationResult.totals.tax)
            ? calculationResult.totals.tax
            : roundToCurrency(cart.totals.discountedSubtotal * VAT_RATE);
        
        cart.totals.total = roundToCurrency(cart.totals.discountedSubtotal + cart.totals.tax + cart.totals.shipping);
        cart.appliedDiscount = null; // Remove discount info
        cart.updatedAt = new Date().toISOString();
        
        // Save updated cart using helper function (originalCart was set before modifications)
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
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
