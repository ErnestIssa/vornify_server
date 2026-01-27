const { MongoClient, ObjectId } = require('mongodb');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

class VortexDB {
    constructor() {
        // Set ffmpeg paths
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);

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

            // Close existing client if it exists
            if (this.client) {
                try {
                    await this.client.close();
                } catch (closeError) {
                    // Ignore close errors
                }
            }

            this.client = new MongoClient(uri, {
                maxPoolSize: 10,  // Reduced for M0 tier (500 max connections)
                minPoolSize: 1,    // Keep at least one connection alive
                serverSelectionTimeoutMS: 30000,
                connectTimeoutMS: 30000,
                socketTimeoutMS: 45000,
                heartbeatFrequencyMS: 10000,
                maxIdleTimeMS: 0,  // Disable idle timeout - keep connections alive
                retryWrites: true,
                retryReads: true,
                writeConcern: {
                    w: 1,
                    j: true,
                    wtimeout: 60000
                }
            });

            // Add connection event handlers
            this.client.on('connectionPoolCreated', () => {
                console.log('✅ MongoDB connection pool created');
            });

            this.client.on('connectionCreated', () => {
                // Only log in development to reduce noise
                if (process.env.NODE_ENV === 'development') {
                    console.log('✅ MongoDB connection created');
                }
            });

            this.client.on('connectionClosed', () => {
                // This is normal behavior for connection pools - don't log as warning
                // Individual connections in the pool close and reopen as needed
                // Only log in development mode for debugging
                if (process.env.NODE_ENV === 'development') {
                    console.log('ℹ️ MongoDB connection closed (normal pool behavior)');
                }
            });

            this.client.on('connectionPoolClosed', () => {
                // This only happens when the entire pool is closed (e.g., server shutdown)
                console.warn('⚠️ MongoDB connection pool closed');
                this.client = null;
                this.collectionCache.clear();
            });

            await this.verifyConnection();
            await this.setupIndexes();

        } catch (error) {
            console.error('Database initialization error:', error);
            this.client = null;
            throw error; // Re-throw to allow retry
        }
    }


    async verifyConnection(maxRetries = 3, initialDelay = 1000) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Connect if not already connected (idempotent)
                try {
                    // Try ping first to see if already connected
                    await this.client.db('admin').command({ ping: 1 });
                    console.log('✅ MongoDB already connected');
                    return true;
                } catch (pingError) {
                    // If ping fails, connect
                    await this.client.connect();
                    await this.client.db('admin').command({ ping: 1 });
                    console.log('✅ Connected to MongoDB successfully');
                    return true;
                }
            } catch (error) {
                console.error(`❌ Connection attempt ${attempt + 1}/${maxRetries} failed:`, error.message);
                if (attempt === maxRetries - 1) {
                    console.error('❌ Connection verification failed after all retries');
                    // Don't throw - allow lazy connection on first operation
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

            // Create index for video chunks
            const chunksCollection = this.client.db().collection('video_chunks');
            await chunksCollection.createIndex({ videoId: 1, index: 1 });
            await chunksCollection.createIndex({ type: 1 });

        } catch (error) {
            console.error('Error setting up indexes:', error);
        }
    }

    async getCollection(databaseName, collectionName) {
        if (!databaseName || !collectionName) return null;

        try {
            // Check if client exists and is connected
            if (!this.client) {
                await this.initializeConnection();
                if (!this.client) return null;
            }

            // Check if topology is closed and reconnect if needed
            try {
                // Test connection with ping (MongoDB driver will auto-connect if needed)
                await this.client.db('admin').command({ ping: 1 });
            } catch (error) {
                const errorMessage = (error.message || error.toString() || '').toLowerCase();
                
                if (errorMessage.includes('topology is closed') || 
                    errorMessage.includes('not connected') || 
                    errorMessage.includes('connection closed') ||
                    errorMessage.includes('connection timed out') ||
                    errorMessage.includes('pool is closed')) {
                    console.warn('⚠️ Database connection closed, reconnecting...');
                    
                    // Close and clear old connection
                    try {
                        if (this.client) {
                            await this.client.close().catch(() => {});
                        }
                    } catch (closeError) {
                        // Ignore close errors
                    }
                    
                    this.client = null;
                    this.collectionCache.clear();
                    
                    // Reinitialize connection
                    await this.initializeConnection();
                    if (!this.client) return null;
                    
                    // Verify new connection
                    try {
                        await this.client.db('admin').command({ ping: 1 });
                    } catch (pingError) {
                        console.error('❌ Failed to reconnect:', pingError.message);
                        return null;
                    }
                } else {
                    console.error('❌ Unexpected connection error:', errorMessage);
                    // Try to reconnect anyway
                    try {
                        this.client = null;
                        await this.initializeConnection();
                    } catch (reconnectError) {
                        console.error('❌ Reconnection failed:', reconnectError.message);
                    }
                }
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
            const { database_name = 'VortexDB', collection_name, command } = requestData;
            let { data = {} } = requestData;

            if (!collection_name) {
                return { status: false, message: 'Collection name is required' };
            }

            const collection = await this.getCollection(database_name, collection_name);
            if (!collection) {
                console.error(`❌ Failed to get collection: ${database_name}.${collection_name}`);
                return { 
                    status: false, 
                    success: false,
                    message: 'Database connection unavailable',
                    error: 'Could not establish database connection'
                };
            }

            const commandMap = {
                '--create': this.createRecord.bind(this),
                '--read': this.readRecords.bind(this),
                '--update': this.updateRecord.bind(this),
                '--delete': this.deleteRecord.bind(this),
                '--verify': this.verifyRecord.bind(this),
                '--append': this.appendRecord.bind(this),
                '--update-field': this.updateField.bind(this),
                '--delete-field': this.deleteField.bind(this),
                '--create_video': this.createVideo.bind(this),
                '--delete_video': this.deleteVideo.bind(this),
                '--get_video': this.getVideo.bind(this)
            };

            const handler = commandMap[command];
            if (!handler) {
                return { status: false, message: 'Invalid command' };
            }

            // Handle isPrivate flag for create operations
            if (command === '--create') {
                if (typeof data === 'object' && !Array.isArray(data)) {
                    // Create a deep copy to avoid mutation
                    const dataCopy = JSON.parse(JSON.stringify(data));
                    dataCopy.isPrivate = dataCopy.isPrivate ?? true;
                    data = dataCopy;
                } else if (Array.isArray(data)) {
                    data.forEach(item => item.isPrivate = item.isPrivate ?? true);
                }
            }


            // Implement retry logic with reconnection handling
            const maxRetries = 3;
            let delay = 500;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const result = await handler(collection, data);
                    return result;
                } catch (error) {
                    // Check if error is due to closed topology
                    if (error.message && error.message.includes('Topology is closed')) {
                        console.warn(`Database connection closed, reconnecting (attempt ${attempt + 1}/${maxRetries})...`);
                        
                        // Close old client and clear cache
                        if (this.client) {
                            try {
                                await this.client.close();
                            } catch (closeError) {
                                // Ignore close errors
                            }
                        }
                        this.client = null;
                        this.collectionCache.clear();
                        
                        // Reinitialize connection
                        await this.initializeConnection();
                        
                        // Wait for reconnection
                        await new Promise(resolve => setTimeout(resolve, delay));
                        
                        // Get collection again after reconnection
                        const newCollection = await this.getCollection(database_name, collection_name);
                        if (!newCollection) {
                            console.error('Failed to reconnect to database');
                            return { status: false, message: 'Database connection unavailable', error: 'Connection failed' };
                        }
                        
                        // Retry operation with new collection if not last attempt
                        if (attempt < maxRetries - 1) {
                            try {
                                const result = await handler(newCollection, data);
                                return result;
                            } catch (retryError) {
                                console.error('Operation retry failed:', retryError);
                            }
                        }
                    }
                    
                    if (attempt === maxRetries - 1) {
                        console.error(`Operation failed after ${maxRetries} attempts:`, error);
                        return { status: false, message: 'Operation failed', error: error.message };
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                }
            }
        } catch (error) {
            console.error('❌ Execute operation error:', error);
            console.error('❌ Error details:', error.stack);
            const errorMessage = error.message || error.toString() || 'Unknown error';
            
            // If it's a connection error, try to reconnect
            if (errorMessage.toLowerCase().includes('topology is closed') || 
                errorMessage.toLowerCase().includes('not connected')) {
                console.warn('⚠️ Connection error detected in executeOperation, attempting reconnection...');
                try {
                    this.client = null;
                    this.collectionCache.clear();
                    await this.initializeConnection();
                } catch (reconnectError) {
                    console.error('❌ Reconnection failed:', reconnectError.message);
                }
            }
            
            return { 
                status: false, 
                success: false,
                message: 'Request could not be processed',
                error: errorMessage
            };
        }
    }

    // Process Inventory Data
    processInventoryData(data) {
        try {
            if (!data.inventory) {
                return data;
            }

            const inventory = data.inventory;
            
            // Validate required inventory structure
            if (!inventory.colors || !Array.isArray(inventory.colors)) {
                throw new Error('Inventory must have a colors array');
            }
            if (!inventory.sizes || !Array.isArray(inventory.sizes)) {
                throw new Error('Inventory must have a sizes array');
            }
            if (!inventory.variants || !Array.isArray(inventory.variants)) {
                throw new Error('Inventory must have a variants array');
            }

            // Create a deep copy to avoid mutation issues
            const processedData = JSON.parse(JSON.stringify(data));
            const processedInventory = processedData.inventory;

            // Process colors
            processedInventory.colors = processedInventory.colors.map((color, index) => {
                return {
                    id: color.id || `color_${Date.now()}_${index}`,
                    name: color.name || 'Unnamed Color',
                    hex: color.hex || '#000000',
                    available: color.available !== undefined ? color.available : true,
                    sortOrder: color.sortOrder !== undefined ? color.sortOrder : index
                };
            });

            // Process sizes
            processedInventory.sizes = processedInventory.sizes.map((size, index) => {
                return {
                    id: size.id || `size_${Date.now()}_${index}`,
                    name: size.name || 'Unnamed Size',
                    description: size.description || '',
                    available: size.available !== undefined ? size.available : true,
                    sortOrder: size.sortOrder !== undefined ? size.sortOrder : index
                };
            });

            // Process variants
            processedInventory.variants = processedInventory.variants.map((variant, index) => {
                // Find corresponding color and size
                const color = processedInventory.colors.find(c => c.id === variant.colorId);
                const size = processedInventory.sizes.find(s => s.id === variant.sizeId);
                
                if (!color || !size) {
                    throw new Error(`Variant ${index}: Invalid colorId or sizeId`);
                }

                // Generate SKU if not provided
                const sku = variant.sku || this.generateSKU(processedData.name, color.name, size.name);

                return {
                    id: variant.id || `variant_${color.id}_${size.id}`,
                    colorId: variant.colorId,
                    sizeId: variant.sizeId,
                    sku: sku,
                    quantity: variant.quantity || 0,
                    price: variant.price !== undefined ? variant.price : processedData.price,
                    available: variant.available !== undefined ? variant.available : true
                };
            });

            // Calculate total quantity
            processedInventory.totalQuantity = processedInventory.variants.reduce((total, variant) => {
                return total + (variant.quantity || 0);
            }, 0);

            // Set trackPerVariant flag
            processedInventory.trackPerVariant = processedInventory.trackPerVariant !== undefined ? processedInventory.trackPerVariant : true;

            // Add timestamp
            processedInventory.lastUpdated = new Date().toISOString();

            return processedData;
        } catch (error) {
            console.error('Error processing inventory data:', error);
            throw new Error(`Inventory processing failed: ${error.message}`);
        }
    }

    // Generate SKU
    generateSKU(productName, colorName, sizeName) {
        const productPrefix = productName ? productName.replace(/[^A-Z0-9]/gi, '').substring(0, 6).toUpperCase() : 'PROD';
        const colorPrefix = colorName ? colorName.replace(/[^A-Z0-9]/gi, '').substring(0, 3).toUpperCase() : 'COL';
        const sizePrefix = sizeName ? sizeName.replace(/[^A-Z0-9]/gi, '').substring(0, 2).toUpperCase() : 'SZ';
        
        return `${productPrefix}-${colorPrefix}-${sizePrefix}`;
    }

    // Create Record
    async createRecord(collection, data) {
        try {
            // Process inventory data if present
            if (data.inventory) {
                data = this.processInventoryData(data);
            }
            
            // DEBUG: Log images field if it exists (for reviews)
            if (data.id && data.id.startsWith('RV')) {
                console.log(`🔍 createRecord - Review ${data.id}:`, {
                    hasImages: 'images' in data,
                    imagesType: typeof data.images,
                    imagesValue: data.images,
                    imagesIsArray: Array.isArray(data.images),
                    imagesLength: Array.isArray(data.images) ? data.images.length : 'N/A'
                });
            }
            
            const result = await collection.insertOne(data);
            
            // Verify what was inserted
            if (data.id && data.id.startsWith('RV')) {
                console.log(`✅ createRecord - Review ${data.id} inserted. Inserted ID: ${result.insertedId}`);
            }
            
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
            
            // Check for inventory-specific queries
            if (data && data.inventoryFilter) {
                return await this.handleInventoryQuery(collection, data);
            }
            
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
                    success: true,
                    data: formattedResults
                };
            }
            
            // Determine if this is a single record query (by id/_id) or a filter query (multiple results)
            // Single record queries have 'id' or '_id' field
            const isSingleRecordQuery = query.hasOwnProperty('id') || query.hasOwnProperty('_id');
            
            if (isSingleRecordQuery) {
                // For single record queries (by id or _id)
                result = await collection.findOne(query);
                
                if (!result) {
                    return {
                        success: false,
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
                    success: true,
                    data: result
                };
            } else {
                // For filter queries (category, featured, etc.), return multiple results
                result = await collection.find(query).toArray();
                
                // Format the results
                const formattedResults = result.map(doc => {
                    // Convert _id to string
                    doc._id = doc._id.toString();
                    
                    // Handle compressed data if present
                    if (doc.is_compressed) {
                        // Note: You'll need to implement decompression logic here
                        delete doc.compressed_data;
                    }
                    
                    return doc;
                });
                
                return {
                    success: true,
                    data: formattedResults
                };
            }
            
        } catch (error) {
            console.error('Error in readRecords:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Handle Inventory Query
    async handleInventoryQuery(collection, data) {
        try {
            const { inventoryFilter } = data;
            let query = { ...data };
            delete query.inventoryFilter;

            // Build inventory-specific query - only include products that have inventory
            query['inventory'] = { $exists: true };

            if (inventoryFilter.availableOnly) {
                query['inventory.variants.available'] = true;
            }

            if (inventoryFilter.minQuantity) {
                query['inventory.variants.quantity'] = { $gte: inventoryFilter.minQuantity };
            }

            if (inventoryFilter.colorId) {
                query['inventory.variants.colorId'] = inventoryFilter.colorId;
            }

            if (inventoryFilter.sizeId) {
                query['inventory.variants.sizeId'] = inventoryFilter.sizeId;
            }

            if (inventoryFilter.sku) {
                query['inventory.variants.sku'] = inventoryFilter.sku;
            }

            // Execute query
            const result = await collection.find(query).toArray();

            // Format results
            const formattedResults = result.map(doc => {
                doc._id = doc._id.toString();
                
                // Filter variants based on inventory filter
                if (doc.inventory && doc.inventory.variants) {
                    let filteredVariants = doc.inventory.variants;

                    if (inventoryFilter.availableOnly) {
                        filteredVariants = filteredVariants.filter(v => v.available);
                    }

                    if (inventoryFilter.minQuantity) {
                        filteredVariants = filteredVariants.filter(v => v.quantity >= inventoryFilter.minQuantity);
                    }

                    if (inventoryFilter.colorId) {
                        filteredVariants = filteredVariants.filter(v => v.colorId === inventoryFilter.colorId);
                    }

                    if (inventoryFilter.sizeId) {
                        filteredVariants = filteredVariants.filter(v => v.sizeId === inventoryFilter.sizeId);
                    }

                    if (inventoryFilter.sku) {
                        filteredVariants = filteredVariants.filter(v => v.sku === inventoryFilter.sku);
                    }

                    // Update total quantity based on filtered variants
                    doc.inventory.totalQuantity = filteredVariants.reduce((total, variant) => total + variant.quantity, 0);
                    doc.inventory.variants = filteredVariants;
                }

                return doc;
            });

            return {
                success: true,
                data: formattedResults
            };
        } catch (error) {
            console.error('Error in handleInventoryQuery:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Update Record
    async updateRecord(collection, data) {
        try {
            if (!data.filter || !data.update) {
                return {
                    success: false,
                    error: 'Filter and update fields are required'
                };
            }
            
            // Process inventory data if present in update
            if (data.update.inventory) {
                data.update = this.processInventoryData(data.update);
            }
            
            const result = await collection.updateOne(data.filter, { $set: data.update });
            
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

    async createVideo(collection, data) {
        try {
            if (!data.video || !data.metadata) {
                throw new Error("Video data and metadata are required");
            }

            // Generate a unique video ID
            const videoUUID = `video_${uuidv4()}`;

            // Convert video to Buffer if it's base64
            let videoBuffer;
            try {
                if (data.video.startsWith('data:video')) {
                    const base64Data = data.video.split(',')[1];
                    videoBuffer = Buffer.from(base64Data, 'base64');
                } else {
                    videoBuffer = Buffer.from(data.video);
                }
            } catch (error) {
                throw new Error("Invalid video data format");
            }

            // Create smaller chunks
            const chunkSize = 100 * 1024; // 100KB chunks
            const chunks = [];
            
            for (let i = 0; i < videoBuffer.length; i += chunkSize) {
                chunks.push(videoBuffer.slice(i, Math.min(i + chunkSize, videoBuffer.length)));
            }

            console.log(`Splitting video into ${chunks.length} chunks...`);

            // Create video document with metadata
            const videoDoc = {
                videoId: videoUUID,
                ...data.metadata,
                size: videoBuffer.length,
                created_at: new Date().toISOString(),
                isPrivate: data.isPrivate ?? true,
                chunkCount: chunks.length,
                type: 'metadata'  // Add type field to distinguish metadata from chunks
            };

            // Create a separate collection for chunks
            const chunksCollection = collection.s.db.collection('video_chunks');

            // Insert metadata
            await collection.insertOne(videoDoc);

            // Then insert chunks in batches
            const batchSize = 50;
            for (let i = 0; i < chunks.length; i += batchSize) {
                const batch = chunks.slice(i, i + batchSize).map((chunk, index) => ({
                    videoId: videoUUID,
                    index: i + index,
                    data: chunk,  // chunk is already a Buffer
                    type: 'chunk'
                }));

                await chunksCollection.insertMany(batch, { ordered: true });
                console.log(`Uploaded chunks ${i} to ${Math.min(i + batchSize, chunks.length)}`);
            }

            return {
                success: true,
                data: {
                    id: videoUUID,
                    size: videoBuffer.length,
                    filename: data.metadata.filename
                }
            };
        } catch (error) {
            console.error('Error in createVideo:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async deleteVideo(collection, data) {
        try {
            if (!data.id) {
                throw new Error("Video ID is required");
            }

            // Delete metadata
            const metadataResult = await collection.deleteOne({ 
                videoId: data.id,
                type: 'metadata'
            });

            // Delete chunks from chunks collection
            const chunksCollection = collection.s.db.collection('video_chunks');
            const chunksResult = await chunksCollection.deleteMany({ 
                videoId: data.id,
                type: 'chunk'
            });

            return {
                success: true,
                data: {
                    metadata: metadataResult,
                    chunks: chunksResult
                }
            };
        } catch (error) {
            console.error('Error in deleteVideo:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getVideo(collection, data) {
        try {
            if (!data.id) {
                throw new Error("Video ID is required");
            }

            console.log('Fetching video with ID:', data.id);

            // Get video metadata
            const videoMetadata = await collection.findOne({ 
                videoId: data.id,
                type: 'metadata'
            });

            if (!videoMetadata) {
                console.log('Video metadata not found');
                throw new Error("Video not found");
            }

            console.log('Found video metadata:', videoMetadata.filename);

            // Get chunks from separate collection
            const chunksCollection = collection.s.db.collection('video_chunks');
            const chunks = await chunksCollection
                .find({ 
                    videoId: data.id,
                    type: 'chunk'
                })
                .sort({ index: 1 })
                .toArray();

            if (chunks.length === 0) {
                console.log('No chunks found for video');
                throw new Error("Video chunks not found");
            }

            console.log(`Found ${chunks.length} chunks`);

            // Reconstruct video buffer
            const bufferChunks = chunks.map(chunk => chunk.data.buffer);
            const videoBuffer = Buffer.concat(bufferChunks);
            
            console.log(`Reconstructed video buffer size: ${videoBuffer.length} bytes`);
            console.log(`Expected size from metadata: ${videoMetadata.size} bytes`);

            // Verify the buffer contains valid video data
            if (videoBuffer.length === 0 || videoBuffer.length !== videoMetadata.size) {
                throw new Error("Invalid video data reconstructed");
            }

            // Convert to base64 with proper MIME type
            const base64Video = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;

            return {
                success: true,
                data: {
                    video: base64Video,
                    metadata: {
                        filename: videoMetadata.filename,
                        size: videoBuffer.length,
                        created_at: videoMetadata.created_at
                    }
                }
            };
        } catch (error) {
            console.error('Error in getVideo:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Gracefully close MongoDB client/pool (used during deploy shutdown).
     * Render sends SIGTERM on deploy; if we don't close connections/timers,
     * shutdown can take too long and deployments can time out.
     */
    async close() {
        try {
            if (this.client) {
                try {
                    await this.client.close();
                } catch (closeError) {
                    // Ignore close errors
                }
            }
        } finally {
            this.client = null;
            this.collectionCache.clear();
            this.dbCache.clear();
        }
    }
}

module.exports = VortexDB;