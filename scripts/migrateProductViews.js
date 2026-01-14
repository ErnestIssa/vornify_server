/**
 * Migration Script: Add view tracking fields to existing products
 * 
 * This script adds the following fields to all products in the database:
 * - views (Number, default: 0) - Total lifetime views
 * - viewsLast7Days (Number, default: 0) - Views in the last 7 days
 * - lastViewedAt (Date, default: null) - Timestamp of last view
 * 
 * Usage:
 *   node scripts/migrateProductViews.js
 * 
 * This script is safe to run multiple times - it only adds fields if they don't exist.
 */

const getDBInstance = require('../vornifydb/dbInstance');
require('dotenv').config();

const db = getDBInstance();

async function migrateProductViews() {
    console.log('🚀 [MIGRATION] Starting product views migration...');
    console.log('📋 [MIGRATION] Adding fields: views, viewsLast7Days, lastViewedAt');
    
    try {
        // Get all products
        console.log('🔍 [MIGRATION] Fetching all products...');
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: {}
        });
        
        if (!result.success) {
            throw new Error('Failed to read products from database');
        }
        
        let products = result.data || [];
        
        // Handle case where result.data might be a single object instead of array
        if (!Array.isArray(products)) {
            products = [products];
        }
        
        console.log(`📊 [MIGRATION] Found ${products.length} products to migrate`);
        
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        
        // Process each product
        for (const product of products) {
            try {
                // Check if product already has all required fields
                const hasViews = typeof product.views === 'number';
                const hasViewsLast7Days = typeof product.viewsLast7Days === 'number';
                const hasLastViewedAt = product.lastViewedAt !== undefined;
                
                if (hasViews && hasViewsLast7Days && hasLastViewedAt) {
                    skippedCount++;
                    continue; // Skip products that already have all fields
                }
                
                // Build update object - only add missing fields
                const updateFields = {};
                
                if (!hasViews) {
                    updateFields.views = 0;
                }
                
                if (!hasViewsLast7Days) {
                    updateFields.viewsLast7Days = 0;
                }
                
                if (!hasLastViewedAt) {
                    updateFields.lastViewedAt = null;
                }
                
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
                    console.warn(`⚠️ [MIGRATION] Product missing both id and _id, skipping:`, product);
                    skippedCount++;
                    continue;
                }
                
                // Update product
                const updateResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--update',
                    data: {
                        filter: filter,
                        update: updateFields
                    }
                });
                
                if (updateResult.success) {
                    updatedCount++;
                    const productId = product.id || product._id;
                    console.log(`✅ [MIGRATION] Updated product ${productId} - Added: ${Object.keys(updateFields).join(', ')}`);
                } else {
                    errorCount++;
                    const productId = product.id || product._id;
                    console.error(`❌ [MIGRATION] Failed to update product ${productId}:`, updateResult.error);
                }
                
            } catch (error) {
                errorCount++;
                const productId = product.id || product._id || 'unknown';
                console.error(`❌ [MIGRATION] Error processing product ${productId}:`, error.message);
            }
        }
        
        // Summary
        console.log('\n📊 [MIGRATION] Migration Summary:');
        console.log(`   ✅ Updated: ${updatedCount} products`);
        console.log(`   ⏭️  Skipped: ${skippedCount} products (already have fields)`);
        console.log(`   ❌ Errors: ${errorCount} products`);
        console.log(`   📦 Total: ${products.length} products`);
        
        if (errorCount === 0) {
            console.log('\n✅ [MIGRATION] Migration completed successfully!');
        } else {
            console.log(`\n⚠️ [MIGRATION] Migration completed with ${errorCount} error(s).`);
        }
        
        return {
            success: true,
            updated: updatedCount,
            skipped: skippedCount,
            errors: errorCount,
            total: products.length
        };
        
    } catch (error) {
        console.error('❌ [MIGRATION] Critical error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Run migration if called directly
if (require.main === module) {
    migrateProductViews()
        .then(result => {
            if (result.success) {
                process.exit(0);
            } else {
                console.error('❌ Migration failed:', result.error);
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('❌ Migration error:', error);
            process.exit(1);
        });
}

module.exports = { migrateProductViews };

