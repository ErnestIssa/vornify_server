const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const checkoutTotalsService = require('../services/checkoutTotalsService');
const vatService = require('../services/vatService');
const currencySelectionService = require('../services/currencySelectionService');
const currencyService = require('../services/currencyService');
const { buildCartVersionSource, computeCartVersion } = require('../core/guards/cartVersion');
const { DISCOUNT_ADJUSTMENT_REMOVED } = require('../core/guards/discountLifecycle');
const { ErrorCodes } = require('../core/errors/codes');
const { AppError } = require('../core/errors/AppError');
const { devLog, devWarn } = require('../core/logging/devConsole');
const { logger } = require('../core/logging/logger');

const db = getDBInstance();
const STORE_BASE_CURRENCY = 'SEK';
const VAT_RATE_SE = 0.25;

/** Build product lookup query by id (string or ObjectId). */
function buildProductLookupQuery(id) {
    if (!id) return { id: '' };
    if (/^[a-fA-F0-9]{24}$/.test(String(id))) {
        try {
            const { ObjectId } = require('mongodb');
            return { $or: [ { id: String(id) }, { _id: new ObjectId(id) } ] };
        } catch (e) {
            return { id: String(id) };
        }
    }
    return { id: String(id) };
}

/**
 * Fetch product's price in SEK (gross, VAT-inclusive) so cart always stores one currency.
 * Returns null if product not found or price missing.
 */
async function getProductPriceSEKGross(productId) {
    if (!productId) return null;
    try {
        const query = buildProductLookupQuery(productId);
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: query
        });
        if (!result.success || !result.data) return null;
        const product = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!product) return null;
        const basePrice = typeof product.price === 'number' && !isNaN(product.price) ? product.price : 0;
        return Math.round(basePrice * (1 + VAT_RATE_SE) * 100) / 100;
    } catch (e) {
        devWarn('[cart] getProductPriceSEKGross failed', productId, e.message);
        return null;
    }
}

/** Fetch product doc for inventory enforcement (best-effort). */
async function getProductForCart(productId) {
    if (!productId) return null;
    try {
        const query = buildProductLookupQuery(productId);
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: query
        });
        if (!result.success || !result.data) return null;
        return Array.isArray(result.data) ? result.data[0] : result.data;
    } catch (e) {
        devWarn('[cart] getProductForCart failed', productId, e.message);
        return null;
    }
}

function pickVariantForItem(product, item) {
    const inv = product?.inventory;
    const variants = Array.isArray(inv?.variants) ? inv.variants : [];
    const variantId = item?.variantId != null ? String(item.variantId) : null;
    const colorId = item?.colorId != null ? String(item.colorId) : null;
    const sizeId = item?.sizeId != null ? String(item.sizeId) : null;

    if (variantId) {
        return variants.find(v => String(v?.id) === variantId) || null;
    }
    if (colorId && sizeId) {
        return variants.find(v => String(v?.colorId) === colorId && String(v?.sizeId) === sizeId) || null;
    }
    return null;
}

function clampQuantity(requested, available) {
    const reqQ = typeof requested === 'number' && !isNaN(requested) ? requested : Number(requested);
    const aQ = typeof available === 'number' && !isNaN(available) ? available : Number(available);
    const rq = Number.isFinite(reqQ) ? reqQ : 1;
    const aq = Number.isFinite(aQ) ? aQ : 0;
    const normalizedReq = rq > 0 ? Math.floor(rq) : 0;
    const normalizedAvail = aq > 0 ? Math.floor(aq) : 0;
    return Math.max(0, Math.min(normalizedReq, normalizedAvail));
}

function normalizeCartItemId(raw, index) {
    return raw?.id || raw?.productId || `item_${index}`;
}

/** Convert totals object (all numeric values) from SEK to display currency; add currency and currencySymbol. */
function convertTotalsToCurrency(totals, rate, currency, currencySymbol) {
    if (!totals || rate === 1) {
        if (totals) {
            totals.currency = currency || STORE_BASE_CURRENCY;
            totals.currencySymbol = currencySymbol || currencySelectionService.getCurrencySymbol(currency || STORE_BASE_CURRENCY);
        }
        return totals;
    }
    const converted = {};
    for (const [k, v] of Object.entries(totals)) {
        converted[k] = typeof v === 'number' && !isNaN(v) ? Math.round(v * rate * 100) / 100 : v;
    }
    converted.currency = currency;
    converted.currencySymbol = currencySymbol;
    return converted;
}

/** Resolve display currency from request and convert totals from SEK if needed; returns { totals, rateFromSEK } (rateFromSEK = 1 for SEK). */
async function ensureTotalsWithDisplayCurrency(totals, req) {
    const { currency: displayCurrency, currencySymbol } = currencySelectionService.getDisplayCurrencyFromRequest(req);
    if (displayCurrency && displayCurrency !== STORE_BASE_CURRENCY) {
        try {
            const rate = await currencyService.getExchangeRate(STORE_BASE_CURRENCY, displayCurrency);
            const converted = convertTotalsToCurrency(totals, rate, displayCurrency, currencySymbol);
            return { totals: converted, rateFromSEK: rate };
        } catch (e) {
            totals.currency = STORE_BASE_CURRENCY;
            totals.currencySymbol = currencySelectionService.getCurrencySymbol(STORE_BASE_CURRENCY);
            return { totals, rateFromSEK: 1 };
        }
    }
    totals.currency = displayCurrency || STORE_BASE_CURRENCY;
    totals.currencySymbol = currencySymbol || currencySelectionService.getCurrencySymbol(displayCurrency || STORE_BASE_CURRENCY);
    return { totals, rateFromSEK: 1 };
}

/** Add priceInDisplayCurrency to each cart item for frontend display (item.price is always SEK). */
function enrichCartItemsForDisplay(cart, rateFromSEK) {
    if (!cart || !cart.items || rateFromSEK == null) return cart;
    cart.items = cart.items.map(item => ({
        ...item,
        priceInDisplayCurrency: Math.round((typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0) * rateFromSEK * 100) / 100
    }));
    return cart;
}

/** Get country and VAT rate for this request (Cloudflare CF-IPCountry or ?country= override). */
function getVatOptsFromRequest(req) {
    const { country, vatRate } = vatService.getCountryAndVatFromRequest(req);
    return { country, vatRate };
}

/**
 * Backend single source of truth: compute totals from cart (items, shipping, discount).
 * Uses VAT rate for the given country (IP or shipping). Pass opts from getVatOptsFromRequest(req) or { country, vatRate }.
 */
function getBackendTotals(cart, opts = {}) {
    const items = cart?.items || [];
    const shipping = (cart?.totals && (typeof cart.totals.shippingGross === 'number' ? cart.totals.shippingGross : cart.totals.shipping)) || 0;
    const discountAmount = (cart?.appliedDiscount && typeof cart.appliedDiscount.amount === 'number') ? cart.appliedDiscount.amount : 0;
    const country = opts.country || vatService.DEFAULT_COUNTRY;
    const vatRate = typeof opts.vatRate === 'number' ? opts.vatRate : vatService.getVatRate(country);
    return checkoutTotalsService.calculateTotals(items, shipping, discountAmount, 'SEK', vatRate, { country });
}

function attachCartVersion(cart, req) {
    // Cart version includes appliedDiscount + items/qty/price. Shipping inputs can be added later
    // once the cart stores shipping method/address; for now we version core cart state.
    const source = buildCartVersionSource({
        cart,
        shippingAddress: null,
        shippingMethod: null,
        discountCode: null
    });
    const v = computeCartVersion(source);
    cart.cartVersion = v;
    // ETag-like hint for clients to coordinate.
    if (req?.res) {
        try {
            req.res.setHeader('X-Cart-Version', v);
        } catch {
            // ignore
        }
    }
    return v;
}

function getIncomingCartVersion(req) {
    const h = req.headers['if-match'] || req.headers['x-cart-version'];
    if (typeof h === 'string' && h.trim() !== '') return h.trim().slice(0, 64);
    const bodyV = req.body?.cartVersion;
    if (typeof bodyV === 'string' && bodyV.trim() !== '') return bodyV.trim().slice(0, 64);
    return null;
}

async function respondCartConflict(res, req, cart, message) {
    const vatOpts = getVatOptsFromRequest(req);
    let totals = getBackendTotals(cart, vatOpts);
    const { totals: resolvedTotals, rateFromSEK } = await ensureTotalsWithDisplayCurrency(totals, req);
    totals = resolvedTotals;
    cart.totals = totals;
    enrichCartItemsForDisplay(cart, rateFromSEK);
    const cartVersion = attachCartVersion(cart, req);
    return res.status(409).json({
        success: false,
        code: ErrorCodes.CART_STALE,
        error: 'Cart was updated elsewhere',
        userMessage: 'Your cart changed in another tab/device. We refreshed it—please review and try again.',
        message,
        cart,
        totals,
        cartVersion,
        currency: totals.currency,
        currencySymbol: totals.currencySymbol
    });
}

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
        logger.error('cart_save_invalid_shape_array', { userId });
        return {
            success: false,
            error: 'Invalid cart data: expected object, received array'
        };
    }
    
    // Ensure cart is a valid object with required fields
    if (!cart || typeof cart !== 'object') {
        logger.error('cart_save_invalid_type', { userId, typeofCart: typeof cart });
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
        //
        // Do NOT reuse originalCart._id on insert: parallel syncs both delete then insert with the
        // same _id → E11000 duplicate key. Reads/writes key by userId only; a fresh _id is correct.

        // Remove all carts for this userId (idempotent); deleteOne falsely "failed" when
        // deletedCount === 0 (concurrent sync, or doc already gone) — see vornifydb deleteManyRecords.
        const deleteResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--delete-many',
            data: { userId }
        });
        
        if (!deleteResult.success) {
            return {
                success: false,
                error: 'Failed to delete existing cart',
                details: deleteResult.error || deleteResult.message || 'Database operation failed'
            };
        }

        // Create new cart with updated data - ensure we pass a plain object
        const cartToSave = { ...cart };
        delete cartToSave._id;
        const createResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'carts',
            command: '--create',
            data: cartToSave
        });
        
        return createResult;
    } else {
        // Cart doesn't exist - create new one - ensure we pass a plain object
        const cartToSave = { ...cart };
        delete cartToSave._id;
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
            let cart = result.data || {
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
            if (Array.isArray(cart)) {
                cart = cart.length > 0 ? cart[0] : {
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
            
            const vatOpts = getVatOptsFromRequest(req);
            let totals = getBackendTotals(cart, vatOpts);
            const { totals: resolvedTotals, rateFromSEK } = await ensureTotalsWithDisplayCurrency(totals, req);
            totals = resolvedTotals;
            cart.totals = totals;
            enrichCartItemsForDisplay(cart, rateFromSEK);
            const cartVersion = attachCartVersion(cart, req);
            res.json({
                success: true,
                cart,
                totals,
                currency: totals.currency,
                currencySymbol: totals.currencySymbol,
                cartVersion
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve cart'
            });
        }
    } catch (error) {
        logger.error('cart_get_error', { message: error.message });
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
        
        // Always store price in SEK (gross) so totals are consistent; ignore frontend-sent price for amount
        const priceSEKGross = await getProductPriceSEKGross(itemData.id);
        const itemPrice = priceSEKGross != null ? priceSEKGross : (typeof itemData.price === 'number' && !isNaN(itemData.price) ? itemData.price : 0);

        if (existingItemIndex !== -1) {
            // Update quantity and refresh price from catalog (SEK) so merged line is correct
            cart.items[existingItemIndex].quantity += itemData.quantity;
            cart.items[existingItemIndex].price = itemPrice;
        } else {
            // Add new item to cart with price in SEK (gross)
            cart.items.push({
                cartItemId: itemData.cartItemId,
                id: itemData.id,
                name: itemData.name,
                price: itemPrice,
                image: itemData.image || '',
                size: itemData.size || null,
                color: itemData.color || null,
                sizeId: itemData.sizeId || null,
                colorId: itemData.colorId || null,
                variantId: itemData.variantId || null,
                quantity: itemData.quantity,
                currency: STORE_BASE_CURRENCY,
                source: itemData.source || null,
                addedAt: new Date().toISOString()
            });
        }
        
        const vatOpts = getVatOptsFromRequest(req);
        let totals = getBackendTotals(cart, vatOpts);
        const { totals: resolvedTotals, rateFromSEK } = await ensureTotalsWithDisplayCurrency(totals, req);
        totals = resolvedTotals;
        cart.totals = totals;
        cart.updatedAt = new Date().toISOString();
        
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
        if (saveResult.success) {
            enrichCartItemsForDisplay(cart, rateFromSEK);
            res.json({
                success: true,
                message: 'Item added to cart',
                cart,
                totals,
                currency: totals.currency,
                currencySymbol: totals.currencySymbol
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to save cart'
            });
        }
    } catch (error) {
        logger.error('cart_add_error', { message: error.message });
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
        
        let cart = Array.isArray(cartResult.data) ? cartResult.data[0] : cartResult.data;
        if (!cart || !cart.items) {
            return res.status(404).json({ success: false, error: 'Cart not found' });
        }
        const originalCart = { ...cart };
        const itemIndex = cart.items.findIndex(item => item.cartItemId === cartItemId);
        
        if (itemIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Item not found in cart'
            });
        }
        
        if (quantity === 0) {
            cart.items.splice(itemIndex, 1);
        } else {
            cart.items[itemIndex].quantity = quantity;
        }
        
        const vatOpts = getVatOptsFromRequest(req);
        let totals = getBackendTotals(cart, vatOpts);
        const { totals: resolvedTotals, rateFromSEK } = await ensureTotalsWithDisplayCurrency(totals, req);
        totals = resolvedTotals;
        cart.totals = totals;
        cart.updatedAt = new Date().toISOString();
        
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
        if (saveResult.success) {
            enrichCartItemsForDisplay(cart, rateFromSEK);
            res.json({
                success: true,
                message: quantity === 0 ? 'Item removed from cart' : 'Cart item updated',
                cart,
                totals,
                currency: totals.currency,
                currencySymbol: totals.currencySymbol
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to update cart'
            });
        }
    } catch (error) {
        logger.error('cart_update_error', { message: error.message });
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
        
        cart.items.splice(itemIndex, 1);
        
        const vatOpts = getVatOptsFromRequest(req);
        let totals = getBackendTotals(cart, vatOpts);
        const { totals: resolvedTotals, rateFromSEK } = await ensureTotalsWithDisplayCurrency(totals, req);
        totals = resolvedTotals;
        cart.totals = totals;
        cart.updatedAt = new Date().toISOString();
        
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
        if (saveResult.success) {
            enrichCartItemsForDisplay(cart, rateFromSEK);
            res.json({
                success: true,
                message: 'Item removed from cart',
                cart,
                totals,
                currency: totals.currency,
                currencySymbol: totals.currencySymbol
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to remove item from cart'
            });
        }
    } catch (error) {
        logger.error('cart_remove_error', { message: error.message });
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
            command: '--delete-many',
            data: { userId }
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to clear cart',
                details: result.error || result.message
            });
        }

        res.json({
            success: true,
            message: 'Cart cleared successfully'
        });
    } catch (error) {
        logger.error('cart_clear_error', { message: error.message });
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
            devLog('[CART] email saved', { userId, itemsCount: cart.items?.length || 0 });
            
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
            logger.error('cart_email_save_failed', { userId });
            res.status(500).json({
                success: false,
                error: 'Failed to save email to cart'
            });
        }
    } catch (error) {
        logger.error('cart_email_save_exception', { message: error.message });
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
        const incomingCartVersion = getIncomingCartVersion(req);
        
        devLog('[CART SYNC]', { userId, itemCount: items?.length || 0 });
        
        if (!items || !Array.isArray(items)) {
            logger.warn('cart_sync_invalid_items', { userId });
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

        // Conflict detection: if client acted on a stale snapshot, return 409 with latest canonical cart.
        if (incomingCartVersion && existingCartData && typeof existingCartData === 'object') {
            const currentV = computeCartVersion(
                buildCartVersionSource({ cart: existingCartData, shippingAddress: null, shippingMethod: null, discountCode: null })
            );
            if (incomingCartVersion !== currentV) {
                return await respondCartConflict(
                    res,
                    req,
                    existingCartData,
                    'Client cartVersion did not match current backend cartVersion'
                );
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
            logger.error('cart_sync_cart_was_array', { userId });
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
        
        // Validate and map items; normalize prices to SEK (gross) from product catalog
        try {
            const productPromises = items.map((item) => getProductForCart(item.id || item.productId));
            const products = await Promise.all(productPromises);
            const pricePromises = items.map(item => getProductPriceSEKGross(item.id || item.productId));
            const pricesSEK = await Promise.all(pricePromises);

            const adjustments = [];
            const mapped = items.map((item, index) => {
                const product = products[index];
                const productId = normalizeCartItemId(item, index);

                if (!item.id && !item.productId) {
                    devWarn('[CART SYNC] item missing id/productId', { index });
                }
                if (!item.name) {
                    devWarn('[CART SYNC] item missing name', { index });
                }

                // Product deleted/inactive → remove from cart
                if (!product) {
                    adjustments.push({
                        type: 'removed',
                        code: 'PRODUCT_NOT_FOUND',
                        productId,
                        reason: 'Product no longer exists'
                    });
                    return null;
                }
                if (product.active === false) {
                    adjustments.push({
                        type: 'removed',
                        code: 'PRODUCT_INACTIVE',
                        productId,
                        reason: 'Product is inactive'
                    });
                    return null;
                }

                // Stock enforcement (variants are canonical)
                const v = pickVariantForItem(product, item);
                if (product.inventory?.trackPerVariant !== false && Array.isArray(product.inventory?.variants)) {
                    if (!v) {
                        adjustments.push({
                            type: 'removed',
                            code: 'VARIANT_NOT_OFFERED',
                            productId,
                            variantId: item.variantId || null,
                            colorId: item.colorId || null,
                            sizeId: item.sizeId || null,
                            reason: 'Variant not offered'
                        });
                        return null;
                    }
                    if (v.available === false) {
                        adjustments.push({
                            type: 'removed',
                            code: 'VARIANT_UNAVAILABLE',
                            productId,
                            variantId: v.id || null,
                            reason: 'Variant unavailable'
                        });
                        return null;
                    }
                    const requestedQty = typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : Number(item.quantity);
                    const allowedQty = clampQuantity(requestedQty, v.quantity || 0);
                    if (allowedQty <= 0) {
                        adjustments.push({
                            type: 'removed',
                            code: 'SOLD_OUT',
                            productId,
                            variantId: v.id || null,
                            requestedQty: requestedQty || 0,
                            availableQty: v.quantity || 0,
                            reason: 'Offered but sold out'
                        });
                        return null;
                    }
                    if (allowedQty !== Math.floor(requestedQty || 0)) {
                        adjustments.push({
                            type: 'clamped',
                            code: 'INSUFFICIENT_STOCK',
                            productId,
                            variantId: v.id || null,
                            requestedQty: requestedQty || 0,
                            availableQty: v.quantity || 0,
                            newQty: allowedQty
                        });
                    }
                    item = { ...item, quantity: allowedQty, variantId: item.variantId || v.id || null, colorId: item.colorId || v.colorId || null, sizeId: item.sizeId || v.sizeId || null };
                }

                const price = pricesSEK[index] != null ? pricesSEK[index] : (typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0);
                const q = typeof item.quantity === 'number' && !isNaN(item.quantity) && item.quantity > 0 ? item.quantity : 1;

                return {
                    cartItemId: item.cartItemId || generateCartItemId(),
                    id: productId,
                    name: item.name || product.name || 'Unknown Product',
                    price,
                    image: item.image || product.image || '',
                    size: item.size || null,
                    color: item.color || null,
                    sizeId: item.sizeId || null,
                    colorId: item.colorId || null,
                    variantId: item.variantId || null,
                    quantity: q,
                    currency: STORE_BASE_CURRENCY,
                    source: item.source || null,
                    addedAt: item.addedAt || new Date().toISOString()
                };
            }).filter(Boolean);

            cart.items = mapped;
            cart.cartAdjustments = adjustments.length > 0 ? adjustments : undefined;
        } catch (mapError) {
            logger.error('cart_sync_map_items_failed', { userId, message: mapError.message });
            return res.status(400).json({
                success: false,
                error: 'Invalid cart items format',
                details: mapError.message
            });
        }
        
        const existingShipping = (cart.totals && (typeof cart.totals.shippingGross === 'number' ? cart.totals.shippingGross : cart.totals.shipping)) || 0;
        const existingAppliedDiscount = cart.appliedDiscount || null;
        
        // Preserve shipping for getBackendTotals
        cart.totals = cart.totals || {};
        cart.totals.shipping = existingShipping;
        cart.totals.shippingGross = existingShipping;
        
        // Re-validate existing discount against new product gross (items may have changed)
        if (existingAppliedDiscount && existingAppliedDiscount.code) {
            const productGross = (cart.items || []).reduce((sum, item) => {
                const p = typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0;
                const q = typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : 0;
                return sum + p * q;
            }, 0);
            const discountService = require('../services/discountService');
            const recalculationResult = await discountService.calculateOrderTotals(productGross, existingShipping, 0, existingAppliedDiscount.code);
            if (recalculationResult.success && recalculationResult.appliedDiscount) {
                cart.appliedDiscount = {
                    code: recalculationResult.appliedDiscount.code || existingAppliedDiscount.code,
                    percentage: typeof recalculationResult.appliedDiscount.percentage === 'number' ? recalculationResult.appliedDiscount.percentage : 10,
                    amount: typeof recalculationResult.appliedDiscount.amount === 'number' ? recalculationResult.appliedDiscount.amount : 0,
                    appliedAt: recalculationResult.appliedDiscount.appliedAt || new Date().toISOString()
                };
            } else {
                const revokedCode =
                    recalculationResult.errorCode || ErrorCodes.DISCOUNT_INVALID;
                devLog('[CART SYNC] removing invalid discount', {
                    code: existingAppliedDiscount.code,
                    reasonCode: revokedCode
                });
                cart.appliedDiscount = null;
                const priorAdjust = Array.isArray(cart.cartAdjustments) ? cart.cartAdjustments : [];
                cart.cartAdjustments = [
                    ...priorAdjust,
                    {
                        type: DISCOUNT_ADJUSTMENT_REMOVED,
                        code: revokedCode,
                        discountCode: existingAppliedDiscount.code,
                        reason:
                            recalculationResult.error ||
                            recalculationResult.userMessage ||
                            discountService.discountUserMessage(revokedCode)
                    }
                ];
            }
        } else {
            cart.appliedDiscount = null;
        }
        
        const vatOpts = getVatOptsFromRequest(req);
        let totals = getBackendTotals(cart, vatOpts);
        const { totals: resolvedTotals, rateFromSEK } = await ensureTotalsWithDisplayCurrency(totals, req);
        totals = resolvedTotals;
        cart.totals = totals;
        cart.updatedAt = new Date().toISOString();
        if (!cart.createdAt) cart.createdAt = new Date().toISOString();
        
        let originalCart = existingCartData;
        if (Array.isArray(originalCart)) originalCart = originalCart.length > 0 ? originalCart[0] : null;
        
        if (Array.isArray(cart)) {
            return res.status(500).json({
                success: false,
                error: 'Invalid cart data: cart is an array',
                details: 'Cart must be an object, not an array'
            });
        }
        
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
        if (saveResult.success) {
            enrichCartItemsForDisplay(cart, rateFromSEK);
            devLog('[CART SYNC] ok', { userId, items: cart.items.length, total: totals.total });
            const cartVersion = attachCartVersion(cart, req);
            res.json({
                success: true,
                message: 'Cart synced successfully',
                currency: totals.currency,
                currencySymbol: totals.currencySymbol,
                cart,
                totals,
                cartVersion,
                adjusted: Array.isArray(cart.cartAdjustments) && cart.cartAdjustments.length > 0,
                adjustments: cart.cartAdjustments || []
            });
        } else {
            logger.error('cart_sync_save_failed', { userId, error: saveResult.error });
            res.status(500).json({
                success: false,
                error: 'Failed to save cart to database',
                details: saveResult.error || 'Database operation failed'
            });
        }
    } catch (error) {
        logger.error('cart_sync_exception', { userId: req.params.userId, message: error.message });
        devWarn(error.stack);
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
        const incomingCartVersion = getIncomingCartVersion(req);
        
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

        if (incomingCartVersion) {
            const currentV = computeCartVersion(
                buildCartVersionSource({ cart, shippingAddress: null, shippingMethod: null, discountCode: null })
            );
            if (incomingCartVersion !== currentV) {
                return await respondCartConflict(
                    res,
                    req,
                    cart,
                    'Client cartVersion did not match current backend cartVersion'
                );
            }
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
        
        // Product gross (VAT-included) from items for discount validation
        const productGross = (cart.items || []).reduce((sum, item) => {
            const p = typeof item.price === 'number' && !isNaN(item.price) ? item.price : 0;
            const q = typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : 0;
            return sum + p * q;
        }, 0);
        const shipping = (cart.totals && (typeof cart.totals.shippingGross === 'number' ? cart.totals.shippingGross : cart.totals.shipping)) || 0;
        
        const discountService = require('../services/discountService');
        const calculationResult = await discountService.calculateOrderTotals(
            productGross,
            shipping,
            0,
            discountCode
        );
        
        if (!calculationResult.success) {
            const errCode =
                calculationResult.errorCode || ErrorCodes.DISCOUNT_INVALID;
            const cartVersionStale = computeCartVersion(
                buildCartVersionSource({ cart, shippingAddress: null, shippingMethod: null, discountCode: null })
            );
            try {
                res.setHeader('X-Cart-Version', cartVersionStale);
            } catch {
                /* ignore */
            }
            return res.status(400).json({
                success: false,
                code: errCode,
                error: calculationResult.error || 'Invalid discount code',
                userMessage:
                    calculationResult.userMessage ||
                    discountService.discountUserMessage(errCode),
                requestId: req.requestId || req.headers['x-request-id'] || null,
                cartVersion: cartVersionStale
            });
        }
        
        if (calculationResult.appliedDiscount) {
            cart.appliedDiscount = {
                code: calculationResult.appliedDiscount.code || discountCode,
                percentage: typeof calculationResult.appliedDiscount.percentage === 'number' ? calculationResult.appliedDiscount.percentage : 10,
                amount: typeof calculationResult.appliedDiscount.amount === 'number' ? calculationResult.appliedDiscount.amount : 0,
                appliedAt: calculationResult.appliedDiscount.appliedAt || new Date().toISOString()
            };
        }
        
        const vatOpts = getVatOptsFromRequest(req);
        let totals = getBackendTotals(cart, vatOpts);
        const { totals: resolvedTotals, rateFromSEK } = await ensureTotalsWithDisplayCurrency(totals, req);
        totals = resolvedTotals;
        cart.totals = totals;
        cart.updatedAt = new Date().toISOString();
        
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
        if (saveResult.success) {
            enrichCartItemsForDisplay(cart, rateFromSEK);
            const cartVersion = attachCartVersion(cart, req);
            res.json({
                success: true,
                message: 'Discount applied successfully',
                cart,
                totals,
                currency: totals.currency,
                currencySymbol: totals.currencySymbol,
                cartVersion
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to apply discount'
            });
        }
    } catch (error) {
        logger.error('cart_apply_discount_error', { message: error.message });
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
        const incomingCartVersion = getIncomingCartVersion(req);
        
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

        if (incomingCartVersion) {
            const currentV = computeCartVersion(
                buildCartVersionSource({ cart, shippingAddress: null, shippingMethod: null, discountCode: null })
            );
            if (incomingCartVersion !== currentV) {
                return await respondCartConflict(
                    res,
                    req,
                    cart,
                    'Client cartVersion did not match current backend cartVersion'
                );
            }
        }
        
        // Store original cart BEFORE modifications
        const originalCart = { ...cart };
        
        cart.appliedDiscount = null;
        const vatOpts = getVatOptsFromRequest(req);
        let totals = getBackendTotals(cart, vatOpts);
        const { totals: resolvedTotals, rateFromSEK } = await ensureTotalsWithDisplayCurrency(totals, req);
        totals = resolvedTotals;
        cart.totals = totals;
        cart.updatedAt = new Date().toISOString();
        
        const saveResult = await saveCartToDatabase(userId, cart, originalCart);
        
        if (saveResult.success) {
            enrichCartItemsForDisplay(cart, rateFromSEK);
            const cartVersion = attachCartVersion(cart, req);
            res.json({
                success: true,
                message: 'Discount removed successfully',
                cart,
                totals,
                currency: totals.currency,
                currencySymbol: totals.currencySymbol,
                cartVersion
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to remove discount'
            });
        }
    } catch (error) {
        logger.error('cart_remove_discount_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to remove discount'
        });
    }
});

module.exports = router;
