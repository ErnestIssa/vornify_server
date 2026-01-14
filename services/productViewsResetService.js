const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

/**
 * Reset viewsLast7Days counter for all products
 * This should run weekly (e.g., every Monday at 00:00)
 * @returns {Promise<object>} Result object with success flag and details
 */
async function resetWeeklyViews() {
    try {
        console.log('📊 [Weekly Views Reset] Starting weekly views reset...');
        
        // Get all products
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: {}
        });
        
        if (!result.success) {
            console.error('❌ [Weekly Views Reset] Failed to read products');
            return {
                success: false,
                error: 'Failed to read products from database'
            };
        }
        
        let products = result.data || [];
        
        // Handle case where result.data might be a single object instead of array
        if (!Array.isArray(products)) {
            products = [products];
        }
        
        let resetCount = 0;
        let errorCount = 0;
        
        // Reset viewsLast7Days for each product that has views
        for (const product of products) {
            if (product.viewsLast7Days && product.viewsLast7Days > 0) {
                try {
                    // Build filter - use id or _id
                    let filter = {};
                    if (product.id) {
                        filter = { id: product.id };
                    } else if (product._id) {
                        const { ObjectId } = require('mongodb');
                        try {
                            filter = { _id: new ObjectId(product._id) };
                        } catch (e) {
                            filter = { _id: product._id };
                        }
                    } else {
                        console.warn(`⚠️ [Weekly Views Reset] Product missing both id and _id, skipping`);
                        errorCount++;
                        continue;
                    }
                    
                    const updateResult = await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'products',
                        command: '--update',
                        data: {
                            filter: filter,
                            update: {
                                viewsLast7Days: 0
                            }
                        }
                    });
                    
                    if (updateResult.success) {
                        resetCount++;
                        const productId = product.id || product._id;
                        console.log(`✅ [Weekly Views Reset] Reset product ${productId} (had ${product.viewsLast7Days} views)`);
                    } else {
                        errorCount++;
                        const productId = product.id || product._id;
                        console.error(`❌ [Weekly Views Reset] Failed to reset product ${productId}`);
                    }
                } catch (error) {
                    errorCount++;
                    const productId = product.id || product._id;
                    console.error(`❌ [Weekly Views Reset] Error resetting product ${productId}:`, error);
                }
            }
        }
        
        const summary = {
            success: true,
            timestamp: new Date().toISOString(),
            productsChecked: products.length,
            productsReset: resetCount,
            errors: errorCount
        };
        
        console.log(`📊 [Weekly Views Reset] Completed:`, summary);
        
        return summary;
    } catch (error) {
        console.error('❌ [Weekly Views Reset] Critical error:', error);
        return {
            success: false,
            error: 'Critical error during weekly views reset',
            details: error.message
        };
    }
}

module.exports = {
    resetWeeklyViews
};

