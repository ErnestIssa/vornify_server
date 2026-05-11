const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const currencyService = require('../services/currencyService');
const translationService = require('../services/translationService');
const productTranslationHelper = require('../services/productTranslationHelper');
const seoHelper = require('../utils/seoHelper');
const reviewStatsHelper = require('../utils/reviewStatsHelper');
const variantService = require('../services/variantService');
const vatService = require('../services/vatService');
const currencySelectionService = require('../services/currencySelectionService');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { devLog, devWarn } = require('../core/logging/devConsole');
const { logger } = require('../core/logging/logger');

const STORE_BASE_CURRENCY = 'SEK';
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
        devLog(`[View Throttle] Cleaned up ${keysToDelete.length} expired throttle entries`);
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
function ensureInventoryStorefrontDefaults(inv) {
    if (!inv) return;
    if (!inv.storefront || typeof inv.storefront !== 'object') inv.storefront = {};
    if (typeof inv.storefront.showListingWhenFullySoldOut !== 'boolean') {
        inv.storefront.showListingWhenFullySoldOut = false;
    }
}

function normalizeProductForResponse(product) {
    if (!product) return product;
    if (!product.id && product._id) {
        product.id = typeof product._id === 'string' ? product._id : product._id.toString();
    }
    const inv = product.inventory;
    ensureInventoryStorefrontDefaults(inv);
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
    if (inv) {
        const matrix = variantService.buildColorSizeMatrix(inv);
        if (matrix) {
            inv.colorSizeMatrix = matrix;
        } else {
            delete inv.colorSizeMatrix;
        }
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
        devLog('[MOST VIEWED] Request received', {
            limit: req.query.limit,
            timestamp: new Date().toISOString()
        });

        const limit = parseInt(req.query.limit) || 12;
        
        // Check if db instance is available
        if (!db) {
            logger.error('products_most_viewed_db_unavailable', {});
            return res.status(500).json({
                success: false,
                error: 'Database not initialized',
                message: 'Database connection not available'
            });
        }

        // Check if executeOperation method exists
        if (typeof db.executeOperation !== 'function') {
            logger.error('products_most_viewed_execute_operation_missing', {});
            return res.status(500).json({
                success: false,
                error: 'Database method not available',
                message: 'executeOperation method not found'
            });
        }

        devLog('[MOST VIEWED] Querying database for products…');
        // Storefront: filter published at DB level; admin: all products
        const query = req.isAdminRequest ? {} : { published: true };
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: query
        });
        
        devLog('[MOST VIEWED] Database query result', {
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
            
            devLog(`[Most Viewed] Returning ${products.length} products (sorted from ${result.data?.length || 0} total)`);
            res.json({
                success: true,
                data: products
            });
        } else {
            logger.error('products_most_viewed_query_failed', {
                message: result?.error || result?.message || 'unknown'
            });
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve most viewed products'
            });
        }
    } catch (error) {
        logger.error('products_most_viewed_error', { message: error.message });
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
        logger.error('products_get_categories_error', { message: error.message });
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
            devLog('[CRON/PING] GET /api/products/sitemap hit');
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
        logger.error('products_sitemap_error', { message: error.message });
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

            // VAT for display: country from CF-IPCountry or ?country=; product base price is ex-VAT (stored in SEK)
            const { country: vatCountry, vatRate } = vatService.getCountryAndVatFromRequest(req);
            product.vat_display = { country: vatCountry, vat_rate: vatRate };
            let priceInclVatSEK = Math.round(basePrice * (1 + vatRate) * 100) / 100;
            product.price_including_vat = priceInclVatSEK;
            const compareAt = product.compareAtPrice ?? product.compare_at_price;
            let compareAtInclVatSEK = null;
            if (typeof compareAt === 'number' && !isNaN(compareAt) && compareAt > 0) {
                compareAtInclVatSEK = Math.round(compareAt * (1 + vatRate) * 100) / 100;
                product.compare_at_price_including_vat = compareAtInclVatSEK;
            }
            
            // Display currency: ?currency= override or auto from country (SE→SEK, EU→EUR, else→USD). Symbols: SEK→kr, EUR→€, USD→$
            const { currency: displayCurrency, currencySymbol } = currencySelectionService.getDisplayCurrencyFromRequest(req);
            const rateCache = {};
            if (displayCurrency && displayCurrency !== STORE_BASE_CURRENCY) {
                try {
                    const rate = await currencyService.getExchangeRate(STORE_BASE_CURRENCY, displayCurrency, rateCache);
                    product.price_including_vat = Math.round(priceInclVatSEK * rate * 100) / 100;
                    if (compareAtInclVatSEK != null) {
                        product.compare_at_price_including_vat = Math.round(compareAtInclVatSEK * rate * 100) / 100;
                    }
                } catch (e) {
                    devWarn('Product detail: currency conversion failed, using SEK', e.message);
                }
            }
            product.currency = displayCurrency || STORE_BASE_CURRENCY;
            product.currencySymbol = currencySymbol || currencySelectionService.getCurrencySymbol(displayCurrency || STORE_BASE_CURRENCY);
            
            // Per-request cache for exchange rates (avoids redundant exchange_rates reads)
            
            // Add multi-currency prices (legacy; base in DB is SEK)
            try {
                const multiCurrencyPrices = await currencyService.getMultiCurrencyPrices(basePrice, STORE_BASE_CURRENCY, rateCache);
                product.base_price = basePrice;
                product.prices = multiCurrencyPrices;
                if (requestedCurrency && multiCurrencyPrices[requestedCurrency] !== undefined) {
                    product.selected_currency = requestedCurrency;
                    product.converted_price = multiCurrencyPrices[requestedCurrency];
                }
            } catch (currencyError) {
                logger.warn('products_detail_multi_currency_failed', {
                    message: currencyError.message || String(currencyError)
                });
                product.base_price = basePrice;
                product.prices = { [STORE_BASE_CURRENCY]: basePrice };
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

                // Color-specific media map (premium variants)
                if (product.inventory.colorMedia && Array.isArray(product.inventory.colorMedia)) {
                    product.inventory.colorMedia = product.inventory.colorMedia.map((m, index) => ({
                        colorId: m.colorId,
                        media: Array.isArray(m.media) ? m.media : (Array.isArray(m.images) ? m.images : []),
                        imagePublicIds: Array.isArray(m.imagePublicIds) ? m.imagePublicIds : [],
                        sortOrder: m.sortOrder !== undefined ? m.sortOrder : index,
                        active: m.active !== undefined ? m.active : true
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
                logger.warn('products_detail_review_stats_seo_failed', { message: error.message });
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
                language: language,
                currency: product.currency || STORE_BASE_CURRENCY,
                currencySymbol: product.currencySymbol || currencySelectionService.getCurrencySymbol(product.currency || STORE_BASE_CURRENCY)
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
    } catch (error) {
        logger.error('products_get_one_error', { message: error.message });
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
            devLog(`[View Throttled] Product ${id} from IP ${clientIp} — rejected (within 30 min)`);
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
            devLog(`[View Tracked] Product ${productId || product_id} — total ${views}, last 7d ${viewsLast7Days}`);
            
            res.json({
                success: true,
                views: views,
                viewsLast7Days: viewsLast7Days
            });
        } else {
            logger.error('products_view_track_update_failed', {
                productRef: productId || String(product_id),
                message: updateResult.error || 'unknown'
            });
            res.status(500).json({
                success: false,
                error: 'Failed to update view count',
                details: updateResult.error
            });
        }
    } catch (error) {
        logger.error('products_view_track_error', { message: error.message });
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
            
            const rateCache = {};
            const { country: vatCountry, vatRate } = vatService.getCountryAndVatFromRequest(req);
            const { currency: displayCurrency, currencySymbol } = currencySelectionService.getDisplayCurrencyFromRequest(req);
            let sekToDisplayRate = 1;
            if (displayCurrency && displayCurrency !== STORE_BASE_CURRENCY) {
                try {
                    sekToDisplayRate = await currencyService.getExchangeRate(STORE_BASE_CURRENCY, displayCurrency, rateCache);
                } catch (e) {
                    devWarn('Product list: currency rate fetch failed, using SEK', e.message);
                }
            }

            // Process inventory data for each product; prices stored in SEK, converted to display currency
            products = await Promise.all(products.map(async (product) => {
                const basePrice = product.price || 0;
                product.vat_display = { country: vatCountry, vat_rate: vatRate };
                let priceInclVatSEK = Math.round(basePrice * (1 + vatRate) * 100) / 100;
                product.price_including_vat = displayCurrency === STORE_BASE_CURRENCY ? priceInclVatSEK : Math.round(priceInclVatSEK * sekToDisplayRate * 100) / 100;
                const compareAt = product.compareAtPrice ?? product.compare_at_price;
                if (typeof compareAt === 'number' && !isNaN(compareAt) && compareAt > 0) {
                    const compareAtSEK = Math.round(compareAt * (1 + vatRate) * 100) / 100;
                    product.compare_at_price_including_vat = displayCurrency === STORE_BASE_CURRENCY ? compareAtSEK : Math.round(compareAtSEK * sekToDisplayRate * 100) / 100;
                }
                product.currency = displayCurrency || STORE_BASE_CURRENCY;
                product.currencySymbol = currencySymbol || currencySelectionService.getCurrencySymbol(displayCurrency || STORE_BASE_CURRENCY);
                try {
                    const multiCurrencyPrices = await currencyService.getMultiCurrencyPrices(basePrice, STORE_BASE_CURRENCY, rateCache);
                    product.base_price = basePrice;
                    product.prices = multiCurrencyPrices;
                } catch (currencyError) {
                    logger.warn('products_list_multi_currency_failed', {
                        productId: product.id,
                        message: currencyError.message || String(currencyError)
                    });
                    product.base_price = basePrice;
                    product.prices = { [STORE_BASE_CURRENCY]: basePrice };
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
                logger.warn('products_detail_review_stats_seo_failed', { message: error.message });
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
                language: language,
                currency: displayCurrency || STORE_BASE_CURRENCY,
                currencySymbol: currencySymbol || currencySelectionService.getCurrencySymbol(displayCurrency || STORE_BASE_CURRENCY)
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve products'
            });
        }
    } catch (error) {
        logger.error('products_list_error', { message: error.message });
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
        
        // At least one variant with quantity > 0 unless merchant opts into “visible when sold out” (inventory.storefront.showListingWhenFullySoldOut).
        const variants = productData.inventory?.variants || productData.variants || [];
        const hasVariantWithStock = Array.isArray(variants) && variants.some(v => (v.quantity ?? v.stock ?? 0) > 0);
        const allowAllZeroSku = productData.inventory?.storefront?.showListingWhenFullySoldOut === true;
        if (!hasVariantWithStock && !allowAllZeroSku) {
            return res.status(400).json({
                success: false,
                error: 'At least one variant with quantity > 0 is required (or set inventory.storefront.showListingWhenFullySoldOut to true)',
                code: 'VALIDATION_ERROR'
            });
        }

        // Premium variants: normalize + validate per-color image mapping (backend source of truth).
        if (productData.inventory) {
            productData.inventory = variantService.normalizeInventoryColorMedia(productData.inventory);
            const enforceOnDraft = process.env.ENFORCE_COLOR_IMAGES_ON_DRAFT === 'true';
            const cmValidation = variantService.validateColorMediaPolicy({
                inventory: productData.inventory,
                published: productData.published === true,
                enforceOnDraft
            });
            if (!cmValidation.valid) {
                return res.status(400).json({
                    success: false,
                    error: cmValidation.error,
                    code: cmValidation.code || 'VALIDATION_ERROR',
                    missingColorIds: cmValidation.missingColorIds || []
                });
            }
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
        if (productData.warehouseIds !== undefined) {
            productData.warehouseIds = Array.isArray(productData.warehouseIds) ? productData.warehouseIds : (productData.warehouseIds ? [productData.warehouseIds] : []);
        }
        
        // Process inventory data if provided (returns full document with inventory normalized)
        if (productData.inventory) {
            productData = db.processInventoryData(productData);
        }
        
        // Automatically generate Swedish translations for new product
        const swedishTranslations = productTranslationHelper.generateSwedishTranslations(productData);
        if (Object.keys(swedishTranslations).length > 0) {
            Object.assign(productData, swedishTranslations);
            devLog(`[Auto-Translation] Generated ${Object.keys(swedishTranslations).length} Swedish translation(s) for new product`);
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
        logger.error('products_create_error', { message: error.message });
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

        // Warehouse assignment: which warehouse(s) have this product (for multi-warehouse selection)
        if (updateData.warehouseIds !== undefined) {
            updateData.warehouseIds = Array.isArray(updateData.warehouseIds) ? updateData.warehouseIds : (updateData.warehouseIds ? [updateData.warehouseIds] : []);
        }
        
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
            // Premium variants: normalize + validate per-color image mapping (backend source of truth).
            updateData.inventory = variantService.normalizeInventoryColorMedia(updateData.inventory);
            const enforceOnDraft = process.env.ENFORCE_COLOR_IMAGES_ON_DRAFT === 'true';
            const mergedPublished = hasPublishedInBody ? (publishedFromRequest === true) : (existingProduct.published === true);
            const cmValidation = variantService.validateColorMediaPolicy({
                inventory: updateData.inventory,
                published: mergedPublished,
                enforceOnDraft
            });
            if (!cmValidation.valid) {
                return res.status(400).json({
                    success: false,
                    error: cmValidation.error,
                    code: cmValidation.code || 'VALIDATION_ERROR',
                    missingColorIds: cmValidation.missingColorIds || []
                });
            }

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
            devLog(`[Auto-Translation] Generated ${Object.keys(swedishTranslations).length} Swedish translation(s) for updated product`);
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
        logger.error('products_update_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to update product'
        });
    }
});

/**
 * POST /api/products/:id/seed-color-media
 * Admin helper to seed `inventory.colorMedia[]` from global `product.media[]`.
 *
 * Use cases:
 * - Legacy products: quickly make them publishable under the new color->images requirement
 * - Staff can then refine per-color galleries later
 *
 * Body (optional):
 * - mode: 'missing' | 'all' (default 'missing')
 */
router.post('/:id/seed-color-media', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const mode = (req.body && typeof req.body.mode === 'string') ? req.body.mode : 'missing';

        // Load product by id/_id (same logic as update)
        let existingProductResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id }
        });
        let product = existingProductResult.success && existingProductResult.data ? existingProductResult.data : null;
        let updateFilter = { id };
        if (!product) {
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
            product = existingProductResult.success && existingProductResult.data ? existingProductResult.data : null;
            if (product) {
                updateFilter = { _id: typeof product._id === 'string' ? product._id : product._id };
            }
        }

        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        if (!product.inventory || !Array.isArray(product.inventory.colors) || product.inventory.colors.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Product has no inventory.colors; cannot seed per-color media',
                code: 'VALIDATION_ERROR'
            });
        }

        const globalMedia = Array.isArray(product.media) ? product.media : [];
        const globalPublicIds = Array.isArray(product.imagePublicIds) ? product.imagePublicIds : [];
        if (!globalMedia.length) {
            return res.status(400).json({
                success: false,
                error: 'Product has no global media[] to seed from',
                code: 'VALIDATION_ERROR'
            });
        }

        const existing = Array.isArray(product.inventory.colorMedia) ? product.inventory.colorMedia : [];
        const byColorId = new Map(existing.map((e) => [e && e.colorId, e]).filter(([k]) => typeof k === 'string' && k));

        const seededColorIds = [];
        for (const c of product.inventory.colors) {
            const colorId = c && c.id;
            if (!colorId) continue;
            const already = byColorId.get(colorId);

            if (mode !== 'all') {
                const hasImages = already && Array.isArray(already.media) && already.media.length > 0;
                if (hasImages) continue;
            }

            seededColorIds.push(colorId);
            byColorId.set(colorId, {
                colorId,
                media: globalMedia,
                imagePublicIds: globalPublicIds.slice(0, globalMedia.length),
                sortOrder: typeof c.sortOrder === 'number' ? c.sortOrder : 0,
                active: true,
                legacyFallback: true,
                seededAt: new Date().toISOString()
            });
        }

        const updatedInventory = variantService.normalizeInventoryColorMedia({
            ...(product.inventory || {}),
            colorMedia: Array.from(byColorId.values())
        });

        const updateData = {
            inventory: updatedInventory,
            updatedAt: new Date().toISOString()
        };

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--update',
            data: { filter: updateFilter, update: updateData }
        });
        if (!updateResult.success) {
            return res.status(500).json({ success: false, error: updateResult.error || 'Update failed' });
        }

        const readResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: updateFilter
        });
        const updated = readResult.success && readResult.data ? readResult.data : { ...product, ...updateData };
        normalizeProductForResponse(updated);

        return res.json({
            success: true,
            message: seededColorIds.length
                ? `Seeded colorMedia for ${seededColorIds.length} color(s)`
                : 'No changes (colorMedia already present for all colors)',
            seededColorIds,
            data: updated
        });
    } catch (e) {
        logger.error('products_seed_color_media_error', { message: e.message });
        return res.status(500).json({ success: false, error: e.message || 'Failed to seed colorMedia' });
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
        logger.error('products_delete_error', { message: error.message });
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
        logger.error('products_variants_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve product variants'
        });
    }
});

module.exports = router;
