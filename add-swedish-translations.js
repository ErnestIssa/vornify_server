/**
 * Script to add Swedish translations to all products in the database
 * Run: node add-swedish-translations.js
 */

require('dotenv').config();
const getDBInstance = require('./vornifydb/dbInstance');

const db = getDBInstance();

// Simple translation mapping for common terms (can be expanded)
const commonTranslations = {
    'Lightweight': 'Lättvikt',
    'training shorts': 'träningsshorts',
    'designed for': 'designade för',
    'comfort': 'komfort',
    'mobility': 'rörelse',
    'performance': 'prestanda',
    'high-performance': 'högpresterande',
    'advanced': 'avancerad',
    'technology': 'teknologi',
    'quick drying': 'snabb torkning',
    'breathable': 'andningsbar',
    'material': 'material',
    'machine wash': 'maskintvätt',
    'cold water': 'kallt vatten',
    'tumble dry': 'torktumlare',
    'low heat': 'låg värme',
    'free shipping': 'gratis frakt',
    'orders over': 'beställningar över',
    'day return policy': 'dagar returpolicy',
    'after delivery': 'efter leverans'
};

/**
 * Simple translation function (basic word replacement)
 * In production, this should use a proper translation service
 */
function translateToSwedish(text) {
    if (!text || typeof text !== 'string') return text;
    
    let translated = text;
    
    // Replace common English phrases with Swedish
    Object.keys(commonTranslations).forEach(english => {
        const regex = new RegExp(english, 'gi');
        translated = translated.replace(regex, commonTranslations[english]);
    });
    
    // If no translation was made, add a prefix to indicate it needs translation
    if (translated === text && text.length > 10) {
        return `[SV] ${text}`; // Prefix to indicate Swedish translation needed
    }
    
    return translated;
}

/**
 * Translate array of strings
 */
function translateArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.map(item => {
        if (typeof item === 'string') {
            return translateToSwedish(item);
        }
        return item;
    });
}

/**
 * Add Swedish translations to a product
 */
function addSwedishTranslations(product) {
    const updates = {};
    
    // Translate description fields (using flat suffix format)
    if (product.description && typeof product.description === 'string') {
        if (!product.description_sv && !product.description?.sv) {
            updates['description_sv'] = translateToSwedish(product.description);
        }
    }
    
    if (product.shortDescription && typeof product.shortDescription === 'string') {
        if (!product.shortDescription_sv && !product.shortDescription?.sv) {
            updates['shortDescription_sv'] = translateToSwedish(product.shortDescription);
        }
    }
    
    // Translate materials field (can be string or array)
    if (product.materials) {
        if (Array.isArray(product.materials) && product.materials.length > 0) {
            if (!product.materials_sv && !product.materials?.sv) {
                updates['materials_sv'] = translateArray(product.materials);
            }
        } else if (typeof product.materials === 'string') {
            if (!product.materials_sv && !product.materials?.sv) {
                updates['materials_sv'] = translateToSwedish(product.materials);
            }
        }
    }
    
    if (product.features && Array.isArray(product.features) && product.features.length > 0) {
        if (!product.features_sv && !product.features?.sv) {
            updates['features_sv'] = translateArray(product.features);
        }
    }
    
    // Translate careInstructions (can be string or array)
    if (product.careInstructions) {
        if (Array.isArray(product.careInstructions) && product.careInstructions.length > 0) {
            if (!product.careInstructions_sv && !product.careInstructions?.sv) {
                updates['careInstructions_sv'] = translateArray(product.careInstructions);
            }
        } else if (typeof product.careInstructions === 'string') {
            if (!product.careInstructions_sv && !product.careInstructions?.sv) {
                updates['careInstructions_sv'] = translateToSwedish(product.careInstructions);
            }
        }
    }
    
    if (product.shippingInfo && Array.isArray(product.shippingInfo) && product.shippingInfo.length > 0) {
        if (!product.shippingInfo_sv && !product.shippingInfo?.sv) {
            updates['shippingInfo_sv'] = translateArray(product.shippingInfo);
        }
    }
    
    if (product.returnPolicy && Array.isArray(product.returnPolicy) && product.returnPolicy.length > 0) {
        if (!product.returnPolicy_sv && !product.returnPolicy?.sv) {
            updates['returnPolicy_sv'] = translateArray(product.returnPolicy);
        }
    }
    
    // Translate string fields (using flat suffix format)
    const stringFields = [
        'sizeFitDescription',
        'materialComposition',
        'sustainabilityInfo',
        'shippingCosts',
        'deliveryTime',
        'warrantyInfo'
    ];
    
    stringFields.forEach(field => {
        if (product[field] && typeof product[field] === 'string') {
            if (!product[`${field}_sv`] && !product[field]?.sv) {
                updates[`${field}_sv`] = translateToSwedish(product[field]);
            }
        }
    });
    
    // Translate array fields (using flat suffix format)
    const arrayFields = ['fitGuide', 'sizeRecommendations'];
    arrayFields.forEach(field => {
        if (product[field] && Array.isArray(product[field]) && product[field].length > 0) {
            if (!product[`${field}_sv`] && !product[field]?.sv) {
                updates[`${field}_sv`] = translateArray(product[field]);
            }
        }
    });
    
    return updates;
}

/**
 * Main function to update all products
 */
async function updateAllProducts() {
    try {
        console.log('🚀 Starting Swedish translation update...\n');
        
        // Wait for database connection
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Fetch all products
        console.log('📦 Fetching all products from database...');
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: {} // Empty query to get all products
        });
        
        if (!result.success) {
            console.error('❌ Failed to fetch products:', result.error);
            process.exit(1);
        }
        
        const products = Array.isArray(result.data) ? result.data : (result.data ? [result.data] : []);
        console.log(`✅ Found ${products.length} products\n`);
        
        if (products.length === 0) {
            console.log('⚠️ No products found in database');
            return;
        }
        
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        
        // Process each product
        for (const product of products) {
            try {
                // Try to get identifier - prefer id, fallback to _id
                let productId = product.id;
                let filter = {};
                
                if (productId) {
                    filter = { id: productId };
                } else if (product._id) {
                    productId = product._id.toString();
                    // Try both _id as ObjectId and as string
                    const { ObjectId } = require('mongodb');
                    try {
                        filter = { _id: new ObjectId(product._id) };
                    } catch (e) {
                        filter = { _id: product._id };
                    }
                } else {
                    console.log(`⚠️ Skipping product without ID`);
                    skippedCount++;
                    continue;
                }
                
                console.log(`\n📝 Processing product: ${productId}`);
                console.log(`   Name: ${product.name || 'N/A'}`);
                console.log(`   Using filter: ${JSON.stringify(filter)}`);
                
                // Get Swedish translations to add
                const updates = addSwedishTranslations(product);
                
                if (Object.keys(updates).length === 0) {
                    console.log(`   ⏭️  No translations needed (already has Swedish or no translatable fields)`);
                    skippedCount++;
                    continue;
                }
                
                console.log(`   ✏️  Adding ${Object.keys(updates).length} Swedish translation(s)...`);
                
                // Update product in database (using flat suffix format)
                // Note: VortexDB's updateRecord already wraps in $set, so just pass updates directly
                const updateResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--update',
                    data: {
                        filter: filter,
                        update: updates  // Don't wrap in $set - updateRecord does that
                    }
                });
                
                if (updateResult.success) {
                    console.log(`   ✅ Successfully updated`);
                    updatedCount++;
                    
                    // Show what was added
                    Object.keys(updates).forEach(key => {
                        const value = updates[key];
                        if (Array.isArray(value)) {
                            console.log(`      ${key}: [${value.length} items]`);
                        } else if (typeof value === 'string') {
                            const preview = value.length > 50 ? value.substring(0, 50) + '...' : value;
                            console.log(`      ${key}: "${preview}"`);
                        }
                    });
                } else {
                    console.log(`   ❌ Update failed: ${updateResult.error}`);
                    errorCount++;
                }
                
            } catch (error) {
                console.error(`   ❌ Error processing product:`, error.message);
                errorCount++;
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 Summary:');
        console.log(`   ✅ Updated: ${updatedCount} products`);
        console.log(`   ⏭️  Skipped: ${skippedCount} products`);
        console.log(`   ❌ Errors: ${errorCount} products`);
        console.log('='.repeat(60));
        console.log('\n✅ Swedish translation update complete!');
        
        // Close database connection
        if (db.client) {
            await db.client.close();
        }
        
    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run the script
updateAllProducts().catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
});

