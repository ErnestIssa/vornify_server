const express = require('express');
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

const router = express.Router();

router.post(
  '/product-image',
  uploadProductImage.single('image'),
  uploadController
);

// POST /api/uploads/review
// Upload review images/videos (single or multiple files)
router.post('/review', uploadReview.single('file'), uploadReviewController);
router.post('/review/multiple', uploadReview.array('files', 10), uploadReviewController);

// POST /api/uploads/message
// Upload message attachments (single or multiple files)
router.post('/message', uploadMessage.single('attachment'), uploadMessageController);
router.post('/message/multiple', uploadMessage.array('attachments', 10), uploadMessageController);

// POST /api/uploads/support
// Upload support ticket attachments (single or multiple files)
router.post('/support', uploadSupport.single('attachment'), uploadSupportController);
router.post('/support/multiple', uploadSupport.array('attachments', 10), uploadSupportController);

// POST /api/uploads/cleanup-products
// Admin-only endpoint to cleanup unused Cloudinary product images
// WARNING: Only deletes images that are NOT referenced in MongoDB products
router.post('/cleanup-products', cleanupUnusedProductImages);

// POST /api/uploads/cleanup-reviews
// Admin-only endpoint to cleanup unused Cloudinary review images
router.post('/cleanup-reviews', cleanupUnusedReviewImages);

// POST /api/uploads/cleanup-messages
// Admin-only endpoint to cleanup unused Cloudinary message attachments
router.post('/cleanup-messages', cleanupUnusedMessageImages);

// POST /api/uploads/cleanup-support
// Admin-only endpoint to cleanup unused Cloudinary support attachments
router.post('/cleanup-support', cleanupUnusedSupportImages);

module.exports = router;

