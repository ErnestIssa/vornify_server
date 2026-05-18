/**
 * Seed notice_bars with live-style copy (3 placements × en/sv).
 * Run from project root: node scripts/seed-notice-bars.js
 * Optional: node scripts/seed-notice-bars.js path/to/notice-bar-seed.json
 *
 * Idempotent: skips if a bar already exists for placement+locale.
 * Creates published bars (draft = published) so storefront public API works immediately.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const getDBInstance = require('../vornifydb/dbInstance');
const noticeBarService = require('../services/noticeBarService');

const DATABASE_NAME = 'peakmode';
const COLLECTION_NAME = 'notice_bars';

function loadSeedRows() {
    const argPath = process.argv[2];
    const defaultPath = path.join(__dirname, 'notice-bar-seed.json');
    const filePath = argPath ? path.resolve(argPath) : defaultPath;
    if (!fs.existsSync(filePath)) {
        throw new Error(`Seed file not found: ${filePath}`);
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(raw)) {
        throw new Error('Seed file must be a JSON array');
    }
    return raw;
}

async function findExisting(collection, placement, locale) {
    const placementCanon = noticeBarService.normalizePlacement(placement);
    const rows = await collection
        .find({ deletedAt: null, placement: placementCanon })
        .toArray();
    return rows.find((r) => {
        const loc = r.published?.locale ?? r.draft?.locale ?? null;
        return loc === locale;
    });
}

async function seed() {
    const db = getDBInstance();
    const collection = await db.getCollection(DATABASE_NAME, COLLECTION_NAME);
    if (!collection) {
        console.error('Could not connect to MongoDB. Check MONGODB_URI in .env');
        process.exit(1);
    }

    const rows = loadSeedRows();
    let created = 0;
    let skipped = 0;

    for (const row of rows) {
        const placement = noticeBarService.normalizePlacement(row.placement);
        const locale = row.locale === 'sv' ? 'sv' : row.locale === 'en' ? 'en' : null;
        const content = noticeBarService.normalizeContent(
            noticeBarService.normalizeDraftPayload(row.content || row),
            { partial: false }
        );
        if (locale) content.locale = locale;

        const check = noticeBarService.validateNoticeBarContent(content, { requireForPublish: true });
        if (!check.ok) {
            console.warn('Skip invalid seed row:', placement, locale, check.fields);
            skipped++;
            continue;
        }

        const existing = await findExisting(collection, placement, locale);
        if (existing) {
            console.log(`Skip (exists): ${placement} [${locale || 'all'}]`);
            skipped++;
            continue;
        }

        const now = new Date().toISOString();
        const published = JSON.parse(JSON.stringify(check.content));
        const doc = {
            enabled: row.enabled !== false,
            placement,
            priority: typeof row.priority === 'number' ? row.priority : 10,
            schedule: row.schedule || { startAt: null, endAt: null },
            draft: published,
            published,
            hasUnpublishedChanges: false,
            version: 1,
            publishedAt: now,
            createdAt: now,
            updatedAt: now,
            updatedBy: 'seed-notice-bars',
            publishedBy: 'seed-notice-bars',
            deletedAt: null
        };

        const result = await collection.insertOne(doc);
        const id = result.insertedId.toString();
        await collection.updateOne({ _id: result.insertedId }, { $set: { id } });
        console.log(`Created: ${placement} [${locale || 'all'}] id=${id}`);
        created++;
    }

    console.log(`Done. created=${created} skipped=${skipped}`);
    process.exit(0);
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
