const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const productImageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'peakmode/products',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
    transformation: [{ width: 1200, crop: 'limit' }],
  },
});

const reviewStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'peakmode/reviews',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm'],
    transformation: [{ width: 1200, crop: 'limit' }],
  },
});

const messageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'peakmode/messages',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm'],
    transformation: [{ width: 1200, crop: 'limit' }],
  },
});

const supportStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'peakmode/support',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm'],
    transformation: [{ width: 1200, crop: 'limit' }],
  },
});

module.exports = {
  productImageStorage,
  reviewStorage,
  messageStorage,
  supportStorage,
};

