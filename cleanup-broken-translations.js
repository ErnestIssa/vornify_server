/**
 * Cleanup Script: Remove broken translations with "[SV]" prefixes
 * 
 * This script removes all _sv fields that contain "[SV]" prefixes
 * so the translation service can fall back to English instead of showing broken translations
 */

require('dotenv').config();
const getDBInstance = require('./vornifydb/dbInstance');

const db = getDBInstance();

async function cleanupBrokenTranslations() {
    try {
        console.log('🧹 Starting cleanup of broken translations...\n');
        
        await db.initializeConnection();
        
        // Get all products
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: {}
        });
        
        if (!result.success || !result.data) {
            console.error('❌ Failed to fetch products');
            return;
        }
        
        const products = Array.isArray(result.data) ? result.data : [result.data];
        console.log(`📦 Found ${products.length} products to check\n`);
        
        let cleanedCount = 0;
        let fieldsRemoved = 0;
        
        for (const product of products) {
            const productId = product._id || product.id;
            const updates = {};
            let hasUpdates = false;
            
            // List of translatable fields
            const translatableFields = [
                'description',
                'shortDescription',
                'materials',
                'features',
                'careInstructions',
                'shippingInfo',
                'returnPolicy',
                'fitGuide',
                'sizeRecommendations',
                'sizeFitDescription',
                'materialComposition',
                'sustainabilityInfo',
                'shippingCosts',
                'deliveryTime',
                'warrantyInfo'
            ];
            
            // Check each field for broken translations
            for (const field of translatableFields) {
                const svField = `${field}_sv`;
                const svValue = product[svField];
                
                if (svValue !== undefined && svValue !== null) {
                    let shouldRemove = false;
                    
                    // Check if it's a string with "[SV]" prefix
                    if (typeof svValue === 'string' && svValue.includes('[SV]')) {
                        shouldRemove = true;
                    }
                    
                    // Check if it's an array with "[SV]" in any item
                    if (Array.isArray(svValue)) {
                        const hasBrokenItem = svValue.some(item => 
                            typeof item === 'string' && item.includes('[SV]')
                        );
                        if (hasBrokenItem) {
                            shouldRemove = true;
                        }
                    }
                    
                    if (shouldRemove) {
                        updates[svField] = null; // Set to null to remove
                        hasUpdates = true;
                        fieldsRemoved++;
                        console.log(`  ❌ Removing broken translation: ${svField} from product ${productId}`);
                    }
                }
            }
            
            // Update product if we found broken translations
            if (hasUpdates) {
                // Build $unset object (MongoDB requires empty string values for $unset)
                const unsetFields = {};
                Object.keys(updates).forEach(key => {
                    unsetFields[key] = '';
                });
                
                const updateResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--update',
                    data: {
                        filter: { _id: product._id || { id: product.id } },
                        update: { $unset: unsetFields }
                    }
                });
                
                if (updateResult.success) {
                    cleanedCount++;
                    console.log(`  ✅ Cleaned product ${productId}\n`);
                } else {
                    console.error(`  ❌ Failed to update product ${productId}:`, updateResult.error);
                }
            }
        }
        
        console.log('\n✅ Cleanup complete!');
        console.log(`   - Products cleaned: ${cleanedCount}`);
        console.log(`   - Broken fields removed: ${fieldsRemoved}`);
        console.log('\n📝 Note: Products without _sv fields will now show English content');
        console.log('   (which is better than broken translations with "[SV]" prefixes)');
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        process.exit(0);
    }
}

// Run cleanup
cleanupBrokenTranslations();

