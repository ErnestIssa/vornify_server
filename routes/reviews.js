const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

// Helper function to generate unique Review ID
async function generateUniqueReviewId() {
    let reviewId;
    let exists = true;
    
    do {
        reviewId = `RV${Date.now().toString().slice(-8)}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--read',
            data: { id: reviewId }
        });
        
        exists = result.success && result.data;
    } while (exists);
    
    return reviewId;
}

// Helper function to get customer information
async function getCustomerInfo(customerId) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--read',
            data: { email: customerId }
        });
        
        if (result.success && result.data) {
            return {
                id: result.data.email,
                name: result.data.name,
                email: result.data.email,
                avatar: result.data.avatar || null
            };
        }
        return null;
    } catch (error) {
        console.error('Error getting customer info:', error);
        return null;
    }
}

// Helper function to get product information
async function getProductInfo(productId) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id: productId }
        });
        
        if (result.success && result.data) {
            return {
                id: result.data.id,
                name: result.data.name,
                image: result.data.image || result.data.images?.[0] || null,
                category: result.data.category || null,
                price: result.data.price || 0
            };
        }
        return null;
    } catch (error) {
        console.error('Error getting product info:', error);
        return null;
    }
}

// Exclude soft-deleted orders (align with orders.js)
const NOT_DELETED_ORDER = { $or: [ { deletedAt: { $exists: false } }, { deletedAt: null } ] };

// Helper function to verify purchase by email + productId (excludes soft-deleted orders)
async function verifyPurchase(customerEmail, productId) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: {
                $and: [
                    { 'customer.email': customerEmail },
                    { 'items.productId': productId },
                    { status: { $in: ['delivered', 'completed'] } },
                    NOT_DELETED_ORDER
                ]
            }
        });

        if (result.success && result.data) {
            const orders = Array.isArray(result.data) ? result.data : [result.data];
            if (orders.length > 0) {
                const order = orders[0];
                return {
                    orderId: order.orderId,
                    orderDate: order.createdAt || order.orderDate,
                    purchaseDate: order.createdAt || order.orderDate
                };
            }
        }
        return null;
    } catch (error) {
        console.error('Error verifying purchase:', error);
        return null;
    }
}

// Helper: verify purchase when frontend sends orderId (order must exist, belong to email, contain productId)
async function verifyPurchaseByOrder(orderId, customerEmail, productId) {
    if (!orderId || !customerEmail || !productId) return null;
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        if (!result.success || !result.data) return null;
        const orders = Array.isArray(result.data) ? result.data : [result.data];
        const order = orders[0];
        if (!order) return null;
        if (order.deletedAt != null || order.deleted === true) return null;
        const status = (order.status || '').toLowerCase();
        if (!['delivered', 'completed'].includes(status)) return null;
        const orderEmail = (order.customer && order.customer.email) || order.customerEmail || '';
        if (orderEmail.toLowerCase() !== String(customerEmail).toLowerCase()) return null;
        const items = order.items || [];
        const hasProduct = items.some(item => (item.productId || item.id) === productId);
        if (!hasProduct) return null;
        return {
            orderId: order.orderId,
            orderDate: order.createdAt || order.orderDate,
            purchaseDate: order.createdAt || order.orderDate
        };
    } catch (error) {
        console.error('Error verifying purchase by order:', error);
        return null;
    }
}

// Helper: one review per (customerEmail + productId)
async function hasDuplicateReview(customerEmail, productId) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--read',
            data: { customerEmail, productId }
        });
        if (!result.success) return false;
        const list = result.data;
        const count = Array.isArray(list) ? list.length : (list ? 1 : 0);
        return count > 0;
    } catch (error) {
        console.error('Error checking duplicate review:', error);
        return false;
    }
}

// Helper: count non-deleted orders for an email (for review limit)
async function countOrdersForEmail(customerEmail) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: {
                $and: [
                    NOT_DELETED_ORDER,
                    { $or: [ { 'customer.email': customerEmail }, { customerEmail: customerEmail } ] }
                ]
            }
        });
        if (!result.success || !result.data) return 0;
        const list = result.data;
        return Array.isArray(list) ? list.length : (list ? 1 : 0);
    } catch (error) {
        console.error('Error counting orders for email:', error);
        return 0;
    }
}

// Helper: count existing reviews for an email (for review limit)
async function countReviewsForEmail(customerEmail) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--read',
            data: { customerEmail }
        });
        if (!result.success || !result.data) return 0;
        const list = result.data;
        return Array.isArray(list) ? list.length : (list ? 1 : 0);
    } catch (error) {
        console.error('Error counting reviews for email:', error);
        return 0;
    }
}

// GET /api/reviews - Get all reviews with filtering
router.get('/', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 50, 
            status, 
            productId,
            source, 
            rating, 
            verified, 
            flagged, 
            search,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;
        
        // Build simple query for VortexDB (no complex MongoDB operators)
        let query = {};
        
        // Add simple filters (VortexDB compatible)
        if (status) query.status = status;
        if (productId) query.productId = productId;
        if (source) query.reviewSource = source;
        if (rating) query.rating = parseInt(rating);
        if (verified !== undefined) query.verifiedPurchase = verified === 'true';
        if (flagged !== undefined) query.flagged = flagged === 'true';

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--read',
            data: query
        });

        if (result.success) {
            let reviews = result.data || [];
            if (!Array.isArray(reviews)) {
                reviews = [reviews];
            }

            // Apply additional filters in memory (for complex queries)
            
            // Date range filtering
            if (startDate || endDate) {
                const start = startDate ? new Date(startDate) : null;
                const end = endDate ? new Date(endDate) : null;
                reviews = reviews.filter(review => {
                    const reviewDate = new Date(review.createdAt);
                    if (start && reviewDate < start) return false;
                    if (end && reviewDate > end) return false;
                    return true;
                });
            }
            
            // Search functionality
            if (search) {
                const searchLower = search.toLowerCase();
                reviews = reviews.filter(review => {
                    return (
                        (review.title && review.title.toLowerCase().includes(searchLower)) ||
                        (review.comment && review.comment.toLowerCase().includes(searchLower)) ||
                        (review.product?.name && review.product.name.toLowerCase().includes(searchLower)) ||
                        (review.customer?.name && review.customer.name.toLowerCase().includes(searchLower)) ||
                        (review.customerName && review.customerName.toLowerCase().includes(searchLower))
                    );
                });
            }

            // Sort reviews
            reviews.sort((a, b) => {
                const aValue = a[sortBy] || a.createdAt;
                const bValue = b[sortBy] || b.createdAt;
                
                if (sortOrder === 'desc') {
                    return new Date(bValue) - new Date(aValue);
                } else {
                    return new Date(aValue) - new Date(bValue);
                }
            });

            // Pagination
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + parseInt(limit);
            const paginatedReviews = reviews.slice(startIndex, endIndex);

            // Ensure all reviews have location and images fields (even if empty)
            const normalizedReviews = paginatedReviews.map(review => ({
                ...review,
                location: review.location || null, // Always include location field
                images: Array.isArray(review.images) ? review.images : (review.images ? [review.images] : []), // Always include images as array
                // Ensure isVerified field exists (for frontend compatibility)
                isVerified: review.verifiedPurchase || false
            }));

            res.json({
                success: true,
                data: normalizedReviews,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: reviews.length,
                    pages: Math.ceil(reviews.length / limit)
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve reviews'
            });
        }
    } catch (error) {
        console.error('Get reviews error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve reviews'
        });
    }
});

// GET /api/reviews/analytics - Get comprehensive review analytics
router.get('/analytics', async (req, res) => {
    try {
        // Get all reviews
        const reviewsResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--read',
            data: {}
        });

        const reviews = reviewsResult.success ? reviewsResult.data : [];
        const reviewArray = Array.isArray(reviews) ? reviews : (reviews ? [reviews] : []);

        // Calculate analytics
        const totalReviews = reviewArray.length;
        const pendingReviews = reviewArray.filter(r => r.status === 'pending').length;
        const approvedReviews = reviewArray.filter(r => r.status === 'approved').length;
        const rejectedReviews = reviewArray.filter(r => r.status === 'rejected').length;
        const flaggedReviews = reviewArray.filter(r => r.flagged).length;
        const verifiedPurchases = reviewArray.filter(r => r.verifiedPurchase).length;

        // Calculate average rating
        const approvedReviewRatings = reviewArray.filter(r => r.status === 'approved');
        const averageRating = approvedReviewRatings.length > 0 ? 
            approvedReviewRatings.reduce((sum, r) => sum + r.rating, 0) / approvedReviewRatings.length : 0;

        // Rating distribution
        const ratingDistribution = {
            1: reviewArray.filter(r => r.rating === 1).length,
            2: reviewArray.filter(r => r.rating === 2).length,
            3: reviewArray.filter(r => r.rating === 3).length,
            4: reviewArray.filter(r => r.rating === 4).length,
            5: reviewArray.filter(r => r.rating === 5).length
        };

        // Review sources breakdown
        const reviewSources = {
            product_page: reviewArray.filter(r => r.reviewSource === 'product_page').length,
            email_request: reviewArray.filter(r => r.reviewSource === 'email_request').length,
            post_purchase: reviewArray.filter(r => r.reviewSource === 'post_purchase').length,
            manual: reviewArray.filter(r => r.reviewSource === 'manual').length,
            imported: reviewArray.filter(r => r.reviewSource === 'imported').length
        };

        // Recent reviews (last 10)
        const recentReviews = reviewArray
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 10)
            .map(review => ({
                id: review.id,
                title: review.title,
                rating: review.rating,
                status: review.status,
                customer: review.customer,
                product: review.product,
                createdAt: review.createdAt
            }));

        // Top rated products (average rating >= 4.5)
        const productRatings = {};
        reviewArray.forEach(review => {
            if (review.status === 'approved' && review.product) {
                const productId = review.product.id;
                if (!productRatings[productId]) {
                    productRatings[productId] = {
                        product: review.product,
                        ratings: [],
                        totalRating: 0,
                        count: 0
                    };
                }
                productRatings[productId].ratings.push(review.rating);
                productRatings[productId].totalRating += review.rating;
                productRatings[productId].count++;
            }
        });

        const topRatedProducts = Object.values(productRatings)
            .map(product => ({
                ...product.product,
                averageRating: product.totalRating / product.count,
                reviewCount: product.count
            }))
            .filter(product => product.averageRating >= 4.5)
            .sort((a, b) => b.averageRating - a.averageRating)
            .slice(0, 10);

        // Low rated products (average rating <= 2.5)
        const lowRatedProducts = Object.values(productRatings)
            .map(product => ({
                ...product.product,
                averageRating: product.totalRating / product.count,
                reviewCount: product.count
            }))
            .filter(product => product.averageRating <= 2.5)
            .sort((a, b) => a.averageRating - b.averageRating)
            .slice(0, 10);

        res.json({
            success: true,
            data: {
                totalReviews,
                pendingReviews,
                approvedReviews,
                rejectedReviews,
                flaggedReviews,
                verifiedPurchases,
                averageRating: Math.round(averageRating * 100) / 100,
                ratingDistribution,
                reviewSources,
                recentReviews,
                topRatedProducts,
                lowRatedProducts
            }
        });
    } catch (error) {
        console.error('Get review analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve review analytics'
        });
    }
});

// GET /api/reviews/:id - Get specific review details
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--read',
            data: { id: id }
        });
        
        if (result.success && result.data) {
            // Normalize review data to ensure location and images fields are always present
            const review = result.data;
            const normalizedReview = {
                ...review,
                location: review.location || null, // Always include location field
                images: Array.isArray(review.images) ? review.images : (review.images ? [review.images] : []), // Always include images as array
                // Ensure isVerified field exists (for frontend compatibility)
                isVerified: review.verifiedPurchase || false
            };
            
            res.json({
                success: true,
                data: normalizedReview
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Review not found'
            });
        }
    } catch (error) {
        console.error('Get review error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve review'
        });
    }
});

// POST /api/reviews - Create new review
// Backend is the single authority: purchase verification, duplicate prevention, verifiedPurchase flag.
// Frontend must NOT send verifiedPurchase; backend sets it from order verification.
router.post('/', async (req, res) => {
    try {
        const reviewData = req.body;

        const isValidEmail = (email) => email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

        // Required: productId, rating, comment, customerEmail. Optional: customerName, images, orderId, reviewSource.
        // Backend sets: verifiedPurchase, createdAt, updatedAt. Do not accept verifiedPurchase from body.
        const missing = [];
        if (reviewData.productId == null) missing.push('productId');
        if (reviewData.rating == null) missing.push('rating');
        if (reviewData.comment == null) missing.push('comment');
        if (reviewData.customerEmail == null) missing.push('customerEmail');
        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missing.join(', ')}`,
                error: 'validation_error',
                code: 'VALIDATION_ERROR'
            });
        }

        if (reviewData.rating < 1 || reviewData.rating > 5) {
            return res.status(400).json({
                success: false,
                message: 'Rating must be between 1 and 5',
                error: 'invalid_rating',
                code: 'INVALID_RATING'
            });
        }
        if (!isValidEmail(reviewData.customerEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format',
                error: 'invalid_email',
                code: 'INVALID_EMAIL'
            });
        }

        const validSources = ['product_page', 'email_request', 'post_purchase', 'manual', 'imported'];
        const reviewSource = (reviewData.reviewSource && validSources.includes(reviewData.reviewSource))
            ? reviewData.reviewSource
            : (reviewData.orderId ? 'post_purchase' : 'product_page');

        // For productId === 'general': skip duplicate check and review-limit check (allow multiple reviews per email).
        if (reviewData.productId !== 'general') {
            // 1. Duplicate: one review per (customerEmail + productId)
            const duplicate = await hasDuplicateReview(reviewData.customerEmail, reviewData.productId);
            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    message: 'You have already submitted a review for this product.',
                    error: 'Duplicate review',
                    code: 'DUPLICATE_REVIEW'
                });
            }

            // 2. Review limit: max reviews per email = number of orders linked to that email
            const orderCount = await countOrdersForEmail(reviewData.customerEmail);
            const existingReviewCount = await countReviewsForEmail(reviewData.customerEmail);
            if (orderCount > 0 && existingReviewCount >= orderCount) {
                return res.status(403).json({
                    success: false,
                    message: 'You have reached the maximum number of reviews allowed for your purchases. You can submit one review per order.',
                    error: 'Review limit reached',
                    code: 'REVIEW_LIMIT_REACHED'
                });
            }
        }

        // 3. Purchase verification (backend-only authority)
        // When productId is "general", skip purchase verification and set verifiedPurchase = false (general feedback).
        let orderInfo = null;
        let verifiedPurchase = false;
        if (reviewData.productId !== 'general') {
            if (reviewData.orderId) {
                orderInfo = await verifyPurchaseByOrder(reviewData.orderId, reviewData.customerEmail, reviewData.productId);
            } else {
                orderInfo = await verifyPurchase(reviewData.customerEmail, reviewData.productId);
            }
            if (!orderInfo) {
                return res.status(403).json({
                    success: false,
                    message: 'You must have purchased this product to submit a review. We could not verify a purchase for this email and product.',
                    error: 'Purchase not verified',
                    code: 'PURCHASE_NOT_VERIFIED'
                });
            }
            verifiedPurchase = true;
        }

        const reviewId = await generateUniqueReviewId();
        const now = new Date().toISOString();

        let customerInfo = null;
        if (reviewData.customerEmail) {
            customerInfo = await getCustomerInfo(reviewData.customerEmail);
        }
        let productInfo = null;
        if (reviewData.productId !== 'general') {
            productInfo = await getProductInfo(reviewData.productId);
        }

        // Process images field - always include it, handle null explicitly
        const processedImages = (() => {
            // Explicitly handle null, undefined, or missing
            if (reviewData.images === null || reviewData.images === undefined) {
                console.log(`📸 No images provided for review ${reviewId} (null/undefined)`);
                return []; // Default to empty array
            }
            
            if (!Array.isArray(reviewData.images)) {
                console.warn(`⚠️ Review images is not an array for review ${reviewId}:`, typeof reviewData.images, reviewData.images);
                return []; // Return empty array if not valid
            }
            
            if (reviewData.images.length === 0) {
                console.log(`📸 Empty images array for review ${reviewId}`);
                return []; // Return empty array
            }
            
            // Process each image - accept URLs and base64
            const processed = reviewData.images.map((img, index) => {
                if (img === null || img === undefined) {
                    console.warn(`⚠️ Image at index ${index} is null/undefined`);
                    return null;
                }
                if (typeof img !== 'string') {
                    console.warn(`⚠️ Invalid image format at index ${index}:`, typeof img, img);
                    return null;
                }
                // If it's already a URL string, use it
                if (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('/uploads/')) {
                    return img;
                }
                // If it's base64 (for backward compatibility), keep it
                if (img.startsWith('data:image/')) {
                    return img;
                }
                // Otherwise, treat as URL string
                return String(img);
            }).filter(img => img !== null && img !== undefined); // Remove any null/undefined values
            
            console.log(`📸 Processing ${reviewData.images.length} image(s) for review ${reviewId}, ${processed.length} valid`);
            if (processed.length > 0) {
                console.log(`📸 First image URL: ${processed[0]}`);
            }
            return processed;
        })();

        // Prepare review: verifiedPurchase and reviewSource set by backend only
        const review = {
            id: reviewId,
            productId: reviewData.productId,
            rating: reviewData.rating,
            comment: reviewData.comment,
            reviewSource,
            verifiedPurchase,
            customerName: reviewData.customerName != null ? reviewData.customerName : '',
            customerEmail: reviewData.customerEmail,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            images: processedImages,
            ...(reviewData.customerEmail ? { customerId: reviewData.customerEmail } : {}),
            ...(reviewData.orderId ? { orderId: reviewData.orderId } : {}),
            ...(reviewData.title ? { title: reviewData.title } : {}),
            location: reviewData.location || null,
            customer: customerInfo,
            product: productInfo,
            orderInfo: orderInfo,
            helpfulVotes: 0,
            reportCount: 0,
            flagged: false,
            flaggedReason: null,
            moderationNotes: '',
            moderatedBy: null,
            moderatedAt: null,
            ipAddress: req.ip || req.connection.remoteAddress || '',
            userAgent: req.get('User-Agent') || '',
            language: req.get('Accept-Language') || 'en',
            businessResponse: null,
            media: reviewData.media || [],
            approvedAt: null,
            rejectedAt: null
        };

        // Log review data before saving (for debugging)
        console.log(`💾 Saving review ${reviewId} with ${review.images.length} image(s):`, {
            id: review.id,
            productId: review.productId,
            hasImages: !!review.images && review.images.length > 0,
            imageCount: review.images ? review.images.length : 0,
            firstImage: review.images && review.images.length > 0 ? review.images[0] : null,
            imagesField: review.images, // Full images array
            imagesFieldType: typeof review.images,
            imagesIsArray: Array.isArray(review.images)
        });
        
        // CRITICAL: Ensure images field is explicitly set (never null)
        if (review.images === null || review.images === undefined) {
            console.warn('⚠️ WARNING: images field is null/undefined, setting to empty array');
            review.images = [];
        }

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--create',
            data: review
        });
        
        // Log after save to verify
        if (result.success) {
            console.log(`✅ Review ${reviewId} saved successfully. Images count: ${review.images.length}`);
        } else {
            console.error(`❌ Failed to save review ${reviewId}:`, result);
        }

        if (result.success) {
            // Send confirmation email (don't fail review creation if email fails)
            try {
                const emailService = require('../services/emailService');
                await emailService.sendReviewConfirmationEmail(
                    review.customerEmail,
                    review.customerName,
                    {
                        customerEmail: review.customerEmail,
                        productId: review.productId,
                        productName: null, // Will be fetched in email function
                        rating: review.rating,
                        reviewSource: review.reviewSource,
                        verifiedPurchase: review.verifiedPurchase,
                        submissionDate: review.createdAt
                    }
                );
                console.log(`✅ Review confirmation email sent to ${review.customerEmail}`);
            } catch (emailError) {
                console.error('⚠️ Review confirmation email failed (but review was saved):', emailError);
                // Don't fail the request if email fails
            }
            
            res.status(201).json({
                success: true,
                message: 'Review received! Our team will verify it before publishing.',
                data: {
                    id: review.id,
                    status: 'pending',
                    productId: review.productId,
                    rating: review.rating,
                    comment: review.comment,
                    customerName: review.customerName,
                    customerEmail: review.customerEmail,
                    reviewSource: review.reviewSource,
                    verifiedPurchase: review.verifiedPurchase,
                    createdAt: review.createdAt,
                    updatedAt: review.updatedAt,
                    ...(review.location ? { location: review.location } : {}),
                    images: Array.isArray(review.images) ? review.images : []
                }
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Failed to create review',
                error: result.error || 'unknown_error',
                code: 'CREATE_FAILED'
            });
        }
    } catch (error) {
        console.error('Create review error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// PUT /api/reviews/:id - Update review
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        
        // Add updated timestamp
        updateData.updatedAt = new Date().toISOString();
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--update',
            data: {
                filter: { id: id },
                update: updateData
            }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Review updated successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Update review error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update review'
        });
    }
});

// POST /api/reviews/:id/approve - Approve review
router.post('/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { moderationNotes, moderatedBy } = req.body;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--update',
            data: {
                filter: { id: id },
                update: {
                    status: 'approved',
                    moderationNotes: moderationNotes || '',
                    moderatedBy: moderatedBy || 'admin',
                    moderatedAt: new Date().toISOString(),
                    approvedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Review approved successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Approve review error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to approve review'
        });
    }
});

// POST /api/reviews/:id/reject - Reject review
router.post('/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { moderationNotes, moderatedBy } = req.body;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--update',
            data: {
                filter: { id: id },
                update: {
                    status: 'rejected',
                    moderationNotes: moderationNotes || '',
                    moderatedBy: moderatedBy || 'admin',
                    moderatedAt: new Date().toISOString(),
                    rejectedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Review rejected successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Reject review error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reject review'
        });
    }
});

// POST /api/reviews/:id/flag - Flag review
router.post('/:id/flag', async (req, res) => {
    try {
        const { id } = req.params;
        const { flaggedReason, moderatedBy } = req.body;
        
        if (!flaggedReason) {
            return res.status(400).json({
                success: false,
                error: 'Flagged reason is required'
            });
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--update',
            data: {
                filter: { id: id },
                update: {
                    flagged: true,
                    flaggedReason: flaggedReason,
                    moderatedBy: moderatedBy || 'admin',
                    moderatedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Review flagged successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Flag review error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to flag review'
        });
    }
});

// POST /api/reviews/:id/response - Add business response
router.post('/:id/response', async (req, res) => {
    try {
        const { id } = req.params;
        const { response, respondedBy } = req.body;
        
        if (!response) {
            return res.status(400).json({
                success: false,
                error: 'Response content is required'
            });
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--update',
            data: {
                filter: { id: id },
                update: {
                    businessResponse: {
                        response: response,
                        respondedBy: respondedBy || 'admin',
                        respondedAt: new Date().toISOString()
                    },
                    updatedAt: new Date().toISOString()
                }
            }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Business response added successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Add business response error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add business response'
        });
    }
});

// PUT /api/reviews/:id/helpful - Update helpful votes
router.put('/:id/helpful', async (req, res) => {
    try {
        const { id } = req.params;
        const { helpfulVotes } = req.body;
        
        if (helpfulVotes === undefined || helpfulVotes < 0) {
            return res.status(400).json({
                success: false,
                error: 'Valid helpful votes count is required'
            });
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--update',
            data: {
                filter: { id: id },
                update: {
                    helpfulVotes: parseInt(helpfulVotes),
                    updatedAt: new Date().toISOString()
                }
            }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Helpful votes updated successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Update helpful votes error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update helpful votes'
        });
    }
});

// DELETE /api/reviews/:id - Delete review
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--delete',
            data: { id: id }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Review deleted successfully'
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Delete review error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete review'
        });
    }
});

module.exports = router;
