const { MongoClient } = require('mongodb');
require('dotenv').config();

class StorageMonitor {
    constructor() {
        this.uri = process.env.MONGODB_URI;
        this.client = new MongoClient(this.uri);
    }

    async getStorageStats(dbName) {
        try {
            await this.client.connect();
            const db = this.client.db(dbName);
            
            // Get database stats
            const dbStats = await db.command({ dbStats: 1 });
            
            // Get collection stats
            const collections = await db.listCollections().toArray();
            const collectionStats = await Promise.all(
                collections.map(async (collection) => {
                    const stats = await db.command({ 
                        collStats: collection.name,
                        scale: 1
                    });
                    return {
                        name: collection.name,
                        size: stats.size,
                        storageSize: stats.storageSize,
                        documentCount: stats.count,
                        avgDocumentSize: stats.avgObjSize || 0,
                        indexes: stats.nindexes,
                        indexSize: stats.totalIndexSize
                    };
                })
            );

            // Calculate historical growth (last 30 days)
            const storageHistory = await this.getStorageHistory(dbName);

            return {
                status: true,
                database: dbName,
                timestamp: new Date().toISOString(),
                stats: {
                    totalSize: dbStats.dataSize,
                    storageSize: dbStats.storageSize,
                    indexes: dbStats.indexes,
                    totalIndexSize: dbStats.indexSize,
                    collections: collectionStats,
                    avgDocumentSize: dbStats.avgObjSize || 0,
                    freeSpace: dbStats.freeStorageSize || 0,
                    scaleFactor: dbStats.scaleFactor || 1
                },
                history: storageHistory
            };
        } catch (error) {
            console.error('Storage stats error:', error);
            return {
                status: false,
                error: 'Failed to get storage statistics',
                details: error.message
            };
        } finally {
            await this.client.close();
        }
    }

    async getStorageHistory(dbName) {
        try {
            await this.client.connect();
            const db = this.client.db('VornifyDB');
            const storageHistory = db.collection('storage_history');

            // Get last 30 days of history
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const history = await storageHistory
                .find({
                    database: dbName,
                    timestamp: { $gte: thirtyDaysAgo }
                })
                .sort({ timestamp: 1 })
                .toArray();

            return history.map(record => ({
                timestamp: record.timestamp,
                totalSize: record.totalSize,
                documentCount: record.documentCount
            }));
        } catch (error) {
            console.error('Storage history error:', error);
            return [];
        }
    }

    async recordStorageStats(dbName) {
        try {
            await this.client.connect();
            const targetDb = this.client.db(dbName);
            const statsDb = this.client.db('VornifyDB');
            const storageHistory = statsDb.collection('storage_history');

            // Get current stats using command
            const dbStats = await targetDb.command({ dbStats: 1 });

            // Record stats
            await storageHistory.insertOne({
                database: dbName,
                timestamp: new Date(),
                totalSize: dbStats.dataSize,
                storageSize: dbStats.storageSize,
                documentCount: dbStats.objects,
                indexSize: dbStats.indexSize
            });

            return true;
        } catch (error) {
            console.error('Record storage stats error:', error);
            return false;
        } finally {
            await this.client.close();
        }
    }
}

module.exports = StorageMonitor; 