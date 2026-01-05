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
// CRITICAL SWEDISH VAT COMPLIANCE: Items prices are product prices BEFORE tax
// VAT must be calculated on the DISCOUNTED subtotal (amount actually charged), NOT the original subtotal
// This is legally required in Sweden - VAT is charged on the amount the customer actually pays
function calculateCartTotals(cart) {
    const items = cart.items || [];
    
    // Calculate subtotal from items (product prices before tax)
    const subtotal = items.reduce((sum, item) => {
        const itemPrice = typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0;
        const itemQuantity = typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : 0;
        return sum + (itemPrice * itemQuantity);
    }, 0);
    
    // CRITICAL SWEDISH VAT COMPLIANCE: VAT must be calculated on the DISCOUNTED amount
    // Calculation order: Subtotal → Apply Discount → Calculate VAT on discounted amount → Add Shipping → Total
    
    // Ensure existing totals are preserved or initialized
    const existingTotals = cart.totals || {};
    const shipping = roundToCurrency(typeof existingTotals.shipping === 'number' && !isNaN(existingTotals.shipping) 
        ? existingTotals.shipping 
        : 0);
    
    const discount = roundToCurrency(typeof existingTotals.discount === 'number' && !isNaN(existingTotals.discount) 
        ? existingTotals.discount 
        : 0);
    
    // Calculate discounted subtotal (rounded to 2 decimals)
    const discountedSubtotal = roundToCurrency(Math.max(0, subtotal - discount));
    
    // CRITICAL: VAT must be calculated on DISCOUNTED subtotal, NOT original subtotal
    // This is legally required in Sweden - VAT is charged on the amount actually paid
    // Formula: VAT = (Subtotal - Discount) × VAT_RATE
    let tax = 0;
    if (discountedSubtotal > 0) {
        tax = roundToCurrency(discountedSubtotal * VAT_RATE);
    } else if (subtotal > 0 && discount === 0) {
        // Only calculate from original subtotal if no discount is applied
        tax = roundToCurrency(subtotal * VAT_RATE);
    } else {
        // Preserve existing tax if subtotal is 0
        tax = roundToCurrency(typeof existingTotals.tax === 'number' && !isNaN(existingTotals.tax) ? existingTotals.tax : 0);
    }
    
    // Calculate total: (Subtotal - Discount) + VAT + Shipping
    const total = roundToCurrency(discountedSubtotal + tax + shipping);
    
    return {
        subtotal: roundToCurrency(subtotal),              // Original product prices (before discount)
        discount: discount,                               // Discount amount
        discountedSubtotal: discountedSubtotal,           // Subtotal after discount - this is the taxable amount
        shipping: shipping,                               // Shipping cost
        tax: tax,                                         // VAT calculated on DISCOUNTED amount (legally correct)
        total: total                                      // Final total: (subtotal - discount) + VAT + shipping
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
    
    // If subtotal is missing or invalid, recalculate from items
    if (!cart.totals.subtotal || isNaN(cart.totals.subtotal) || cart.totals.subtotal === undefined) {
        const calculatedTotals = calculateCartTotals(cart);
        cart.totals.subtotal = calculatedTotals.subtotal;
        
        // Only update other fields if they're also missing/invalid
        if (!cart.totals.shipping || isNaN(cart.totals.shipping)) {
            cart.totals.shipping = calculatedTotals.shipping;
        }
        if (!cart.totals.discount || isNaN(cart.totals.discount)) {
            cart.totals.discount = calculatedTotals.discount;
        }
        if (!cart.totals.discountedSubtotal || isNaN(cart.totals.discountedSubtotal)) {
            cart.totals.discountedSubtotal = calculatedTotals.discountedSubtotal;
        }
        // Always recalculate tax from subtotal if subtotal is valid
        if (calculatedTotals.subtotal > 0) {
            cart.totals.tax = calculatedTotals.tax;
        }
        if (!cart.totals.total || isNaN(cart.totals.total)) {
            cart.totals.total = calculatedTotals.total;
        }
    }
    
    // Ensure all totals fields are valid numbers and rounded to 2 decimal places
    cart.totals.subtotal = roundToCurrency(typeof cart.totals.subtotal === 'number' && !isNaN(cart.totals.subtotal) ? cart.totals.subtotal : 0);
    cart.totals.shipping = roundToCurrency(typeof cart.totals.shipping === 'number' && !isNaN(cart.totals.shipping) ? cart.totals.shipping : 0);
    
    // CRITICAL SWEDISH VAT COMPLIANCE: VAT must be calculated on DISCOUNTED subtotal
    // Formula: VAT = (Subtotal - Discount) × VAT_RATE
    const discountedSubtotal = cart.totals.subtotal - cart.totals.discount;
    if (discountedSubtotal > 0) {
        // Calculate VAT on the discounted amount (the amount actually charged)
        cart.totals.tax = roundToCurrency(discountedSubtotal * VAT_RATE);
    } else if (cart.totals.subtotal > 0 && cart.totals.discount === 0) {
        // Only calculate from original subtotal if no discount is applied
        cart.totals.tax = roundToCurrency(cart.totals.subtotal * VAT_RATE);
    } else {
        cart.totals.tax = roundToCurrency(typeof cart.totals.tax === 'number' && !isNaN(cart.totals.tax) ? cart.totals.tax : 0);
    }
    
    cart.totals.discount = roundToCurrency(typeof cart.totals.discount === 'number' && !isNaN(cart.totals.discount) ? cart.totals.discount : 0);
    cart.totals.discountedSubtotal = roundToCurrency(typeof cart.totals.discountedSubtotal === 'number' && !isNaN(cart.totals.discountedSubtotal) 
        ? cart.totals.discountedSubtotal 
        : (cart.totals.subtotal - cart.totals.discount));
    cart.totals.total = roundToCurrency(typeof cart.totals.total === 'number' && !isNaN(cart.totals.total) 
        ? cart.totals.total 
        : (cart.totals.discountedSubtotal + cart.totals.shipping + cart.totals.tax));
    
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
            
            // Ensure all numeric values are valid numbers (not NaN or undefined)
            cart.totals.subtotal = typeof cart.totals.subtotal === 'number' && !isNaN(cart.totals.subtotal) ? cart.totals.subtotal : 0;
            cart.totals.shipping = typeof cart.totals.shipping === 'number' && !isNaN(cart.totals.shipping) ? cart.totals.shipping : 0;
            cart.totals.discount = typeof cart.totals.discount === 'number' && !isNaN(cart.totals.discount) ? cart.totals.discount : 0;
            
            // CRITICAL SWEDISH VAT COMPLIANCE: VAT must be calculated on DISCOUNTED subtotal
            // Formula: VAT = (Subtotal - Discount) × VAT_RATE
            const discountedAmount = cart.totals.subtotal - (cart.totals.discount || 0);
            if (discountedAmount > 0) {
                cart.totals.tax = roundToCurrency(discountedAmount * VAT_RATE);
            } else if (cart.totals.subtotal > 0) {
                cart.totals.tax = roundToCurrency(cart.totals.subtotal * VAT_RATE);
            } else {
                cart.totals.tax = roundToCurrency(typeof cart.totals.tax === 'number' && !isNaN(cart.totals.tax) ? cart.totals.tax : 0);
            }
            
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
                const discountService = require('../services/discountService');
                const recalculationResult = await discountService.calculateOrderTotals(
                    cart.totals.subtotal,
                    cart.totals.shipping,
                    cart.totals.tax,
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
        
        // CRITICAL SWEDISH VAT COMPLIANCE: VAT must be calculated on DISCOUNTED amount
        // The discountService will automatically calculate VAT correctly on the discounted subtotal
        
        // IMPORTANT: All discount calculations MUST be done on the backend
        // Discount is calculated on product price (subtotal), then VAT is calculated on discounted amount
        const discountService = require('../services/discountService');
        
        // Calculate totals with discount using backend service
        // The service will calculate VAT on the discounted amount automatically (Swedish VAT compliance)
        const calculationResult = await discountService.calculateOrderTotals(
            cart.totals.subtotal,
            cart.totals.shipping || 0,
            cart.totals.tax || 0, // Current tax (will be recalculated on discounted amount by service)
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
        
        // CRITICAL: Ensure tax is calculated from subtotal (VAT should always be shown when there are products)
        if (!cart.totals.tax || isNaN(cart.totals.tax) || cart.totals.tax === 0) {
            if (cart.totals.subtotal > 0) {
                cart.totals.tax = cart.totals.subtotal * VAT_RATE;
            } else {
                cart.totals.tax = 0;
            }
        }
        
        // Remove discount - recalculate totals without discount
        // When discount is removed, discountedSubtotal = subtotal, so VAT is calculated on full subtotal
        const discountService = require('../services/discountService');
        
        const calculationResult = await discountService.calculateOrderTotals(
            cart.totals.subtotal || 0,
            cart.totals.shipping || 0,
            0, // Tax will be recalculated on the new discounted amount (which is now full subtotal)
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
