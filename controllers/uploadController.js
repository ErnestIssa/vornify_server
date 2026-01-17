const cloudinary = require('../config/cloudinary');
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

exports.uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // CloudinaryStorage provides path (secure_url) and filename (public_id)
    const url = req.file.path;
    const public_id = req.file.filename;

    if (!url || !public_id) {
      console.error('Invalid file object from CloudinaryStorage:', {
        hasPath: !!req.file.path,
        hasFilename: !!req.file.filename,
        fileKeys: Object.keys(req.file || {})
      });
      return res.status(500).json({ 
        message: 'Invalid file data from upload',
        details: 'Missing url or public_id'
      });
    }

    return res.status(201).json({
      url: url,
      public_id: public_id,
    });
  } catch (error) {
    console.error('❌ [PRODUCT UPLOAD] Upload error:', error);
    console.error('❌ [PRODUCT UPLOAD] Error stack:', error.stack);
    console.error('❌ [PRODUCT UPLOAD] Request file:', req.file ? {
      hasPath: !!req.file.path,
      hasFilename: !!req.file.filename,
      keys: Object.keys(req.file)
    } : 'req.file is null/undefined');
    res.status(500).json({ 
      message: 'Image upload failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Upload review images/videos
 * Handles single file or multiple files
 */
exports.uploadReview = async (req, res) => {
  try {
    const files = req.files || (req.file ? [req.file] : []);

    if (files.length === 0) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const uploaded = files.map(file => ({
      url: file.path,
      public_id: file.filename,
    }));

    return res.status(201).json({
      files: uploaded,
      count: uploaded.length,
    });
  } catch (error) {
    console.error('Review upload error:', error);
    res.status(500).json({ message: 'Review upload failed' });
  }
};

/**
 * Upload message attachments
 * Handles single file or multiple files
 */
exports.uploadMessage = async (req, res) => {
  try {
    const files = req.files || (req.file ? [req.file] : []);

    if (files.length === 0) {
      return res.status(400).json({ message: 'No attachment uploaded' });
    }

    const uploaded = files.map(file => ({
      url: file.path,
      public_id: file.filename,
    }));

    return res.status(201).json({
      attachments: uploaded,
      count: uploaded.length,
    });
  } catch (error) {
    console.error('Message upload error:', error);
    res.status(500).json({ message: 'Message upload failed' });
  }
};

/**
 * Upload support ticket attachments
 * Handles single file or multiple files
 */
exports.uploadSupport = async (req, res) => {
  try {
    const files = req.files || (req.file ? [req.file] : []);

    if (files.length === 0) {
      return res.status(400).json({ message: 'No attachment uploaded' });
    }

    const uploaded = files.map(file => ({
      url: file.path,
      public_id: file.filename,
    }));

    return res.status(201).json({
      attachments: uploaded,
      count: uploaded.length,
    });
  } catch (error) {
    console.error('Support upload error:', error);
    res.status(500).json({ message: 'Support upload failed' });
  }
};

/**
 * Cleanup unused Cloudinary product images
 * Compares Cloudinary assets with MongoDB product references
 * Only deletes images that are not referenced in any product
 */
exports.cleanupUnusedProductImages = async (req, res) => {
  try {
    console.log('🧹 [CLEANUP] Starting cleanup of unused product images...');

    // Step 1: Get all imagePublicIds from MongoDB products
    const productsResult = await db.executeOperation({
      database_name: 'peakmode',
      collection_name: 'products',
      command: '--read',
      data: {}
    });

    if (!productsResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to query products from MongoDB'
      });
    }

    const products = Array.isArray(productsResult.data) 
      ? productsResult.data 
      : (productsResult.data ? [productsResult.data] : []);

    // Extract all imagePublicIds from products
    const referencedPublicIds = new Set();
    products.forEach(product => {
      if (product.imagePublicIds && Array.isArray(product.imagePublicIds)) {
        product.imagePublicIds.forEach(publicId => {
          if (publicId && typeof publicId === 'string') {
            referencedPublicIds.add(publicId);
          }
        });
      }
    });

    console.log(`📊 [CLEANUP] Found ${referencedPublicIds.size} referenced imagePublicIds in MongoDB`);

    // Step 2: List all Cloudinary resources in peakmode/products folder
    const cloudinaryResources = [];
    let nextCursor = null;

    do {
      const options = {
        resource_type: 'image',
        type: 'upload',
        prefix: 'peakmode/products/',
        max_results: 500,
      };

      if (nextCursor) {
        options.next_cursor = nextCursor;
      }

      const result = await cloudinary.api.resources(options);

      if (result.resources && Array.isArray(result.resources)) {
        result.resources.forEach(resource => {
          if (resource.public_id) {
            cloudinaryResources.push(resource.public_id);
          }
        });
      }

      nextCursor = result.next_cursor || null;
    } while (nextCursor);

    console.log(`📊 [CLEANUP] Found ${cloudinaryResources.length} images in Cloudinary peakmode/products folder`);

    // Step 3: Identify unused images (in Cloudinary but not in MongoDB)
    const unusedPublicIds = cloudinaryResources.filter(publicId => 
      !referencedPublicIds.has(publicId)
    );

    console.log(`🔍 [CLEANUP] Identified ${unusedPublicIds.length} unused images`);

    if (unusedPublicIds.length === 0) {
      return res.json({
        success: true,
        message: 'No unused images found. All Cloudinary images are referenced in MongoDB.',
        stats: {
          referencedInMongoDB: referencedPublicIds.size,
          totalInCloudinary: cloudinaryResources.length,
          unused: 0,
          deleted: 0
        }
      });
    }

    // Step 4: Delete unused images
    const deleted = [];
    const failed = [];

    for (const publicId of unusedPublicIds) {
      try {
        const result = await cloudinary.uploader.destroy(publicId);
        if (result.result === 'ok' || result.result === 'not found') {
          deleted.push(publicId);
          console.log(`✅ [CLEANUP] Deleted: ${publicId}`);
        } else {
          failed.push({ publicId, reason: result.result });
          console.error(`❌ [CLEANUP] Failed to delete ${publicId}: ${result.result}`);
        }
      } catch (error) {
        failed.push({ publicId, reason: error.message });
        console.error(`❌ [CLEANUP] Error deleting ${publicId}:`, error.message);
      }
    }

    console.log(`✅ [CLEANUP] Cleanup complete: ${deleted.length} deleted, ${failed.length} failed`);

    return res.json({
      success: true,
      message: `Cleanup complete: ${deleted.length} unused images deleted`,
      stats: {
        referencedInMongoDB: referencedPublicIds.size,
        totalInCloudinary: cloudinaryResources.length,
        unused: unusedPublicIds.length,
        deleted: deleted.length,
        failed: failed.length
      },
      deleted: deleted,
      failed: failed.length > 0 ? failed : undefined
    });

  } catch (error) {
    console.error('❌ [CLEANUP] Cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup unused images',
      error: error.message
    });
  }
};

/**
 * Helper function to extract public_id from Cloudinary URL
 * @param {string} url - Cloudinary URL
 * @returns {string|null} - public_id or null if not a Cloudinary URL
 */
function extractPublicIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  // Match Cloudinary URL pattern: https://res.cloudinary.com/[cloud_name]/[resource_type]/[type]/v[version]/[public_id]
  const match = url.match(/\/v\d+\/(.+?)(?:\.[^.]+)?$/);
  if (match && match[1]) {
    return match[1];
  }
  
  // Also check if it's already a public_id format (peakmode/...)
  if (url.startsWith('peakmode/')) {
    return url.split('.')[0]; // Remove file extension if present
  }
  
  return null;
}

/**
 * Generic cleanup function for unused Cloudinary images in a folder
 * @param {string} folder - Cloudinary folder (e.g., 'peakmode/reviews')
 * @param {string} collection - MongoDB collection name
 * @param {string} fieldPath - Path to extract public_ids from (e.g., 'images' or 'attachments')
 * @param {string} name - Display name for logging
 */
async function cleanupUnusedImages(folder, collection, fieldPath, name) {
  console.log(`🧹 [CLEANUP ${name.toUpperCase()}] Starting cleanup...`);

  // Get all documents from MongoDB collection
  const documentsResult = await db.executeOperation({
    database_name: 'peakmode',
    collection_name: collection,
    command: '--read',
    data: {}
  });

  if (!documentsResult.success) {
    throw new Error(`Failed to query ${collection} from MongoDB`);
  }

  const documents = Array.isArray(documentsResult.data) 
    ? documentsResult.data 
    : (documentsResult.data ? [documentsResult.data] : []);

  // Extract all referenced public_ids
  const referencedPublicIds = new Set();
  documents.forEach(doc => {
    const field = doc[fieldPath];
    if (field) {
      const values = Array.isArray(field) ? field : [field];
      values.forEach(value => {
        if (typeof value === 'string') {
          // Try to extract public_id from URL or use as-is if it's already a public_id
          const publicId = extractPublicIdFromUrl(value) || (value.startsWith('peakmode/') ? value : null);
          if (publicId) {
            referencedPublicIds.add(publicId);
          }
        } else if (value && value.public_id) {
          // Handle object format { url, public_id }
          referencedPublicIds.add(value.public_id);
        }
      });
    }
  });

  console.log(`📊 [CLEANUP ${name.toUpperCase()}] Found ${referencedPublicIds.size} referenced public_ids in MongoDB`);

  // List all Cloudinary resources in folder
  const cloudinaryResources = [];
  let nextCursor = null;

  do {
    const options = {
      resource_type: 'image',
      type: 'upload',
      prefix: folder + '/',
      max_results: 500,
    };

    if (nextCursor) {
      options.next_cursor = nextCursor;
    }

    const result = await cloudinary.api.resources(options);

    if (result.resources && Array.isArray(result.resources)) {
      result.resources.forEach(resource => {
        if (resource.public_id) {
          cloudinaryResources.push(resource.public_id);
        }
      });
    }

    nextCursor = result.next_cursor || null;
  } while (nextCursor);

  console.log(`📊 [CLEANUP ${name.toUpperCase()}] Found ${cloudinaryResources.length} images in Cloudinary ${folder} folder`);

  // Identify unused images
  const unusedPublicIds = cloudinaryResources.filter(publicId => 
    !referencedPublicIds.has(publicId)
  );

  console.log(`🔍 [CLEANUP ${name.toUpperCase()}] Identified ${unusedPublicIds.length} unused images`);

  // Delete unused images
  const deleted = [];
  const failed = [];

  for (const publicId of unusedPublicIds) {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      if (result.result === 'ok' || result.result === 'not found') {
        deleted.push(publicId);
        console.log(`✅ [CLEANUP ${name.toUpperCase()}] Deleted: ${publicId}`);
      } else {
        failed.push({ publicId, reason: result.result });
        console.error(`❌ [CLEANUP ${name.toUpperCase()}] Failed to delete ${publicId}: ${result.result}`);
      }
    } catch (error) {
      failed.push({ publicId, reason: error.message });
      console.error(`❌ [CLEANUP ${name.toUpperCase()}] Error deleting ${publicId}:`, error.message);
    }
  }

  console.log(`✅ [CLEANUP ${name.toUpperCase()}] Complete: ${deleted.length} deleted, ${failed.length} failed`);

  return {
    referencedInMongoDB: referencedPublicIds.size,
    totalInCloudinary: cloudinaryResources.length,
    unused: unusedPublicIds.length,
    deleted: deleted.length,
    failed: failed.length,
    deletedList: deleted,
    failedList: failed
  };
}

/**
 * Cleanup unused review images
 */
exports.cleanupUnusedReviewImages = async (req, res) => {
  try {
    const result = await cleanupUnusedImages('peakmode/reviews', 'reviews', 'images', 'reviews');

    return res.json({
      success: true,
      message: `Cleanup complete: ${result.deleted} unused review images deleted`,
      stats: result,
      deleted: result.deletedList,
      failed: result.failedList.length > 0 ? result.failedList : undefined
    });
  } catch (error) {
    console.error('❌ [CLEANUP REVIEWS] Cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup unused review images',
      error: error.message
    });
  }
};

/**
 * Cleanup unused message attachments
 */
exports.cleanupUnusedMessageImages = async (req, res) => {
  try {
    // Note: Assuming messages are stored in a 'messages' collection with 'attachments' field
    // Adjust collection name and field path based on your actual schema
    const result = await cleanupUnusedImages('peakmode/messages', 'messages', 'attachments', 'messages');

    return res.json({
      success: true,
      message: `Cleanup complete: ${result.deleted} unused message attachments deleted`,
      stats: result,
      deleted: result.deletedList,
      failed: result.failedList.length > 0 ? result.failedList : undefined
    });
  } catch (error) {
    console.error('❌ [CLEANUP MESSAGES] Cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup unused message attachments',
      error: error.message
    });
  }
};

/**
 * Cleanup unused support attachments
 */
exports.cleanupUnusedSupportImages = async (req, res) => {
  try {
    // Note: Assuming support tickets are stored in a 'support' collection with 'attachments' field
    // Adjust collection name and field path based on your actual schema
    const result = await cleanupUnusedImages('peakmode/support', 'support', 'attachments', 'support');

    return res.json({
      success: true,
      message: `Cleanup complete: ${result.deleted} unused support attachments deleted`,
      stats: result,
      deleted: result.deletedList,
      failed: result.failedList.length > 0 ? result.failedList : undefined
    });
  } catch (error) {
    console.error('❌ [CLEANUP SUPPORT] Cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup unused support attachments',
      error: error.message
    });
  }
};

