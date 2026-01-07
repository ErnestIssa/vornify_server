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
        
        const products = result.data || [];
        let resetCount = 0;
        let errorCount = 0;
        
        // Reset viewsLast7Days for each product that has views
        for (const product of products) {
            if (product.viewsLast7Days && product.viewsLast7Days > 0) {
                try {
                    const updateResult = await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'products',
                        command: '--update',
                        data: {
                            filter: { id: product.id },
                            update: {
                                viewsLast7Days: 0
                            }
                        }
                    });
                    
                    if (updateResult.success) {
                        resetCount++;
                        console.log(`✅ [Weekly Views Reset] Reset product ${product.id} (had ${product.viewsLast7Days} views)`);
                    } else {
                        errorCount++;
                        console.error(`❌ [Weekly Views Reset] Failed to reset product ${product.id}`);
                    }
                } catch (error) {
                    errorCount++;
                    console.error(`❌ [Weekly Views Reset] Error resetting product ${product.id}:`, error);
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

