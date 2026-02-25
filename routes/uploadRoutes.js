const express = require('express');
const multer = require('multer');
const { uploadProductImage, uploadReview, uploadMessage, uploadSupport } = require('../middleware/uploadProductImage');
const { 
  uploadProductImage: uploadController,
  uploadReview: uploadReviewController,
  uploadMessage: uploadMessageController,
  uploadSupport: uploadSupportController,
  cleanupUnusedProductImages,
  cleanupUnusedReviewImages,
  cleanupUnusedMessageImages,
  cleanupUnusedSupportImages
} = require('../controllers/uploadController');
const authenticateAdmin = require('../middleware/authenticateAdmin');

const router = express.Router();

/** Return true if Cloudinary env is set and non-empty */
function isCloudinaryConfigured() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

/** Middleware: return 503 if Cloudinary is not configured (for upload routes that need it) */
function requireCloudinaryConfig(req, res, next) {
  if (isCloudinaryConfigured()) return next();
  console.warn('[UPLOAD] Cloudinary not configured: missing CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET');
  return res.status(503).json({
    success: false,
    message: 'Upload service is not configured. Please try again later.',
    error: 'Upload service unavailable',
    errorCode: 'SERVICE_UNAVAILABLE',
    status: 503,
    files: [],
    count: 0,
  });
}

/** Log review upload request after multer (only runs when multer succeeded). Expects field "files" for multiple. */
function logReviewUploadAfterMulter(req, res, next) {
  console.log('[REVIEW UPLOAD] After multer:', {
    path: req.path,
    hasFiles: !!req.files,
    filesLength: req.files ? (Array.isArray(req.files) ? req.files.length : 'not-array') : 0,
    hasFile: !!req.file,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    body: req.body ? JSON.stringify(req.body) : '{}',
  });
  if (req.files && Array.isArray(req.files) && req.files.length > 0) {
    console.log('[REVIEW UPLOAD] First file keys:', Object.keys(req.files[0] || {}));
  }
  next();
}

/** Log when request first hits review upload (before multer). */
function logReviewUploadIncoming(req, res, next) {
  console.log('[REVIEW UPLOAD] Incoming request:', {
    path: req.path,
    method: req.method,
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    cloudinaryConfigured: isCloudinaryConfigured(),
  });
  next();
}

// Multer error handler middleware
const handleMulterError = (err, req, res, next) => {
  // Determine if this is a support route
  const isSupportRoute = req.path.includes('/support');
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        message: 'File too large',
        files: [],
        attachments: isSupportRoute ? [] : undefined, // Include both for support routes
        count: 0
      });
    }
    console.error('Multer error:', err);
    const response = { 
      message: `Upload error: ${err.message}`,
      files: [],
      count: 0
    };
    if (isSupportRoute) {
      response.attachments = [];
    }
    return res.status(400).json(response);
  }
  if (err) {
    // Full error logging for debugging 500 on review upload
    console.error('❌ [UPLOAD] Middleware error (exact error):', err);
    console.error('❌ [UPLOAD] Error message:', err && err.message);
    console.error('❌ [UPLOAD] Error name:', err && err.name);
    console.error('❌ [UPLOAD] Error code:', err && err.code);
    console.error('❌ [UPLOAD] Full stack trace:', err && err.stack);
    console.error('❌ [UPLOAD] Request path:', req && req.path);
    console.error('❌ [UPLOAD] Request method:', req && req.method);
    console.error('❌ [UPLOAD] Content-Type:', req && req.get('Content-Type'));
    // Cloudinary / multer context
    if (req && req.body) {
      console.error('❌ [UPLOAD] req.body (parsed by multer):', JSON.stringify(req.body));
    }
    if (req && (req.files || req.file)) {
      console.error('❌ [UPLOAD] req.files:', req.files);
      console.error('❌ [UPLOAD] req.file:', req.file);
    }
    // Check if this is a review route: backend expects field "files" for /review/multiple, "file" for /review
    const isReviewRoute = req && (req.path || '').includes('/review');
    if (isReviewRoute) {
      console.error('❌ [REVIEW UPLOAD] Backend uses: upload.array("files", 10) for /review/multiple, .single("file") for /review. Frontend must send FormData field "files" (multiple) or "file" (single).');
      console.error('❌ [REVIEW UPLOAD] Cloudinary configured:', !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
      ));
    }
    // Check if it's a Cloudinary format error
    if (err.message && err.message.includes('format') && err.message.includes('not allowed')) {
      const response = { 
        message: err.message,
        files: [],
        count: 0
      };
      if (isSupportRoute) {
        response.attachments = [];
      }
      return res.status(400).json(response);
    }
    const response = { 
      success: false,
      message: 'Upload failed',
      files: [],
      count: 0,
      error: err.message,
      errorCode: 'INTERNAL_SERVER_ERROR',
      status: 500
    };
    if (isSupportRoute) {
      response.attachments = [];
    }
    // Include stack in response for debugging (server logs have it too)
    if (process.env.NODE_ENV === 'development' && err && err.stack) {
      response.stack = err.stack;
      response.errorName = err.name;
      response.errorCodeDetail = err.code;
    }
    return res.status(500).json(response);
  }
  next();
};

// Product image upload - ADMIN ONLY
router.post(
  '/product-image',
  authenticateAdmin,
  uploadProductImage.single('image'),
  handleMulterError,
  uploadController
);

// POST /api/uploads/review
// --- Review upload checklist ---
// 1. Multer field: .array('files', 10) for /review/multiple, .single('file') for /review
// 2. We use upload.array('files', 10) for multiple and .single('file') for single
// 3. Frontend must send FormData with key "files" (multiple) or "file" (single)
// 4. File size limit: 20MB (uploadProductImage.js uploadReview limits)
// 5. allowed_formats in cloudinaryStorage: jpg, jpeg, png, webp, mp4, mov, webm
// 6. If req.files undefined: logReviewUploadAfterMulter + controller log req.files/req.file
// 7. Cloudinary: requireCloudinaryConfig returns 503 if env missing; errors logged in handleMulterError
router.post('/review', logReviewUploadIncoming, requireCloudinaryConfig, uploadReview.single('file'), logReviewUploadAfterMulter, handleMulterError, uploadReviewController);
router.post('/review/multiple', logReviewUploadIncoming, requireCloudinaryConfig, uploadReview.array('files', 10), logReviewUploadAfterMulter, handleMulterError, uploadReviewController);

// POST /api/uploads/message
// Upload message attachments (single or multiple files)
router.post('/message', uploadMessage.single('attachment'), uploadMessageController);
router.post('/message/multiple', uploadMessage.array('attachments', 10), uploadMessageController);

// POST /api/uploads/support
// Upload support ticket attachments (single or multiple files)
router.post('/support', uploadSupport.single('attachment'), handleMulterError, uploadSupportController);
router.post('/support/multiple', uploadSupport.array('attachments', 10), handleMulterError, uploadSupportController);

// POST /api/uploads/cleanup-products
// Admin-only endpoint to cleanup unused Cloudinary product images
// WARNING: Only deletes images that are NOT referenced in MongoDB products
router.post('/cleanup-products', authenticateAdmin, cleanupUnusedProductImages);

// POST /api/uploads/cleanup-reviews
// Admin-only endpoint to cleanup unused Cloudinary review images
router.post('/cleanup-reviews', authenticateAdmin, cleanupUnusedReviewImages);

// POST /api/uploads/cleanup-messages
// Admin-only endpoint to cleanup unused Cloudinary message attachments
router.post('/cleanup-messages', authenticateAdmin, cleanupUnusedMessageImages);

// POST /api/uploads/cleanup-support
// Admin-only endpoint to cleanup unused Cloudinary support attachments
router.post('/cleanup-support', authenticateAdmin, cleanupUnusedSupportImages);

module.exports = router;

