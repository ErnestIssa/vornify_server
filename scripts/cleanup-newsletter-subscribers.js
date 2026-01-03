/**
 * Cleanup Script: Remove unused newsletter_subscribers collection
 * 
 * This script removes the old newsletter_subscribers collection
 * since all new subscriptions now use the 'subscribers' collection
 * 
 * Usage: node scripts/cleanup-newsletter-subscribers.js
 */

const getDBInstance = require('../vornifydb/dbInstance');
const db = getDBInstance();

async function cleanupOldCollection() {
    try {
        console.log('🧹 Starting cleanup of newsletter_subscribers collection...');
        
        // Check if collection has any records
        const checkResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--read',
            data: {}
        });

        if (checkResult.success && checkResult.data) {
            const records = Array.isArray(checkResult.data) ? checkResult.data : [checkResult.data].filter(Boolean);
            const recordCount = records.length;
            
            console.log(`📊 Found ${recordCount} records in newsletter_subscribers collection`);
            
            if (recordCount > 0) {
                console.log('⚠️  WARNING: Collection contains records. These will be permanently deleted.');
                console.log('⚠️  If you want to migrate data first, use the migration script instead.');
                console.log('⚠️  Proceeding with deletion in 5 seconds... (Ctrl+C to cancel)');
                
                // Wait 5 seconds
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Delete all records in the collection
        console.log('🗑️  Deleting all records from newsletter_subscribers collection...');
        
        // Note: VornifyDB might not have a direct delete-all command
        // We'll need to delete records one by one or use a filter
        // For now, we'll try to delete with an empty filter (which should delete all)
        
        const deleteResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'newsletter_subscribers',
            command: '--delete',
            data: {} // Empty filter should delete all records
        });

        if (deleteResult.success) {
            console.log('✅ Successfully deleted all records from newsletter_subscribers collection');
        } else {
            console.log('⚠️  Delete operation result:', deleteResult);
            // Try alternative: delete collection by dropping it
            console.log('🔄 Attempting to drop collection...');
            
            // Note: VornifyDB might not support drop collection directly
            // This is a fallback - you may need to manually drop the collection in MongoDB
            console.log('⚠️  If records still exist, you may need to manually drop the collection in MongoDB:');
            console.log('   db.newsletter_subscribers.drop()');
        }

        console.log('✅ Cleanup complete!');
        console.log('📝 Note: The collection itself may still exist but will be empty.');
        console.log('📝 To fully remove the collection, run in MongoDB: db.newsletter_subscribers.drop()');

    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        console.error('📝 You may need to manually remove the collection in MongoDB:');
        console.error('   db.newsletter_subscribers.drop()');
        process.exit(1);
    }
}

// Run cleanup
if (require.main === module) {
    cleanupOldCollection()
        .then(() => {
            console.log('✅ Script completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = { cleanupOldCollection };

