const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const currencyService = require('../services/currencyService');
const translationService = require('../services/translationService');
const productTranslationHelper = require('../services/productTranslationHelper');
const seoHelper = require('../utils/seoHelper');
const reviewStatsHelper = require('../utils/reviewStatsHelper');
const vatService = require('../services/vatService');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const optionalAuthenticateAdmin = authenticateAdmin.optionalAuthenticateAdmin || (async (req, res, next) => { req.isAdminRequest = false; next(); });

const db = getDBInstance();

/** True if product may be shown on the storefront. Only products with published === true are returned to customers; drafts (false) and legacy (undefined) are excluded. */
function isPublishedForStorefront(product) {
    return product && product.published === true;
}

/**
 * Build product lookup query for single-query resolution by id or _id
 * Reduces up to 3 sequential DB reads to 1 when URL contains id or MongoDB _id
 */
function buildProductLookupQuery(id) {
    if (/^[a-fA-F0-9]{24}$/.test(id)) {
        try {
            const { ObjectId } = require('mongodb');
            return { $or: [ { id }, { _id: new ObjectId(id) } ] };
        } catch (e) {
            return { id };
        }
    }
    return { id };
}

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

/**
 * Normalize product for API response: ensure id (from _id if missing), ensure variants have quantity (storefront contract).
 * @param {Object} product - Raw product from DB
 * @returns {Object} - Same object with id and variant.quantity guaranteed
 */
function normalizeProductForResponse(product) {
    if (!product) return product;
    if (!product.id && product._id) {
        product.id = typeof product._id === 'string' ? product._id : product._id.toString();
    }
    const inv = product.inventory;
    if (inv && inv.variants && Array.isArray(inv.variants)) {
        inv.variants = inv.variants.map(v => ({
            ...v,
            quantity: v.quantity !== undefined ? v.quantity : (v.stock !== undefined ? v.stock : 0)
        }));
    }
    if (product.variants && Array.isArray(product.variants)) {
        product.variants = product.variants.map(v => ({
            ...v,
            quantity: v.quantity !== undefined ? v.quantity : (v.stock !== undefined ? v.stock : 0)
        }));
    }
    return product;
}

/**
 * Collect all image URLs from product (media, images, image, imageUrl, etc.) into a single array.
 * Used to normalize incoming payloads into media[] only.
 */
function normalizeImagesToMedia(payload) {
    const media = Array.isArray(payload.media) ? [...payload.media] : [];
    if (media.length > 0) return media;
    if (Array.isArray(payload.images) && payload.images.length > 0) return payload.images;
    if (payload.image) return [payload.image];
    if (payload.imageUrl) return [payload.imageUrl];
    if (Array.isArray(payload.imageUrls) && payload.imageUrls.length > 0) return payload.imageUrls;
    if (Array.isArray(payload.photos) && payload.photos.length > 0) return payload.photos;
    if (payload.photo) return [payload.photo];
    if (payload.picture) return [payload.picture];
    if (Array.isArray(payload.pictures) && payload.pictures.length > 0) return payload.pictures;
    return [];
}

/** Ensure a "list" field (string or string[]) has at least one non-empty entry; return true if valid */
function hasNonEmptyList(value) {
    if (value == null) return false;
    if (Array.isArray(value)) return value.some(item => String(item).trim().length > 0);
    return String(value).trim().length > 0;
}

/** Ensure a string field is non-empty after trim */
function hasNonEmptyString(value) {
    return value != null && String(value).trim().length > 0;
}

/**
 * Validate product-detail content fields required for the storefront detail page (Size & Fit, Materials & Care, Shipping & Returns).
 * Returns { valid: boolean, missing: string[] }. Use on create (require all) or on update (only validate fields that are present).
 * @param {Object} data - Product payload
 * @param {boolean} onlyIfPresent - If true, only validate fields that exist in data; if false, require all compulsory fields.
 */
function validateProductDetailContent(data, onlyIfPresent = false) {
    const missing = [];
    const check = (name, ok) => { if (!ok) missing.push(name); };

    if (!onlyIfPresent || data.sizeFitDescription !== undefined) {
        check('sizeFitDescription', hasNonEmptyString(data.sizeFitDescription));
    }
    if (!onlyIfPresent || data.fitGuide !== undefined) {
        check('fitGuide', hasNonEmptyList(data.fitGuide));
    }
    if (!onlyIfPresent || data.sizeRecommendations !== undefined) {
        check('sizeRecommendations', hasNonEmptyList(data.sizeRecommendations));
    }
    const hasMaterials = hasNonEmptyString(data.materials) || (Array.isArray(data.materials) && data.materials.some(m => String(m).trim().length > 0)) || hasNonEmptyString(data.materialComposition);
    if (!onlyIfPresent || data.materials !== undefined || data.materialComposition !== undefined) {
        check('materials or materialComposition', hasMaterials);
    }
    if (!onlyIfPresent || data.careInstructions !== undefined) {
        check('careInstructions', hasNonEmptyList(data.careInstructions));
    }
    if (!onlyIfPresent || data.shippingInfo !== undefined) {
        check('shippingInfo', hasNonEmptyList(data.shippingInfo));
    }
    if (!onlyIfPresent || data.returnPolicy !== undefined) {
        check('returnPolicy', hasNonEmptyList(data.returnPolicy));
    }

    return { valid: missing.length === 0, missing };
}

// GET /api/products/most-viewed - Get most viewed products (last 7 days)
// This route must be defined before /:id to avoid route conflicts
router.get('/most-viewed', optionalAuthenticateAdmin, async (req, res) => {
    try {
        console.log('🔍 [MOST VIEWED] Request received:', {
            limit: req.query.limit,
            timestamp: new Date().toISOString()
        });

        const limit = parseInt(req.query.limit) || 12;
        
        // Check if db instance is available
        if (!db) {
            console.error('❌ [MOST VIEWED] Database instance not available');
            return res.status(500).json({
                success: false,
                error: 'Database not initialized',
                message: 'Database connection not available'
            });
        }

        // Check if executeOperation method exists
        if (typeof db.executeOperation !== 'function') {
            console.error('❌ [MOST VIEWED] executeOperation method not available');
            return res.status(500).json({
                success: false,
                error: 'Database method not available',
                message: 'executeOperation method not found'
            });
        }

        console.log('🔍 [MOST VIEWED] Querying database for products...');
        // Storefront: filter published at DB level; admin: all products
        const query = req.isAdminRequest ? {} : { published: true };
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: query
        });
        
        console.log('🔍 [MOST VIEWED] Database query result:', {
            success: result?.success,
            hasData: !!result?.data,
            dataType: Array.isArray(result?.data) ? 'array' : typeof result?.data
        });
        
        if (result && (result.success || result.status !== false)) {
            let products = result.data || [];
            
            // Handle case where result.data might be a single object instead of array
            if (!Array.isArray(products)) {
                products = [products];
            }
            
            // Storefront: only published products (drafts must never appear); admin with token sees all
            if (!req.isAdminRequest) {
                products = products.filter(product => isPublishedForStorefront(product) && product.active !== false);
            } else {
                products = products.filter(product => product.active !== false);
            }
            
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
            
            console.log(`✅ [MOST VIEWED] Returning ${products.length} products`);
            res.json({
                success: true,
                data: products
            });
        } else {
            console.error('❌ [MOST VIEWED] Database query failed:', {
                result: result,
                hasError: !!result?.error,
                errorMessage: result?.error || result?.message
            });
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
router.get('/categories', optionalAuthenticateAdmin, async (req, res) => {
    try {
        // Storefront: filter published at DB level; admin: all products
        const query = req.isAdminRequest ? {} : { published: true };
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: query
        });
        
        if (result.success) {
            let products = result.data || [];
            if (!Array.isArray(products)) products = products ? [products] : [];
            // Storefront: only categories from published products; admin with token sees all
            const publishedProducts = req.isAdminRequest ? products : products.filter(isPublishedForStorefront);
            const categoriesSet = new Set();
            publishedProducts.forEach(product => {
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

// GET /api/products/sitemap - Get all products for sitemap generation (must be before /:id to avoid matching id='sitemap')
// Returns minimal product data needed for sitemap (id, name, category, updatedAt, slug)
router.get('/sitemap', async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'development' || req.query._ping) {
            console.log('🔔 [CRON/PING] GET /api/products/sitemap hit');
        }
        // Filter published at DB level (sitemap never includes drafts)
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { published: true }
        });
        
        if (result.success) {
            let products = result.data || [];
            if (!Array.isArray(products)) {
                products = [products];
            }
            
            const sitemapProducts = products
                .filter(product => isPublishedForStorefront(product) && product.active !== false)
                .map(product => {
                    const slug = product.slug || seoHelper.generateSlug(product.name || product.id);
                    return {
                        id: product.id,
                        name: product.name,
                        category: product.category,
                        updatedAt: product.updatedAt || product.updated_at || new Date().toISOString(),
                        slug: slug
                    };
                });
            
            res.status(200).json({
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

// GET /api/products/:id - Get product by ID with complete inventory data
router.get('/:id', optionalAuthenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Single query resolves by id or _id (reduces up to 3 reads to 1)
        const query = buildProductLookupQuery(id);
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: query
        });
        
        if (result.success && result.data) {
            const product = result.data;
            // Storefront: unpublished products must not be visible (treat as not found); admin with token can see draft
            if (!req.isAdminRequest && !isPublishedForStorefront(product)) {
                return res.status(404).json({
                    success: false,
                    error: 'Product not found'
                });
            }
            // Process inventory data to ensure proper structure
            const language = translationService.getLanguageFromRequest(req);
            
            // Get requested currency from query parameter
            const requestedCurrency = req.query.currency?.toUpperCase() || null;
            const basePrice = product.price || 0;
            const baseCurrency = product.currency || currencyService.BASE_CURRENCY;

            // VAT for display: country from CF-IPCountry or ?country=; product base price is ex-VAT
            const { country: vatCountry, vatRate } = vatService.getCountryAndVatFromRequest(req);
            product.vat_display = { country: vatCountry, vat_rate: vatRate };
            product.price_including_vat = Math.round(basePrice * (1 + vatRate) * 100) / 100;
            
            // Per-request cache for exchange rates (avoids redundant exchange_rates reads)
            const rateCache = {};
            
            // Add multi-currency prices
            try {
                const multiCurrencyPrices = await currencyService.getMultiCurrencyPrices(basePrice, baseCurrency, rateCache);
                product.base_price = basePrice;
                product.currency = baseCurrency;
                product.prices = multiCurrencyPrices;
                
                // If specific currency requested, add converted_price field (reuses rateCache)
                if (requestedCurrency && requestedCurrency !== baseCurrency) {
                    const convertedPrice = multiCurrencyPrices[requestedCurrency];
                    if (convertedPrice !== undefined) {
                        product.selected_currency = requestedCurrency;
                        product.converted_price = convertedPrice;
                        const rate = await currencyService.getExchangeRate(baseCurrency, requestedCurrency, rateCache);
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
                
                // Process variants (storefront expects quantity; backend stores quantity)
                if (product.inventory.variants && Array.isArray(product.inventory.variants)) {
                    product.inventory.variants = product.inventory.variants.map((variant, index) => ({
                        id: variant.id || `variant_${Date.now()}_${index}`,
                        colorId: variant.colorId,
                        sizeId: variant.sizeId,
                        sku: variant.sku || '',
                        price: variant.price || product.price,
                        quantity: variant.quantity !== undefined ? variant.quantity : (variant.stock !== undefined ? variant.stock : 0),
                        stock: variant.stock !== undefined ? variant.stock : (variant.quantity !== undefined ? variant.quantity : 0),
                        available: variant.available !== undefined ? variant.available : true,
                        images: variant.images || [],
                        sortOrder: variant.sortOrder !== undefined ? variant.sortOrder : index
                    }));
                }
            }
            normalizeProductForResponse(product);
            
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
router.post('/:id/view', optionalAuthenticateAdmin, async (req, res) => {
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
        
        // Single query resolves by id or _id (reduces up to 3 reads to 1)
        const lookupQuery = buildProductLookupQuery(id);
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: lookupQuery
        });
        
        let product = null;
        let productId = null;
        let product_id = null; // MongoDB _id
        
        if (result.success && result.data) {
            product = Array.isArray(result.data) ? result.data[0] : result.data;
            productId = product?.id;
            product_id = product?._id || (product ? product._id : null);
        }
        
        if (!product || (!productId && !product_id)) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
        // Storefront: do not track views for unpublished products (and do not reveal they exist); admin can still track
        if (!req.isAdminRequest && !isPublishedForStorefront(product)) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
        
        // Initialize view counters if they don't exist
        const views = (product.views || 0) + 1;
        const viewsLast7Days = (product.viewsLast7Days || 0) + 1;
        const lastViewedAt = new Date().toISOString();
        
        // Build filter from the found product
        let filter = productId ? { id: productId } : { id: id };
        if (!productId && product_id) {
            const { ObjectId } = require('mongodb');
            try {
                filter = { _id: product_id instanceof ObjectId ? product_id : new ObjectId(String(product_id)) };
            } catch (e) {
                filter = { _id: product_id };
            }
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
router.get('/', optionalAuthenticateAdmin, async (req, res) => {
    try {
        const { category, featured, limit, search } = req.query;
        
        // Get requested language from query parameter
        const language = translationService.getLanguageFromRequest(req);
        
        let query = {};
        
        // Storefront: filter at DB level to avoid full scan (published: true only)
        // Admin with token: see all products including drafts
        if (!req.isAdminRequest) {
            query.published = true;
        }
        
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
            // Storefront: only published products (drafts must never appear); admin with token sees all
            if (!req.isAdminRequest) {
                products = (Array.isArray(products) ? products : []).filter(isPublishedForStorefront);
            } else {
                products = Array.isArray(products) ? products : (products ? [products] : []);
            }
            
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
            
            // Per-request cache for exchange rates (reduces ~180 DB reads to ~9 for product list)
            const rateCache = {};
            const { country: vatCountry, vatRate } = vatService.getCountryAndVatFromRequest(req);

            // Process inventory data for each product and add multi-currency prices
            products = await Promise.all(products.map(async (product) => {
                // Add multi-currency prices (shared rateCache avoids repeated exchange_rates reads)
                const basePrice = product.price || 0;
                const baseCurrency = product.currency || currencyService.BASE_CURRENCY;
                product.vat_display = { country: vatCountry, vat_rate: vatRate };
                product.price_including_vat = Math.round(basePrice * (1 + vatRate) * 100) / 100;

                try {
                    const multiCurrencyPrices = await currencyService.getMultiCurrencyPrices(basePrice, baseCurrency, rateCache);
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
                    
                    // Process variants (storefront expects quantity; backend stores quantity)
                    if (product.inventory.variants && Array.isArray(product.inventory.variants)) {
                        product.inventory.variants = product.inventory.variants.map((variant, index) => ({
                            id: variant.id || `variant_${Date.now()}_${index}`,
                            colorId: variant.colorId,
                            sizeId: variant.sizeId,
                            sku: variant.sku || '',
                            price: variant.price || product.price,
                            quantity: variant.quantity !== undefined ? variant.quantity : (variant.stock !== undefined ? variant.stock : 0),
                            stock: variant.stock !== undefined ? variant.stock : (variant.quantity !== undefined ? variant.quantity : 0),
                            available: variant.available !== undefined ? variant.available : true,
                            images: variant.images || [],
                            sortOrder: variant.sortOrder !== undefined ? variant.sortOrder : index
                        }));
                    }
                }
                normalizeProductForResponse(product);
                
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
router.post('/', authenticateAdmin, async (req, res) => {
    try {
        const productData = req.body;
        
        // Required fields (storefront contract)
        const requiredFields = ['name', 'price', 'category'];
        const missingFields = requiredFields.filter(field => {
            const v = productData[field];
            return v === undefined || v === null || (typeof v === 'string' && !v.trim());
        });
        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`,
                code: 'VALIDATION_ERROR'
            });
        }
        if (typeof productData.price !== 'number' || productData.price <= 0) {
            return res.status(400).json({
                success: false,
                error: 'price must be a positive number',
                code: 'VALIDATION_ERROR'
            });
        }
        
        // Normalize images into media[] only (accept media, images, image, imageUrl, etc.)
        const media = normalizeImagesToMedia(productData);
        productData.media = media;
        if (productData.imagePublicIds === undefined || !Array.isArray(productData.imagePublicIds)) {
            productData.imagePublicIds = [];
        }
        if (productData.media.length !== productData.imagePublicIds.length) {
            productData.imagePublicIds = productData.media.map((_, i) => productData.imagePublicIds[i] || '');
        }
        
        // At least one image required
        if (!productData.media || productData.media.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'At least one image is required (media or images/image/imageUrl)',
                code: 'VALIDATION_ERROR'
            });
        }
        
        // Validate Cloudinary media fields (length match)
        const mediaValidation = validateCloudinaryMedia(productData.media, productData.imagePublicIds);
        if (!mediaValidation.valid) {
            return res.status(400).json({
                success: false,
                error: mediaValidation.error,
                code: 'VALIDATION_ERROR'
            });
        }
        
        // At least one variant with quantity > 0 (inventory.variants or top-level variants)
        const variants = productData.inventory?.variants || productData.variants || [];
        const hasVariantWithStock = Array.isArray(variants) && variants.some(v => (v.quantity ?? v.stock ?? 0) > 0);
        if (!hasVariantWithStock) {
            return res.status(400).json({
                success: false,
                error: 'At least one variant with quantity > 0 is required',
                code: 'VALIDATION_ERROR'
            });
        }
        
        // Product detail content (Size & Fit, Materials, Shipping & Returns) – required for complete product
        const detailValidation = validateProductDetailContent(productData, false);
        if (!detailValidation.valid) {
            return res.status(400).json({
                success: false,
                error: `Missing or empty product detail fields required for the storefront: ${detailValidation.missing.join(', ')}. See product-detail-content-guide in docs.`,
                code: 'VALIDATION_ERROR',
                missingFields: detailValidation.missing
            });
        }
        
        // Generate product ID if not provided
        if (!productData.id) {
            productData.id = 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
        
        // Set default values (published: false by default for new products)
        productData.createdAt = new Date().toISOString();
        productData.updatedAt = new Date().toISOString();
        productData.active = productData.active !== undefined ? productData.active : true;
        productData.featured = productData.featured !== undefined ? productData.featured : false;
        productData.published = productData.published !== undefined ? productData.published : false;
        
        // Process inventory data if provided (returns full document with inventory normalized)
        if (productData.inventory) {
            productData = db.processInventoryData(productData);
        }
        
        // Automatically generate Swedish translations for new product
        const swedishTranslations = productTranslationHelper.generateSwedishTranslations(productData);
        if (Object.keys(swedishTranslations).length > 0) {
            Object.assign(productData, swedishTranslations);
            console.log(`🌐 [Auto-Translation] Generated ${Object.keys(swedishTranslations).length} Swedish translation(s) for new product`);
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--create',
            data: productData
        });
        
        if (!result.success) {
            return res.status(400).json(result);
        }
        
        // Return full product document (create returns insert result, so re-fetch by id)
        const readResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id: productData.id }
        });
        let created = readResult.success && readResult.data ? readResult.data : productData;
        if (!created.id) created.id = productData.id;
        normalizeProductForResponse(created);
        
        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            data: created
        });
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create product'
        });
    }
});

// PUT /api/products/:id - Update product (admin)
router.put('/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        // Preserve published from request so visibility (Published/Draft) always persists (partial or full update)
        const publishedFromRequest = req.body.published;
        const hasPublishedInBody = publishedFromRequest === true || publishedFromRequest === false;
        
        // Product detail content: when any of these fields are sent, validate they are non-empty (partial update)
        const detailValidation = validateProductDetailContent(updateData, true);
        if (!detailValidation.valid) {
            return res.status(400).json({
                success: false,
                error: `Invalid or empty product detail fields: ${detailValidation.missing.join(', ')}. See product-detail-content-guide in docs.`,
                code: 'VALIDATION_ERROR',
                missingFields: detailValidation.missing
            });
        }
        
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
        
        // Resolve existing product by id then by _id (same as GET /:id) so admin can use either in the URL
        let existingProductResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id }
        });
        let existingProduct = existingProductResult.success && existingProductResult.data ? existingProductResult.data : null;
        let updateFilter = { id };
        if (!existingProduct) {
            const { ObjectId } = require('mongodb');
            try {
                existingProductResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--read',
                    data: { _id: new ObjectId(id) }
                });
            } catch (_) {
                existingProductResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--read',
                    data: { _id: id }
                });
            }
            existingProduct = existingProductResult.success && existingProductResult.data ? existingProductResult.data : null;
            if (existingProduct) {
                updateFilter = { _id: typeof existingProduct._id === 'string' ? existingProduct._id : existingProduct._id };
            }
        }
        if (!existingProduct) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
        
        // Process inventory if provided (processInventoryData returns full doc; we only set .inventory)
        if (updateData.inventory) {
            const mergedForInventory = { ...existingProduct, ...updateData };
            const processed = db.processInventoryData(mergedForInventory);
            updateData.inventory = processed.inventory;
        }
        
        // Merge existing product data with update data to check for translations
        const mergedProduct = { ...existingProduct, ...updateData };
        
        // Automatically generate Swedish translations for updated fields (if missing)
        const swedishTranslations = productTranslationHelper.generateSwedishTranslations(mergedProduct);
        if (Object.keys(swedishTranslations).length > 0) {
            // Merge Swedish translations into update data
            Object.assign(updateData, swedishTranslations);
            console.log(`🌐 [Auto-Translation] Generated ${Object.keys(swedishTranslations).length} Swedish translation(s) for updated product`);
        }
        // Ensure published is persisted when admin sends it (list badge toggle or edit form)
        if (hasPublishedInBody) {
            updateData.published = publishedFromRequest;
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--update',
            data: {
                filter: updateFilter,
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
router.delete('/:id', authenticateAdmin, async (req, res) => {
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
router.get('/:id/variants', optionalAuthenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Single query resolves by id or _id
        const query = buildProductLookupQuery(id);
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: query
        });
        
        if (result.success && result.data) {
            const product = result.data;
            // Storefront: unpublished products must not be visible (treat as not found); admin with token can see draft
            if (!req.isAdminRequest && !isPublishedForStorefront(product)) {
                return res.status(404).json({
                    success: false,
                    error: 'Product not found'
                });
            }
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

module.exports = router;
