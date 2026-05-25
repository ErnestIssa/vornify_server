/**
 * Run: node scripts/test-review-form.js
 */
const reviewFormService = require('../services/reviewFormService');
const reviewFilterService = require('../services/reviewFilterService');

const payload = reviewFormService.parseProductsPayload({
    productId: 'prod_1',
    productNames: ['Training Shorts', 'Custom Tee'],
    products: [
        { productId: 'prod_1', productName: 'Training Shorts' },
        { productName: 'Custom Tee' }
    ],
    sizePurchased: 'm'
});

if (payload.catalogIds.length !== 1 || payload.sizePurchased !== 'M') {
    console.error('parseProductsPayload FAIL', payload);
    process.exitCode = 1;
}

const review = {
    status: 'approved',
    rating: 5,
    productId: 'prod_1',
    productNames: ['Training Shorts', 'Compression Tee'],
    products: [
        { productId: 'prod_1', productName: 'Training Shorts' },
        { productId: 'prod_2', productName: 'Compression Tee' }
    ],
    sizePurchased: 'L',
    comment: 'Great',
    videos: ['https://cdn.example/v.mp4']
};

const filters = reviewFilterService.parseReviewFilterQuery({
    status: 'approved',
    productId: 'prod_2'
});

const matched = reviewFilterService.filterAndSortReviews([review], filters);
if (matched.length !== 1) {
    console.error('multi-product filter FAIL');
    process.exitCode = 1;
}

const norm = reviewFilterService.normalizeReviewForStorefront(review);
if (!norm.videos.length || !norm.productNames.length) {
    console.error('normalize FAIL', norm);
    process.exitCode = 1;
}

console.log('OK', { catalogIds: payload.catalogIds, matched: matched.length });
