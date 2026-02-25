const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

/**
 * Sanitize a string for use as Cloudinary public_id (lowercase, hyphens, no spaces/special chars).
 * e.g. "Shorts Performance Black" -> "shorts-performance-black"
 */
function slugify(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || '';
}

/**
 * Products: peakmode/products/shorts-performance-black-v1 or ...-thumbnail
 * Frontend can send body: productSlug (or slug, productName, name), imageSuffix (thumbnail, v1, v2, etc.)
 */
const productImageStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const slug = slugify(
      req.body?.productSlug || req.body?.slug || req.body?.productName || req.body?.name || ''
    );
    const suffix = (req.body?.imageSuffix || req.body?.suffix || 'v1').toString().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'v1';
    const base = slug || `product-${Date.now()}`;
    const public_id = `${base}-${suffix}`;
    return {
      folder: 'peakmode/products',
      public_id,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
      transformation: [{ width: 1200, crop: 'limit' }],
    };
  },
});

/**
 * Reviews: peakmode/reviews/review-8493-1 (or review-<timestamp>-1 if no reviewId)
 * Frontend can send body: reviewId. Index per file in request.
 */
const reviewStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    req._reviewUploadIndex = (req._reviewUploadIndex || 0) + 1;
    const id = req.body?.reviewId || req.body?.review_id || Date.now();
    const index = req._reviewUploadIndex;
    const public_id = `review-${id}-${index}`;
    return {
      folder: 'peakmode/reviews',
      public_id,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm'],
      transformation: [{ width: 1200, crop: 'limit' }],
    };
  },
});

/**
 * Messages: peakmode/messages/message-<id>-file-<index>
 * Frontend can send body: messageId or conversationId.
 */
const messageStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    req._messageUploadIndex = (req._messageUploadIndex || 0) + 1;
    const id = req.body?.messageId || req.body?.conversationId || req.body?.message_id || Date.now();
    const index = req._messageUploadIndex;
    const public_id = `message-${id}-file-${index}`;
    return {
      folder: 'peakmode/messages',
      public_id,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm'],
      transformation: [{ width: 1200, crop: 'limit' }],
    };
  },
});

/**
 * Support: peakmode/support/ticket-1923-file-1
 * Frontend can send body: ticketId (or ticket_id, supportId).
 */
const supportStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    req._supportUploadIndex = (req._supportUploadIndex || 0) + 1;
    const id = req.body?.ticketId || req.body?.ticket_id || req.body?.supportId || Date.now();
    const index = req._supportUploadIndex;
    const public_id = `ticket-${id}-file-${index}`;
    return {
      folder: 'peakmode/support',
      public_id,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'mp4', 'mov', 'webm'],
      transformation: [{ width: 1200, crop: 'limit' }],
    };
  },
});

module.exports = {
  productImageStorage,
  reviewStorage,
  messageStorage,
  supportStorage,
  slugify,
};

