/**
 * Strip "[SV]" Prefixes from Database
 * 
 * This script removes "[SV]" prefixes from all Swedish translation fields in the database
 * It cleans the content instead of removing fields (so translations remain, just cleaned)
 */

require('dotenv').config();
const getDBInstance = require('./vornifydb/dbInstance');

const db = getDBInstance();

function stripSVPrefix(value) {
    if (typeof value === 'string') {
        return value.replace(/^\[SV\]\s*/g, '').trim();
    }
    if (Array.isArray(value)) {
        return value.map(item => {
            if (typeof item === 'string') {
                return item.replace(/^\[SV\]\s*/g, '').trim();
            }
            if (typeof item === 'object' && item !== null) {
                const cleaned = { ...item };
                if (cleaned.text && typeof cleaned.text === 'string') {
                    cleaned.text = cleaned.text.replace(/^\[SV\]\s*/g, '').trim();
                }
                if (cleaned.name && typeof cleaned.name === 'string') {
                    cleaned.name = cleaned.name.replace(/^\[SV\]\s*/g, '').trim();
                }
                return cleaned;
            }
            return item;
        });
    }
    return value;
}

function hasSVPrefix(value) {
    if (typeof value === 'string') {
        return value.includes('[SV]');
    }
    if (Array.isArray(value)) {
        return value.some(item => {
            if (typeof item === 'string') {
                return item.includes('[SV]');
            }
            if (typeof item === 'object' && item !== null) {
                return (item.text && item.text.includes('[SV]')) || 
                       (item.name && item.name.includes('[SV]'));
            }
            return false;
        });
    }
    return false;
}

async function stripSVPrefixesFromDatabase() {
    try {
        console.log('🧹 Starting cleanup of "[SV]" prefixes from translations...\n');
        
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
        let fieldsCleaned = 0;
        
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
            
            // Check each field for "[SV]" prefixes
            for (const field of translatableFields) {
                const svField = `${field}_sv`;
                const svValue = product[svField];
                
                if (svValue !== undefined && svValue !== null && hasSVPrefix(svValue)) {
                    const cleaned = stripSVPrefix(svValue);
                    updates[svField] = cleaned;
                    hasUpdates = true;
                    fieldsCleaned++;
                    console.log(`  🧹 Cleaning ${svField} from product ${productId}`);
                    console.log(`     Before: ${JSON.stringify(svValue).substring(0, 100)}...`);
                    console.log(`     After:  ${JSON.stringify(cleaned).substring(0, 100)}...`);
                }
            }
            
            // Update product if we found "[SV]" prefixes
            if (hasUpdates) {
                const updateResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--update',
                    data: {
                        filter: { _id: product._id || { id: product.id } },
                        update: { $set: updates }
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
        console.log(`   - Fields cleaned: ${fieldsCleaned}`);
        console.log('\n📝 Note: "[SV]" prefixes have been removed from all translations');
        console.log('   Translations remain in database, just cleaned of prefixes');
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        process.exit(0);
    }
}

// Run cleanup
stripSVPrefixesFromDatabase();

