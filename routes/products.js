const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const currencyService = require('../services/currencyService');
const translationService = require('../services/translationService');
const productTranslationHelper = require('../services/productTranslationHelper');
const seoHelper = require('../utils/seoHelper');
const reviewStatsHelper = require('../utils/reviewStatsHelper');

const db = getDBInstance();

// Server-side throttling: track recent views by IP + product ID
// Format: Map<"IP:PRODUCT_ID", timestamp>
const viewThrottleCache = new Map();
const THROTTLE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Check if a view should be throttled (prevent duplicate views from same IP within 30 minutes)
 * @param {string} ip - Client IP address
 * @param {string} productId - Product ID
 * @returns {boolean} - true if view should be throttled (rejected), false if allowed
 */
function shouldThrottleView(ip, productId) {
    const key = `${ip}:${productId}`;
    const lastViewTime = viewThrottleCache.get(key);
    
    if (!lastViewTime) {
        // First view from this IP for this product, allow it
        viewThrottleCache.set(key, Date.now());
        return false;
    }
    
    const timeSinceLastView = Date.now() - lastViewTime;
    
    if (timeSinceLastView < THROTTLE_DURATION_MS) {
        // View is within throttle window, reject it
        return true;
    }
    
    // Throttle window has passed, allow the view and update timestamp
    viewThrottleCache.set(key, Date.now());
    return false;
}

// Clean up old throttle entries every hour to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, timestamp] of viewThrottleCache.entries()) {
        if (now - timestamp > THROTTLE_DURATION_MS) {
            keysToDelete.push(key);
        }
    }
    
    keysToDelete.forEach(key => viewThrottleCache.delete(key));
    
    if (keysToDelete.length > 0) {
        console.log(`🧹 [View Throttle] Cleaned up ${keysToDelete.length} expired throttle entries`);
    }
}, 60 * 60 * 1000); // Every hour

/**
 * Validate Cloudinary media fields
 * Ensures media and imagePublicIds arrays match in length if either is provided
 * @param {Array} media - Array of Cloudinary URLs
 * @param {Array} imagePublicIds - Array of Cloudinary public_ids
 * @returns {Object} - { valid: boolean, error: string | null }
 */
function validateCloudinaryMedia(media, imagePublicIds) {
    // If both are undefined/null, validation passes (optional fields)
    if ((!media || media.length === 0) && (!imagePublicIds || imagePublicIds.length === 0)) {
        return { valid: true, error: null };
    }
    
    // Normalize to arrays (handle undefined/null)
    const mediaArray = Array.isArray(media) ? media : [];
    const publicIdsArray = Array.isArray(imagePublicIds) ? imagePublicIds : [];
    
    // If one exists, both must exist and match in length
    if (mediaArray.length !== publicIdsArray.length) {
        return {
            valid: false,
            error: `media array length (${mediaArray.length}) must match imagePublicIds array length (${publicIdsArray.length})`
        };
    }
    
    return { valid: true, error: null };
}

// GET /api/products/most-viewed - Get most viewed products (last 7 days)
// This route must be defined before /:id to avoid route conflicts
router.get('/most-viewed', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 12;
        
        // Get all products
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: {}
        });
        
        if (result.success) {
            let products = result.data || [];
            
            // Handle case where result.data might be a single object instead of array
            if (!Array.isArray(products)) {
                products = [products];
            }
            
            // Filter products by published and active status only (include products with 0 views)
            products = products.filter(product => {
                const isPublished = product.published !== false; // Default to true if not set
                const isActive = product.active !== false; // Default to true if not set
                
                return isPublished && isActive;
            });
            
            // Sort by viewsLast7Days DESC, then by views DESC (highest first)
            // Products with 0 views will be sorted to the bottom
            products.sort((a, b) => {
                const viewsLast7DaysA = a.viewsLast7Days || 0;
                const viewsLast7DaysB = b.viewsLast7Days || 0;
                const viewsA = a.views || 0;
                const viewsB = b.views || 0;
                
                // First sort by viewsLast7Days DESC
                if (viewsLast7DaysB !== viewsLast7DaysA) {
                    return viewsLast7DaysB - viewsLast7DaysA;
                }
                
                // Then sort by views DESC (if viewsLast7Days are equal)
                return viewsB - viewsA;
            });
            
            // Limit results
            products = products.slice(0, limit);
            
            console.log(`📊 [Most Viewed] Returning ${products.length} most viewed products (sorted from ${result.data?.length || 0} total)`);
            
            res.json({
                success: true,
                data: products
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve most viewed products'
            });
        }
    } catch (error) {
        console.error('❌ [Most Viewed] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve most viewed products',
            details: error.message
        });
    }
});

// GET /api/products/categories - Get all product categories
// This route must be defined before /:id to avoid route conflicts
router.get('/categories', async (req, res) => {
    try {
        // Get all products to extract unique categories
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: {}
        });
        
        if (result.success) {
            const products = result.data || [];
            
            // Extract unique categories
            const categoriesSet = new Set();
            products.forEach(product => {
                if (product.category) {
                    categoriesSet.add(product.category);
                }
            });
            
            // Convert to array and sort
            const categories = Array.from(categoriesSet).sort();
            
            // Ensure "Peak Prints" is included if any products have it
            // This handles the case where the category might be stored with different casing
            const hasPeakPrints = categories.some(cat => 
                cat.toLowerCase() === 'peak prints'
            );
            
            // If we have "Peak Prints" with different casing, normalize it
            const normalizedCategories = categories.map(cat => {
                if (cat.toLowerCase() === 'peak prints') {
                    return 'Peak Prints';
                }
                return cat;
            });
            
            // Remove duplicates after normalization
            const uniqueCategories = [...new Set(normalizedCategories)].sort();
            
            res.json({
                success: true,
                data: uniqueCategories,
                count: uniqueCategories.length
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve categories'
            });
        }
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve categories'
        });
    }
});

// GET /api/products/:id - Get product by ID with complete inventory data
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Try to find product by id first, then by _id if not found
        let result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id }
        });
        
        // If not found by id, try _id (MongoDB ObjectId)
        if (!result.success || !result.data) {
            const { ObjectId } = require('mongodb');
            try {
                // Try as ObjectId
                result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--read',
                    data: { _id: new ObjectId(id) }
                });
            } catch (e) {
                // If ObjectId conversion fails, try as string
                result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--read',
                    data: { _id: id }
                });
            }
        }
        
        if (result.success && result.data) {
            // Process inventory data to ensure proper structure
            const product = result.data;
            
            // Get requested language from query parameter
            const language = translationService.getLanguageFromRequest(req);
            
            // Get requested currency from query parameter
            const requestedCurrency = req.query.currency?.toUpperCase() || null;
            const basePrice = product.price || 0;
            const baseCurrency = product.currency || currencyService.BASE_CURRENCY;
            
            // Add multi-currency prices
            try {
                const multiCurrencyPrices = await currencyService.getMultiCurrencyPrices(basePrice, baseCurrency);
                product.base_price = basePrice;
                product.currency = baseCurrency;
                product.prices = multiCurrencyPrices;
                
                // If specific currency requested, add converted_price field
                if (requestedCurrency && requestedCurrency !== baseCurrency) {
                    const convertedPrice = multiCurrencyPrices[requestedCurrency];
                    if (convertedPrice !== undefined) {
                        product.selected_currency = requestedCurrency;
                        product.converted_price = convertedPrice;
                        const rate = await currencyService.getExchangeRate(baseCurrency, requestedCurrency);
                        product.exchange_rate = rate;
                    }
                }
            } catch (currencyError) {
                console.warn('Failed to get multi-currency prices:', currencyError);
                // Fallback: use base price for all currencies
                product.base_price = basePrice;
                product.currency = baseCurrency;
                product.prices = { [baseCurrency]: basePrice };
            }
            
            // Ensure inventory structure is complete
            if (product.inventory) {
                // Process colors
                if (product.inventory.colors && Array.isArray(product.inventory.colors)) {
                    product.inventory.colors = product.inventory.colors.map((color, index) => ({
                        id: color.id || `color_${Date.now()}_${index}`,
                        name: color.name || 'Unnamed Color',
                        hex: color.hex || '#000000',
                        available: color.available !== undefined ? color.available : true,
                        sortOrder: color.sortOrder !== undefined ? color.sortOrder : index
                    }));
                }
                
                // Process sizes
                if (product.inventory.sizes && Array.isArray(product.inventory.sizes)) {
                    product.inventory.sizes = product.inventory.sizes.map((size, index) => ({
                        id: size.id || `size_${Date.now()}_${index}`,
                        name: size.name || 'Unnamed Size',
                        description: size.description || '',
                        available: size.available !== undefined ? size.available : true,
                        sortOrder: size.sortOrder !== undefined ? size.sortOrder : index
                    }));
                }
                
                // Process variants
                if (product.inventory.variants && Array.isArray(product.inventory.variants)) {
                    product.inventory.variants = product.inventory.variants.map((variant, index) => ({
                        id: variant.id || `variant_${Date.now()}_${index}`,
                        colorId: variant.colorId,
                        sizeId: variant.sizeId,
                        sku: variant.sku || '',
                        price: variant.price || product.price,
                        stock: variant.stock || 0,
                        available: variant.available !== undefined ? variant.available : true,
                        images: variant.images || [],
                        sortOrder: variant.sortOrder !== undefined ? variant.sortOrder : index
                    }));
                }
            }
            
            // Translate product content based on language
            const translatedProduct = translationService.translateProduct(product, language);
            
            // Get review statistics for SEO (non-blocking, fails silently)
            let reviewStats = null;
            try {
                reviewStats = await reviewStatsHelper.getProductReviewStats(product.id);
            } catch (error) {
                console.warn('Failed to get review stats for SEO:', error);
            }
            
            // Add SEO fields (additive only, does not modify existing product data)
            const seoFields = seoHelper.getProductSEOFields(translatedProduct, reviewStats);
            const productWithSEO = {
                ...translatedProduct,
                ...seoFields
            };
            
            res.json({
                success: true,
                data: productWithSEO,
                language: language // Include language in response for frontend reference
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
    } catch (error) {
        console.error('Get product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve product'
        });
    }
});

// POST /api/products/:id/view - Track product view
router.post('/:id/view', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get client IP for throttling
        const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        
        // Check server-side throttling (30 minutes per IP + product ID)
        if (shouldThrottleView(clientIp, id)) {
            console.log(`⏸️ [View Throttled] Product ${id} from IP ${clientIp} - view rejected (within 30 min window)`);
            return res.status(200).json({
                success: true,
                views: 0,
                viewsLast7Days: 0,
                throttled: true,
                message: 'View throttled (already tracked recently)'
            });
        }
        
        // Try to find product by id first
        let result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id }
        });
        
        let product = null;
        let productId = null;
        let product_id = null; // MongoDB _id
        let foundById = false; // Track which field was used to find product
        
        // Extract product data (handle array or single object)
        if (result.success && result.data) {
            product = Array.isArray(result.data) ? result.data[0] : result.data;
            productId = product?.id;
            product_id = product?._id;
            foundById = true;
        }
        
        // If not found by id, try _id (MongoDB ObjectId)
        if (!product || !productId) {
            const { ObjectId } = require('mongodb');
            try {
                result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--read',
                    data: { _id: new ObjectId(id) }
                });
            } catch (e) {
                result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--read',
                    data: { _id: id }
                });
            }
            
            if (result.success && result.data) {
                product = Array.isArray(result.data) ? result.data[0] : result.data;
                productId = product?.id;
                product_id = product?._id || id;
                foundById = false;
            }
        }
        
        if (!product || (!productId && !product_id)) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
        
        // Initialize view counters if they don't exist
        const views = (product.views || 0) + 1;
        const viewsLast7Days = (product.viewsLast7Days || 0) + 1;
        const lastViewedAt = new Date().toISOString();
        
        // Build filter - use whichever field was used to find the product
        let filter = {};
        if (foundById && productId) {
            filter = { id: productId };
        } else if (product_id) {
            const { ObjectId } = require('mongodb');
            // Try ObjectId first, fall back to string
            try {
                filter = { _id: new ObjectId(product_id) };
            } catch (e) {
                filter = { _id: product_id };
            }
        } else {
            // Fallback to id field
            filter = { id: productId || id };
        }
        
        // Update product with new view counts
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--update',
            data: {
                filter: filter,
                update: {
                    views: views,
                    viewsLast7Days: viewsLast7Days,
                    lastViewedAt: lastViewedAt
                }
            }
        });
        
        if (updateResult.success) {
            console.log(`👁️ [View Tracked] Product ${productId || product_id} - Total: ${views}, Last 7 days: ${viewsLast7Days}`);
            
            res.json({
                success: true,
                views: views,
                viewsLast7Days: viewsLast7Days
            });
        } else {
            console.error(`❌ [View Tracking] Failed to update product ${productId || product_id}:`, updateResult.error);
            res.status(500).json({
                success: false,
                error: 'Failed to update view count',
                details: updateResult.error
            });
        }
    } catch (error) {
        console.error('❌ [View Tracking] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to track product view',
            details: error.message
        });
    }
});

// GET /api/products - Get all products
router.get('/', async (req, res) => {
    try {
        const { category, featured, limit, search } = req.query;
        
        // Get requested language from query parameter
        const language = translationService.getLanguageFromRequest(req);
        
        let query = {};
        
        // Add category filter if provided
        // Note: We'll do case-insensitive matching in application layer for better compatibility
        if (category) {
            query.category = category;
        }
        
        // Add featured filter if provided
        if (featured === 'true') {
            query.featured = true;
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: query
        });
        
        if (result.success) {
            let products = result.data || [];
            
            // Apply case-insensitive category filter if provided
            if (category) {
                const categoryLower = category.toLowerCase();
                products = products.filter(product => {
                    const productCategory = (product.category || '').toLowerCase();
                    return productCategory === categoryLower;
                });
            }
            
            // Apply search filter if provided (case-insensitive)
            if (search) {
                const searchLower = search.toLowerCase();
                products = products.filter(product => {
                    const name = (product.name || '').toLowerCase();
                    const description = (product.description || '').toLowerCase();
                    const productCategory = (product.category || '').toLowerCase();
                    const productClasses = Array.isArray(product.productClasses) 
                        ? product.productClasses.map(c => c.toLowerCase()).join(' ')
                        : '';
                    
                    return name.includes(searchLower) ||
                           description.includes(searchLower) ||
                           productCategory.includes(searchLower) ||
                           productClasses.includes(searchLower);
                });
            }
            
            // Apply limit if provided
            if (limit && parseInt(limit) > 0) {
                products = products.slice(0, parseInt(limit));
            }
            
            // Process inventory data for each product and add multi-currency prices
            products = await Promise.all(products.map(async (product) => {
                // Add multi-currency prices
                const basePrice = product.price || 0;
                const baseCurrency = product.currency || currencyService.BASE_CURRENCY;
                
                try {
                    const multiCurrencyPrices = await currencyService.getMultiCurrencyPrices(basePrice, baseCurrency);
                    product.base_price = basePrice;
                    product.currency = baseCurrency;
                    product.prices = multiCurrencyPrices;
                } catch (currencyError) {
                    console.warn(`Failed to get multi-currency prices for product ${product.id}:`, currencyError);
                    // Fallback: use base price for all currencies
                    product.base_price = basePrice;
                    product.currency = baseCurrency;
                    product.prices = { [baseCurrency]: basePrice };
                }
                
                if (product.inventory) {
                    // Process colors
                    if (product.inventory.colors && Array.isArray(product.inventory.colors)) {
                        product.inventory.colors = product.inventory.colors.map((color, index) => ({
                            id: color.id || `color_${Date.now()}_${index}`,
                            name: color.name || 'Unnamed Color',
                            hex: color.hex || '#000000',
                            available: color.available !== undefined ? color.available : true,
                            sortOrder: color.sortOrder !== undefined ? color.sortOrder : index
                        }));
                    }
                    
                    // Process sizes
                    if (product.inventory.sizes && Array.isArray(product.inventory.sizes)) {
                        product.inventory.sizes = product.inventory.sizes.map((size, index) => ({
                            id: size.id || `size_${Date.now()}_${index}`,
                            name: size.name || 'Unnamed Size',
                            description: size.description || '',
                            available: size.available !== undefined ? size.available : true,
                            sortOrder: size.sortOrder !== undefined ? size.sortOrder : index
                        }));
                    }
                    
                    // Process variants
                    if (product.inventory.variants && Array.isArray(product.inventory.variants)) {
                        product.inventory.variants = product.inventory.variants.map((variant, index) => ({
                            id: variant.id || `variant_${Date.now()}_${index}`,
                            colorId: variant.colorId,
                            sizeId: variant.sizeId,
                            sku: variant.sku || '',
                            price: variant.price || product.price,
                            stock: variant.stock || 0,
                            available: variant.available !== undefined ? variant.available : true,
                            images: variant.images || [],
                            sortOrder: variant.sortOrder !== undefined ? variant.sortOrder : index
                        }));
                    }
                }
                
                // Translate product content based on language
                return translationService.translateProduct(product, language);
            }));
            
            // Get review statistics for all products (non-blocking, fails silently)
            let reviewStatsMap = {};
            try {
                const productIds = products.map(p => p.id).filter(Boolean);
                if (productIds.length > 0) {
                    reviewStatsMap = await reviewStatsHelper.getMultipleProductReviewStats(productIds);
                }
            } catch (error) {
                console.warn('Failed to get review stats for SEO:', error);
            }
            
            // Add SEO fields to each product (additive only)
            const productsWithSEO = products.map(product => {
                const reviewStats = reviewStatsMap[product.id] || null;
                const seoFields = seoHelper.getProductSEOFields(product, reviewStats);
                return {
                    ...product,
                    ...seoFields
                };
            });
            
            res.json({
                success: true,
                data: productsWithSEO,
                count: productsWithSEO.length,
                language: language // Include language in response for frontend reference
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve products'
            });
        }
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve products'
        });
    }
});

// POST /api/products - Create new product (admin)
router.post('/', async (req, res) => {
    try {
        const productData = req.body;
        
        // Validate required fields
        const requiredFields = ['name', 'price', 'description'];
        const missingFields = requiredFields.filter(field => !productData[field]);
        
        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`
            });
        }
        
        // Validate Cloudinary media fields
        const mediaValidation = validateCloudinaryMedia(productData.media, productData.imagePublicIds);
        if (!mediaValidation.valid) {
            return res.status(400).json({
                success: false,
                error: mediaValidation.error
            });
        }
        
        // Generate product ID if not provided
        if (!productData.id) {
            productData.id = 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
        
        // Set default values
        productData.createdAt = new Date().toISOString();
        productData.updatedAt = new Date().toISOString();
        productData.active = productData.active !== undefined ? productData.active : true;
        productData.featured = productData.featured !== undefined ? productData.featured : false;
        
        // Set Cloudinary media fields (default to empty arrays if not provided)
        productData.media = Array.isArray(productData.media) ? productData.media : [];
        productData.imagePublicIds = Array.isArray(productData.imagePublicIds) ? productData.imagePublicIds : [];
        
        // Process inventory data if provided
        if (productData.inventory) {
            productData.inventory = db.processInventoryData(productData);
        }
        
        // Automatically generate Swedish translations for new product
        const swedishTranslations = productTranslationHelper.generateSwedishTranslations(productData);
        if (Object.keys(swedishTranslations).length > 0) {
            // Merge Swedish translations into product data
            Object.assign(productData, swedishTranslations);
            console.log(`🌐 [Auto-Translation] Generated ${Object.keys(swedishTranslations).length} Swedish translation(s) for new product`);
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--create',
            data: productData
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Product created successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create product'
        });
    }
});

// PUT /api/products/:id - Update product (admin)
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        
        // Validate Cloudinary media fields if provided
        if (updateData.media !== undefined || updateData.imagePublicIds !== undefined) {
            const mediaValidation = validateCloudinaryMedia(updateData.media, updateData.imagePublicIds);
            if (!mediaValidation.valid) {
                return res.status(400).json({
                    success: false,
                    error: mediaValidation.error
                });
            }
            
            // Normalize to arrays if provided (ensure they're arrays, not undefined)
            if (updateData.media !== undefined) {
                updateData.media = Array.isArray(updateData.media) ? updateData.media : [];
            }
            if (updateData.imagePublicIds !== undefined) {
                updateData.imagePublicIds = Array.isArray(updateData.imagePublicIds) ? updateData.imagePublicIds : [];
            }
        }
        
        // Add updated timestamp
        updateData.updatedAt = new Date().toISOString();
        
        // Process inventory data if provided
        if (updateData.inventory) {
            updateData.inventory = db.processInventoryData(updateData);
        }
        
        // Get existing product to check for existing translations
        const existingProductResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id }
        });
        
        // Merge existing product data with update data to check for translations
        const mergedProduct = existingProductResult.success && existingProductResult.data
            ? { ...existingProductResult.data, ...updateData }
            : updateData;
        
        // Automatically generate Swedish translations for updated fields (if missing)
        const swedishTranslations = productTranslationHelper.generateSwedishTranslations(mergedProduct);
        if (Object.keys(swedishTranslations).length > 0) {
            // Merge Swedish translations into update data
            Object.assign(updateData, swedishTranslations);
            console.log(`🌐 [Auto-Translation] Generated ${Object.keys(swedishTranslations).length} Swedish translation(s) for updated product`);
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--update',
            data: {
                filter: { id },
                update: updateData
            }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Product updated successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update product'
        });
    }
});

// DELETE /api/products/:id - Delete product (admin)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--delete',
            data: { id }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Product deleted successfully'
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete product'
        });
    }
});

// GET /api/products/:id/variants - Get product variants
router.get('/:id/variants', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id }
        });
        
        if (result.success && result.data) {
            const product = result.data;
            const variants = product.inventory?.variants || [];
            
            res.json({
                success: true,
                data: variants
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
    } catch (error) {
        console.error('Get product variants error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve product variants'
        });
    }
});

// GET /api/products/sitemap - Get all products for sitemap generation
// Returns minimal product data needed for sitemap (id, name, category, updatedAt, slug)
// This endpoint is for SEO purposes only, no visible changes
router.get('/sitemap', async (req, res) => {
    try {
        // Get all products (we'll filter active ones)
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: {}
        });
        
        if (result.success) {
            let products = result.data || [];
            if (!Array.isArray(products)) {
                products = [products];
            }
            
            // Filter to only active products and map to sitemap format
            const sitemapProducts = products
                .filter(product => product.active !== false)
                .map(product => {
                    // Generate slug if not present
                    const slug = product.slug || seoHelper.generateSlug(product.name || product.id);
                    
                    return {
                        id: product.id,
                        name: product.name,
                        category: product.category,
                        updatedAt: product.updatedAt || product.updated_at || new Date().toISOString(),
                        slug: slug
                    };
                });
            
            res.json({
                success: true,
                data: sitemapProducts,
                count: sitemapProducts.length
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve products for sitemap'
            });
        }
    } catch (error) {
        console.error('Get sitemap products error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve products for sitemap'
        });
    }
});

module.exports = router;
