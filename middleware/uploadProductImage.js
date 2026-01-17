const multer = require('multer');
const { productImageStorage, reviewStorage, messageStorage, supportStorage } = require('./cloudinaryStorage');

const uploadProductImage = multer({
  storage: productImageStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

const uploadReview = multer({
  storage: reviewStorage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB (for videos)
  },
});

const uploadMessage = multer({
  storage: messageStorage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB (for videos)
  },
});

const uploadSupport = multer({
  storage: supportStorage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB (for videos)
  },
});

module.exports = {
  uploadProductImage,
  uploadReview,
  uploadMessage,
  uploadSupport,
};

