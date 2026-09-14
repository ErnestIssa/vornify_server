/**
 * Run: node scripts/test-social-posts.js
 */
const socialPostService = require('../services/socialPostService');

const sample = {
    status: 'approved',
    title: 'Test',
    source: 'admin',
    mediaUrls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.mp4'],
    published: true,
    hidden: false,
    pinned: true,
    sortOrder: 5,
    createdAt: '2026-01-02T00:00:00.000Z'
};

const type = socialPostService.buildPostFromBody({
    mediaUrls: sample.mediaUrls
});
if (type.type !== 'mixed') {
    console.error('FAIL type', type.type);
    process.exitCode = 1;
}

const tiktokCheck = socialPostService.validateAdminPayload({
    source: 'tiktok',
    embedUrl: 'https://www.tiktok.com/@peakmode/video/1234567890'
});
if (!tiktokCheck.ok) {
    console.error('FAIL tiktok', tiktokCheck);
    process.exitCode = 1;
}

const badTiktok = socialPostService.validateAdminPayload({
    source: 'tiktok',
    embedUrl: 'https://example.com/not-tiktok'
});
if (badTiktok.ok) {
    console.error('FAIL should reject bad tiktok url');
    process.exitCode = 1;
}

const pub = socialPostService.toPublicItem({
    id: 'SOC1',
    ...sample,
    type: 'mixed'
});
if (!pub.id || pub.type !== 'mixed') {
    console.error('FAIL public', pub);
    process.exitCode = 1;
}

console.log('OK', { type: type.type, publicId: pub.id });
