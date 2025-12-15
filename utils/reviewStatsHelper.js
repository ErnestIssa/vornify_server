/**
 * Review Statistics Helper
 * Aggregates review data for products (ratings, review counts)
 * Backend-only utility, no visible changes
 */

const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

/**
 * Get review statistics for a single product
 * @param {string} productId - Product ID
 * @returns {Promise<object>} - Review statistics { averageRating, count }
 */
async function getProductReviewStats(productId) {
    try {
        if (!productId) {
            return { averageRating: null, count: 0 };
        }
        
        // Get all approved reviews for this product
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--read',
            data: {
                productId: productId,
                status: 'approved'
            }
        });
        
        if (!result.success) {
            return { averageRating: null, count: 0 };
        }
        
        const reviews = result.data || [];
        const reviewArray = Array.isArray(reviews) ? reviews : (reviews ? [reviews] : []);
        
        if (reviewArray.length === 0) {
            return { averageRating: null, count: 0 };
        }
        
        // Calculate average rating
        const totalRating = reviewArray.reduce((sum, review) => sum + (review.rating || 0), 0);
        const averageRating = totalRating / reviewArray.length;
        
        return {
            averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
            count: reviewArray.length
        };
    } catch (error) {
        console.error('Error getting product review stats:', error);
        return { averageRating: null, count: 0 };
    }
}

/**
 * Get review statistics for multiple products
 * @param {Array<string>} productIds - Array of product IDs
 * @returns {Promise<object>} - Object mapping productId to review stats
 */
async function getMultipleProductReviewStats(productIds) {
    try {
        if (!productIds || productIds.length === 0) {
            return {};
        }
        
        // Get all approved reviews for these products
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'reviews',
            command: '--read',
            data: {
                status: 'approved'
            }
        });
        
        if (!result.success) {
            return {};
        }
        
        const reviews = result.data || [];
        const reviewArray = Array.isArray(reviews) ? reviews : (reviews ? [reviews] : []);
        
        // Filter reviews for requested products and group by productId
        const statsByProduct = {};
        
        productIds.forEach(productId => {
            statsByProduct[productId] = {
                averageRating: null,
                count: 0,
                ratings: []
            };
        });
        
        reviewArray.forEach(review => {
            const productId = review.productId;
            if (productId && statsByProduct[productId]) {
                statsByProduct[productId].ratings.push(review.rating || 0);
            }
        });
        
        // Calculate averages for each product
        Object.keys(statsByProduct).forEach(productId => {
            const ratings = statsByProduct[productId].ratings;
            if (ratings.length > 0) {
                const totalRating = ratings.reduce((sum, rating) => sum + rating, 0);
                statsByProduct[productId].averageRating = Math.round((totalRating / ratings.length) * 10) / 10;
                statsByProduct[productId].count = ratings.length;
            }
            delete statsByProduct[productId].ratings; // Remove temporary array
        });
        
        return statsByProduct;
    } catch (error) {
        console.error('Error getting multiple product review stats:', error);
        return {};
    }
}

module.exports = {
    getProductReviewStats,
    getMultipleProductReviewStats
};

