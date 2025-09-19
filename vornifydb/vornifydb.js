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

            this.client = new MongoClient(uri, {
                maxPoolSize: 100,
                minPoolSize: 20,
                serverSelectionTimeoutMS: 30000,
                connectTimeoutMS: 30000,
                socketTimeoutMS: 360000,
                maxIdleTimeMS: 360000,
                retryWrites: true,
                retryReads: true,
                writeConcern: {
                    w: 1,
                    j: true,
                    wtimeout: 60000
                }
            });

            await this.verifyConnection();
            await this.setupIndexes();

        } catch (error) {
            console.error('Database initialization error:', error);
            this.client = null;
        }
    }

    // Utility function to convert string _id to ObjectId
    convertObjectId(query) {
        try {
            if (!query || typeof query !== 'object') {
                return query;
            }
            
            // Create a new object to avoid modifying the original
            const convertedQuery = Object.assign({}, query);
            
            // Handle direct _id field
            if (convertedQuery._id && typeof convertedQuery._id === 'string') {
                try {
                    convertedQuery._id = new ObjectId(convertedQuery._id);
                } catch (error) {
                    console.warn('Invalid ObjectId string:', convertedQuery._id, error.message);
                }
            }
            
            // Handle nested _id fields (e.g., in filter objects)
            if (convertedQuery.filter && convertedQuery.filter._id && typeof convertedQuery.filter._id === 'string') {
                convertedQuery.filter = Object.assign({}, convertedQuery.filter);
                try {
                    convertedQuery.filter._id = new ObjectId(convertedQuery.filter._id);
                } catch (error) {
                    console.warn('Invalid ObjectId string in filter:', convertedQuery.filter._id, error.message);
                }
            }
            
            // Handle existing field in update operations
            if (convertedQuery.existing && convertedQuery.existing._id && typeof convertedQuery.existing._id === 'string') {
                convertedQuery.existing = Object.assign({}, convertedQuery.existing);
                try {
                    convertedQuery.existing._id = new ObjectId(convertedQuery.existing._id);
                } catch (error) {
                    console.warn('Invalid ObjectId string in existing:', convertedQuery.existing._id, error.message);
                }
            }
            
            return convertedQuery;
        } catch (error) {
            console.error('Error in convertObjectId:', error);
            return query; // Return original query if conversion fails
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
                if (typeof data === 'object') {
                    data.isPrivate = data.isPrivate ?? true;
                } else if (Array.isArray(data)) {
                    data.forEach(item => item.isPrivate = item.isPrivate ?? true);
                }
            }

            // Convert string _id to ObjectId for query operations (except read for now)
            if (['--update', '--delete', '--verify', '--update-field', '--delete-field'].includes(command)) {
                data = this.convertObjectId(data);
            }
            
            // For read operations, only convert if there's actually an _id field
            if (command === '--read' && data && data._id) {
                data = this.convertObjectId(data);
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
            console.error('Error details:', error.stack);
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
                    success: true,
                    data: formattedResults
                };
            }
            
            // For single record queries
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
            
        } catch (error) {
            console.error('Error in readRecords:', error);
            return {
                success: false,
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
}

module.exports = VortexDB; 