const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class VortexDB {
    constructor() {
        this.dbCache = new Map();
        this.collectionCache = new Map();
        this.indexCache = new Set();
        
        // Initialize connection asynchronously
        this.initializeConnection().catch(error => {
            console.warn('Warning: Database initialization error:', error.message);
        });
    }

    async initializeConnection() {
        try {
            const uri = process.env.MONGODB_URI;
            if (!uri) {
                throw new Error("MongoDB URI not configured");
            }

            this.client = new MongoClient(uri, {
                maxPoolSize: 100,
                minPoolSize: 20,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 5000,
                socketTimeoutMS: 5000,
                retryWrites: true,
                retryReads: true,
            });

            await this.verifyConnection();
            await this.setupIndexes();

        } catch (error) {
            console.error('Database initialization error:', error);
            this.client = null;
        }
    }

    async verifyConnection(maxRetries = 3, initialDelay = 1000) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await this.client.connect();
                await this.client.db().command({ ping: 1 });
                console.log('Connected to MongoDB successfully');
                return true;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    console.error('Connection verification failed:', error);
                    return false;
                }
                await new Promise(resolve => setTimeout(resolve, initialDelay * Math.pow(2, attempt)));
            }
        }
        return false;
    }

    async setupIndexes() {
        try {
            const commonIndexes = [
                { key: { isPrivate: 1 } },
                { key: { created_at: 1 } },
                { key: { id: 1 } }
            ];

            const dbNames = await this.client.db().admin().listDatabases();
            
            for (const db of dbNames.databases) {
                // Skip system databases
                if (db.name === 'admin' || db.name === 'local' || db.name === 'config') {
                    continue;
                }

                try {
                    const database = this.client.db(db.name);
                    const collections = await database.listCollections().toArray();
                    
                    for (const collection of collections) {
                        try {
                            const coll = database.collection(collection.name);
                            
                            for (const index of commonIndexes) {
                                const cacheKey = `${db.name}.${collection.name}.${Object.keys(index.key)[0]}`;
                                if (!this.indexCache.has(cacheKey)) {
                                    try {
                                        await coll.createIndex(index.key, { background: true });
                                        this.indexCache.add(cacheKey);
                                    } catch (indexError) {
                                        console.warn(`Warning: Could not create index on ${db.name}.${collection.name}: ${indexError.message}`);
                                    }
                                }
                            }
                        } catch (collError) {
                            console.warn(`Warning: Could not access collection ${collection.name}: ${collError.message}`);
                            continue;
                        }
                    }
                } catch (dbError) {
                    console.warn(`Warning: Could not access database ${db.name}: ${dbError.message}`);
                    continue;
                }
            }
        } catch (error) {
            // Log error but don't throw - indexes are helpful but not critical
            console.warn('Warning: Error setting up indexes:', error.message);
        }
    }

    async getCollection(databaseName, collectionName) {
        if (!databaseName || !collectionName) return null;

        try {
            if (!this.client) {
                await this.initializeConnection();
                if (!this.client) return null;
            }

            const cacheKey = `${databaseName}:${collectionName}`;
            
            if (!this.collectionCache.has(cacheKey)) {
                const db = this.client.db(databaseName);
                this.collectionCache.set(cacheKey, db.collection(collectionName));
            }

            return this.collectionCache.get(cacheKey);
        } catch (error) {
            console.error('Get collection error:', error);
            return null;
        }
    }

    async executeOperation(requestData) {
        try {
            const { database_name = 'VortexDB', collection_name, command, data = {} } = requestData;

            if (!collection_name) {
                return { status: false, message: 'Collection name is required' };
            }

            const collection = await this.getCollection(database_name, collection_name);
            if (!collection) {
                return { status: false, message: 'Database connection unavailable' };
            }

            const commandMap = {
                '--create': this.createRecord.bind(this),
                '--read': this.readRecords.bind(this),
                '--update': this.updateRecord.bind(this),
                '--delete': this.deleteRecord.bind(this),
                '--verify': this.verifyRecord.bind(this),
                '--append': this.appendRecord.bind(this),
                '--update-field': this.updateField.bind(this),
                '--delete-field': this.deleteField.bind(this)
            };

            const handler = commandMap[command];
            if (!handler) {
                return { status: false, message: 'Invalid command' };
            }

            // Handle isPrivate flag for create operations
            if (command === '--create') {
                if (typeof data === 'object') {
                    data.isPrivate = data.isPrivate ?? true;
                } else if (Array.isArray(data)) {
                    data.forEach(item => item.isPrivate = item.isPrivate ?? true);
                }
            }

            // Implement retry logic
            const maxRetries = 3;
            let delay = 500;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const result = await handler(collection, data);
                    return result;
                } catch (error) {
                    if (attempt === maxRetries - 1) {
                        console.error(`Operation failed after ${maxRetries} attempts:`, error);
                        return { status: false, message: 'Operation failed' };
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                }
            }
        } catch (error) {
            console.error('Execute operation error:', error);
            return { status: false, message: 'Request could not be processed' };
        }
    }

    // Create Record
    async createRecord(collection, data) {
        try {
            const result = await collection.insertOne(data);
            
            return {
                success: true,
                data: result
            };
        } catch (error) {
            console.error('Error in createRecord:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Read Record
    async readRecords(collection, data) {
        try {
            let query = data || {};
            let result;
            
            // If data is empty or undefined, return all records
            if (!data || Object.keys(data).length === 0) {
                result = await collection.find({}).toArray();
                
                // Format the results
                const formattedResults = result.map(doc => {
                    // Convert _id to string
                    doc._id = doc._id.toString();
                    
                    // Handle compressed data if present
                    if (doc.is_compressed) {
                        // Note: You'll need to implement decompression logic here
                        // similar to the Python DataCompressor.decompress_file_data
                        delete doc.compressed_data;
                    }
                    
                    return doc;
                });
                
                return {
                    status: true,
                    data: formattedResults
                };
            }
            
            // For single record queries
            result = await collection.findOne(query);
            
            if (!result) {
                return {
                    status: false,
                    error: 'Record not found'
                };
            }

            // Format the single result
            result._id = result._id.toString();
            
            // Handle compressed data if present
            if (result.is_compressed) {
                // Note: Implement decompression logic here
                delete result.compressed_data;
            }

            return {
                status: true,
                data: result
            };
            
        } catch (error) {
            console.error('Error in readRecords:', error);
            return {
                status: false,
                error: error.message
            };
        }
    }

    // Update Record
    async updateRecord(collection, data) {
        try {
            const result = await collection.updateOne({}, { $set: data });
            
            return {
                success: true,
                data: result
            };
        } catch (error) {
            console.error('Error in updateRecord:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Delete Record
    async deleteRecord(collection, query) {
        try {
            const result = await collection.deleteOne(query);
            
            return {
                success: true,
                data: result
            };
        } catch (error) {
            console.error('Error in deleteRecord:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Verify Record
    async verifyRecord(collection, query) {
        try {
            // Only check if record exists, don't return the data
            const count = await collection.countDocuments(query, { limit: 1 });
            
            return {
                success: true,
                data: {
                    acknowledged: count > 0
                }
            };
        } catch (error) {
            console.error('Error in verifyRecord:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Add new appendRecord method
    async appendRecord(collection, data) {
        try {
            if (!data.existing || !data.append) {
                throw new Error("Both 'existing' and 'append' fields are required");
            }

            // First verify the record exists
            const existingRecord = await collection.findOne(data.existing);
            if (!existingRecord) {
                return {
                    success: false,
                    error: "Record not found"
                };
            }

            // Use $set to append new data without overwriting existing fields
            const result = await collection.updateOne(
                data.existing,
                { $set: data.append }
            );
            
            return {
                success: true,
                data: result
            };
        } catch (error) {
            console.error('Error in appendRecord:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Add method to update specific field
    async updateField(collection, data) {
        try {
            if (!data.existing || !data.field || !data.value) {
                throw new Error("'existing', 'field', and 'value' are required");
            }

            // First verify the record exists
            const existingRecord = await collection.findOne(data.existing);
            if (!existingRecord) {
                return {
                    success: false,
                    error: "Record not found"
                };
            }

            // Use $set to update specific field
            const result = await collection.updateOne(
                data.existing,
                { $set: { [data.field]: data.value } }
            );
            
            return {
                success: true,
                data: result
            };
        } catch (error) {
            console.error('Error in updateField:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Add method to delete specific field
    async deleteField(collection, data) {
        try {
            if (!data.existing || !data.field) {
                throw new Error("'existing' and 'field' are required");
            }

            // First verify the record exists
            const existingRecord = await collection.findOne(data.existing);
            if (!existingRecord) {
                return {
                    success: false,
                    error: "Record not found"
                };
            }

            // Use $unset to remove the field
            const result = await collection.updateOne(
                data.existing,
                { $unset: { [data.field]: "" } }
            );
            
            return {
                success: true,
                data: result
            };
        } catch (error) {
            console.error('Error in deleteField:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = VortexDB; 