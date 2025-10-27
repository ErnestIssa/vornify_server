const express = require('express');
const router = express.Router();
const VortexDB = require('../vornifydb/vornifydb');

const db = new VortexDB();

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

// Helper function to verify purchase
async function verifyPurchase(customerId, productId) {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { 
                'customer.email': customerId,
                'items.productId': productId,
                'status': { $in: ['delivered', 'completed'] }
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

// GET /api/reviews - Get all reviews with filtering
router.get('/', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 50, 
            status, 
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
        
        let query = {};
        
        // Add filters
        if (status) query.status = status;
        if (source) query.reviewSource = source;
        if (rating) query.rating = parseInt(rating);
        if (verified !== undefined) query.verifiedPurchase = verified === 'true';
        if (flagged !== undefined) query.flagged = flagged === 'true';
        
        // Date range filtering
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }
        
        // Search functionality
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { comment: { $regex: search, $options: 'i' } },
                { 'product.name': { $regex: search, $options: 'i' } },
                { 'customer.name': { $regex: search, $options: 'i' } }
            ];
        }

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

            res.json({
                success: true,
                data: paginatedReviews,
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
            res.json({
                success: true,
                data: result.data
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
router.post('/', async (req, res) => {
    try {
        const reviewData = req.body;
        
        // Helper function to validate email format
        const isValidEmail = (email) => {
            return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        };
        
        // Validate required fields (customerId is now optional)
        const requiredFields = ['productId', 'rating', 'comment', 'reviewSource', 'verifiedPurchase', 'customerName', 'customerEmail', 'createdAt', 'updatedAt'];
        const missingFields = requiredFields.filter(field => !reviewData[field]);
        
        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missingFields.join(', ')}`,
                error: 'validation_error'
            });
        }

        // Validate rating
        if (reviewData.rating < 1 || reviewData.rating > 5) {
            return res.status(400).json({
                success: false,
                message: 'Rating must be between 1 and 5',
                error: 'invalid_rating'
            });
        }

        // Validate email format
        if (!isValidEmail(reviewData.customerEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format',
                error: 'invalid_email'
            });
        }

        // Validate reviewSource
        const validSources = ['product_page', 'email_request', 'post_purchase', 'manual', 'imported'];
        if (!validSources.includes(reviewData.reviewSource)) {
            return res.status(400).json({
                success: false,
                message: `Invalid reviewSource. Must be one of: ${validSources.join(', ')}`,
                error: 'invalid_review_source'
            });
        }

        // Generate unique review ID
        const reviewId = await generateUniqueReviewId();
        
        // Get customer info (optional - only if customerId is provided and not undefined)
        let customerInfo = null;
        if (reviewData.customerId && reviewData.customerId !== 'undefined' && reviewData.customerId !== 'null') {
            customerInfo = await getCustomerInfo(reviewData.customerId);
        }
        
        // Get product info (handle 'general' productId)
        let productInfo = null;
        if (reviewData.productId !== 'general') {
            productInfo = await getProductInfo(reviewData.productId);
        }
        
        // Verify purchase if needed (only if customerId is provided)
        let orderInfo = null;
        if (reviewData.customerId && reviewData.customerId !== 'undefined' && reviewData.customerId !== 'null') {
            if (reviewData.reviewSource === 'post_purchase' || reviewData.verifiedPurchase) {
                orderInfo = await verifyPurchase(reviewData.customerId, reviewData.productId);
            }
        }

        // Prepare review data with proper handling of optional fields
        const review = {
            id: reviewId,
            productId: reviewData.productId,
            rating: reviewData.rating,
            comment: reviewData.comment,
            reviewSource: reviewData.reviewSource,
            verifiedPurchase: reviewData.verifiedPurchase || false,
            customerName: reviewData.customerName,
            customerEmail: reviewData.customerEmail,
            status: 'pending', // Always default to pending for moderation
            createdAt: reviewData.createdAt,
            updatedAt: reviewData.updatedAt,
            
            // Optional fields (only include if provided and not undefined/null)
            ...(reviewData.customerId && reviewData.customerId !== 'undefined' && reviewData.customerId !== 'null' ? { customerId: reviewData.customerId } : {}),
            ...(reviewData.orderId ? { orderId: reviewData.orderId } : {}),
            ...(reviewData.title ? { title: reviewData.title } : {}),
            ...(reviewData.images && Array.isArray(reviewData.images) ? { images: reviewData.images } : {}),
            
            // Metadata fields
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

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--create',
            data: review
        });

        if (result.success) {
            res.json({
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
                    updatedAt: review.updatedAt
                }
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Failed to create review',
                error: result.error || 'unknown_error'
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
