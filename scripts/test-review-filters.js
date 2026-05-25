/**
 * Run: node scripts/test-review-filters.js
 */
const reviewFilterService = require('../services/reviewFilterService');

const reviews = [
    {
        id: 'r1',
        status: 'approved',
        rating: 5,
        comment: 'Great hoodie',
        verifiedPurchase: true,
        createdAt: '2026-01-01',
        productId: 'p1',
        productName: 'Hoodie',
        sizePurchased: 'M',
        images: ['x.jpg'],
        videos: []
    },
    {
        id: 'r2',
        status: 'approved',
        rating: 3,
        comment: 'OK',
        verifiedPurchase: false,
        createdAt: '2025-06-01',
        productId: 'p2',
        productName: 'Tee',
        sizePurchased: 'L',
        images: [],
        videos: []
    },
    {
        id: 'r3',
        status: 'pending',
        rating: 5,
        comment: 'Pending',
        productId: 'p1'
    }
];

const filters = reviewFilterService.parseReviewFilterQuery({
    status: 'approved',
    ratingMin: '4',
    verified: 'true',
    search: 'hoodie'
});

const out = reviewFilterService.filterAndSortReviews(reviews, filters);
const facets = reviewFilterService.extractFacets(reviews, { status: 'approved' }, {
    p1: { name: 'Hoodie', imageUrl: 'img', inStock: true, slug: 'hoodie' }
});

console.log('matched', out.length, out[0]?.id);
console.log('facets total', facets.totalReviews, 'products', facets.products.length);
console.log('ratingCounts', facets.ratingCounts);

if (out.length !== 1 || out[0].id !== 'r1' || facets.products.length !== 2) {
    process.exitCode = 1;
    console.error('FAIL');
} else {
    console.log('OK');
}
