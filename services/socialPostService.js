/**
 * Peak Mode social / community posts — admin uploads, Instagram cache, TikTok embeds.
 */

const DATABASE_NAME = 'peakmode';
const COLLECTION_NAME = 'social_posts';
const SYNC_COLLECTION = 'social_sync_state';

const SOURCES = new Set(['admin', 'instagram', 'tiktok']);
const TYPES = new Set(['image', 'video', 'mixed', 'embed']);
const CATEGORIES = ['campaign', 'athlete', 'community', 'product', 'event', 'other'];

const TIKTOK_URL_RE =
    /^https?:\/\/(www\.)?(tiktok\.com\/@[\w.-]+\/video\/\d+|vm\.tiktok\.com\/[\w-]+)/i;

function normalizeId(doc) {
    if (!doc) return doc;
    return { ...doc, id: doc.id || doc._id };
}

function nowIso() {
    return new Date().toISOString();
}

function inferTypeFromUrls(mediaUrls = [], embedUrl = null) {
    if (embedUrl) return 'embed';
    const urls = (mediaUrls || []).map(String);
    if (!urls.length) return 'image';
    const hasVideo = urls.some((u) => /\.(mp4|mov|webm)(\?|$)/i.test(u) || u.includes('/video/'));
    const hasImage = urls.some((u) => /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(u) || u.includes('/image/'));
    if (hasVideo && hasImage) return 'mixed';
    if (hasVideo) return 'video';
    return 'image';
}

function mapInstagramMediaType(mediaType) {
    const t = String(mediaType || '').toUpperCase();
    if (t === 'VIDEO') return 'video';
    if (t === 'CAROUSEL_ALBUM') return 'mixed';
    return 'image';
}

function toPublicItem(doc) {
    const row = normalizeId(doc);
    return {
        id: row.id,
        title: row.title || '',
        caption: row.caption || '',
        type: row.type || 'image',
        mediaUrls: Array.isArray(row.mediaUrls) ? row.mediaUrls : [],
        thumbnail: row.thumbnail || null,
        permalink: row.permalink || null,
        embedUrl: row.embedUrl || null,
        platform: row.platform || null,
        source: row.source || 'admin',
        featured: row.featured === true,
        pinned: row.pinned === true,
        category: row.category || 'community',
        sortOrder: Number(row.sortOrder) || 0,
        createdAt: row.createdAt || row.timestamp || null
    };
}

function toAdminItem(doc) {
    const pub = toPublicItem(doc);
    return {
        ...pub,
        published: doc.published !== false,
        hidden: doc.hidden === true,
        externalId: doc.externalId || null,
        cloudinaryPublicIds: doc.cloudinaryPublicIds || [],
        updatedAt: doc.updatedAt || null,
        syncedAt: doc.syncedAt || null
    };
}

function isVisibleOnStorefront(doc) {
    if (!doc || doc.deletedAt) return false;
    if (doc.hidden === true) return false;
    if (doc.published === false) return false;
    return true;
}

function sortFeedItems(a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return b.sortOrder - a.sortOrder;
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return tb - ta;
}

async function readAllPosts(db) {
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTION_NAME,
        command: '--read',
        data: { deletedAt: null }
    });
    if (!result.success || !result.data) return [];
    return Array.isArray(result.data) ? result.data : [result.data];
}

async function readPostById(db, id) {
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTION_NAME,
        command: '--read',
        data: { id, deletedAt: null }
    });
    if (!result.success || !result.data) return null;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    return rows[0] || null;
}

async function generateUniquePostId(db) {
    let postId;
    let exists = true;
    do {
        postId = `SOC${Date.now().toString().slice(-8)}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        const result = await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTION_NAME,
            command: '--read',
            data: { id: postId }
        });
        exists = result.success && result.data;
    } while (exists);
    return postId;
}

function validateAdminPayload(body, { isCreate = false } = {}) {
    const errors = [];
    const source = body.source ? String(body.source) : 'admin';
    if (!SOURCES.has(source)) errors.push('invalid source');

    if (source === 'tiktok') {
        const embedUrl = String(body.embedUrl || '').trim();
        if (!embedUrl) errors.push('embedUrl required for TikTok');
        else if (!TIKTOK_URL_RE.test(embedUrl)) errors.push('embedUrl must be a valid TikTok video URL');
    } else if (isCreate) {
        const mediaUrls = Array.isArray(body.mediaUrls) ? body.mediaUrls : [];
        const embedUrl = body.embedUrl ? String(body.embedUrl).trim() : '';
        if (!mediaUrls.length && !embedUrl && source === 'admin') {
            errors.push('mediaUrls or embedUrl required');
        }
    }

    if (body.category && !CATEGORIES.includes(body.category)) {
        errors.push(`category must be one of: ${CATEGORIES.join(', ')}`);
    }

    return { ok: errors.length === 0, errors };
}

function buildPostFromBody(body, existing = null) {
    const source = body.source != null ? String(body.source) : existing?.source || 'admin';
    const mediaUrls = Array.isArray(body.mediaUrls)
        ? body.mediaUrls.map(String).filter(Boolean)
        : existing?.mediaUrls || [];
    const embedUrl =
        body.embedUrl != null ? String(body.embedUrl).trim() || null : existing?.embedUrl || null;
    const type =
        body.type && TYPES.has(body.type)
            ? body.type
            : existing?.type || inferTypeFromUrls(mediaUrls, embedUrl);

    return {
        title: body.title != null ? String(body.title) : existing?.title || '',
        caption: body.caption != null ? String(body.caption) : existing?.caption || '',
        type,
        mediaUrls,
        thumbnail: body.thumbnail != null ? String(body.thumbnail) || null : existing?.thumbnail || null,
        permalink: body.permalink != null ? String(body.permalink) || null : existing?.permalink || null,
        embedUrl,
        platform:
            body.platform != null
                ? body.platform
                : source === 'instagram'
                  ? 'instagram'
                  : source === 'tiktok'
                    ? 'tiktok'
                    : existing?.platform || null,
        source,
        category: body.category && CATEGORIES.includes(body.category) ? body.category : existing?.category || 'community',
        featured: body.featured != null ? Boolean(body.featured) : existing?.featured === true,
        pinned: body.pinned != null ? Boolean(body.pinned) : existing?.pinned === true,
        published: body.published != null ? Boolean(body.published) : existing?.published !== false,
        hidden: body.hidden != null ? Boolean(body.hidden) : existing?.hidden === true,
        sortOrder:
            body.sortOrder != null && Number.isFinite(Number(body.sortOrder))
                ? Number(body.sortOrder)
                : existing?.sortOrder || 0,
        cloudinaryPublicIds: Array.isArray(body.cloudinaryPublicIds)
            ? body.cloudinaryPublicIds
            : existing?.cloudinaryPublicIds || []
    };
}

async function createPost(db, body) {
    const check = validateAdminPayload(body, { isCreate: true });
    if (!check.ok) return { ok: false, error: check.errors.join('; ') };

    const id = await generateUniquePostId(db);
    const now = nowIso();
    const fields = buildPostFromBody(body);
    const doc = {
        id,
        ...fields,
        externalId: body.externalId || null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now
    };

    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTION_NAME,
        command: '--create',
        data: doc
    });
    if (!result.success) return { ok: false, error: result.error || 'Failed to create post' };
    return { ok: true, data: toAdminItem(doc) };
}

async function updatePost(db, id, body) {
    const existing = await readPostById(db, id);
    if (!existing) return { ok: false, error: 'Post not found', status: 404 };

    const check = validateAdminPayload({ ...existing, ...body });
    if (!check.ok) return { ok: false, error: check.errors.join('; ') };

    const fields = buildPostFromBody(body, existing);
    const update = { ...fields, updatedAt: nowIso() };

    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTION_NAME,
        command: '--update',
        data: { filter: { id }, update }
    });
    if (!result.success) return { ok: false, error: result.error || 'Failed to update post' };
    return { ok: true, data: toAdminItem({ ...existing, ...update }) };
}

async function deletePost(db, id) {
    const existing = await readPostById(db, id);
    if (!existing) return { ok: false, error: 'Post not found', status: 404 };

    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTION_NAME,
        command: '--update',
        data: {
            filter: { id },
            update: { deletedAt: nowIso(), updatedAt: nowIso(), hidden: true }
        }
    });
    if (!result.success) return { ok: false, error: result.error || 'Failed to delete post' };
    return { ok: true };
}

async function reorderPosts(db, orderedIds) {
    const ids = Array.isArray(orderedIds) ? orderedIds.map(String) : [];
    if (!ids.length) return { ok: false, error: 'ids array required' };

    let order = ids.length;
    for (const id of ids) {
        await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTION_NAME,
            command: '--update',
            data: {
                filter: { id, deletedAt: null },
                update: { sortOrder: order, updatedAt: nowIso() }
            }
        });
        order -= 1;
    }
    return { ok: true };
}

function filterFeed(posts, query = {}) {
    let rows = posts.filter(isVisibleOnStorefront);

    const source = query.source ? String(query.source).toLowerCase() : 'all';
    if (source !== 'all' && SOURCES.has(source)) {
        rows = rows.filter((r) => r.source === source);
    }

    if (query.category && CATEGORIES.includes(query.category)) {
        rows = rows.filter((r) => r.category === query.category);
    }

    if (query.featured === 'true') {
        rows = rows.filter((r) => r.featured === true);
    }

    if (query.platform) {
        rows = rows.filter((r) => r.platform === query.platform);
    }

    return rows.map(toPublicItem).sort(sortFeedItems);
}

async function getPublicFeed(db, query = {}) {
    const all = await readAllPosts(db);
    const filtered = filterFeed(all, query);
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 24));
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);
    return {
        items,
        pagination: {
            page,
            limit,
            total: filtered.length,
            pages: Math.ceil(filtered.length / limit) || 0
        }
    };
}

async function getInstagramFeedFromDb(db, query = {}) {
    const feed = await getPublicFeed(db, { ...query, source: 'instagram' });
    return feed;
}

async function upsertInstagramPost(db, igPost) {
    const externalId = String(igPost.id);
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTION_NAME,
        command: '--read',
        data: { externalId, source: 'instagram', deletedAt: null }
    });

    const existingRows = result.success && result.data
        ? Array.isArray(result.data)
            ? result.data
            : [result.data]
        : [];
    const existing = existingRows[0];

    const mediaUrl = igPost.media_url || igPost.thumbnail_url || null;
    const type = mapInstagramMediaType(igPost.media_type);
    const timestamp = igPost.timestamp || nowIso();
    const now = nowIso();

    const payload = {
        title: (igPost.caption || '').slice(0, 120),
        caption: igPost.caption || '',
        type,
        mediaUrls: mediaUrl ? [mediaUrl] : [],
        thumbnail: igPost.thumbnail_url || mediaUrl,
        permalink: igPost.permalink || null,
        embedUrl: null,
        platform: 'instagram',
        source: 'instagram',
        category: 'community',
        externalId,
        syncedAt: now,
        updatedAt: now,
        published: existing ? existing.published !== false : true,
        hidden: existing ? existing.hidden === true : false,
        featured: existing ? existing.featured === true : false,
        pinned: existing ? existing.pinned === true : false,
        sortOrder: existing ? existing.sortOrder || 0 : 0
    };

    if (existing) {
        await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: COLLECTION_NAME,
            command: '--update',
            data: { filter: { id: existing.id }, update: payload }
        });
        return { created: false, id: existing.id };
    }

    const id = await generateUniquePostId(db);
    await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: COLLECTION_NAME,
        command: '--create',
        data: {
            id,
            ...payload,
            deletedAt: null,
            createdAt: timestamp
        }
    });
    return { created: true, id };
}

async function saveSyncState(db, state) {
    const existing = await getSyncState(db);
    const doc = { key: 'instagram', ...state, updatedAt: nowIso() };
    if (existing) {
        await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: SYNC_COLLECTION,
            command: '--update',
            data: { filter: { key: 'instagram' }, update: doc }
        });
    } else {
        await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: SYNC_COLLECTION,
            command: '--create',
            data: doc
        });
    }
}

async function getSyncState(db) {
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: SYNC_COLLECTION,
        command: '--read',
        data: { key: 'instagram' }
    });
    if (!result.success || !result.data) return null;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    return rows[0] || null;
}

module.exports = {
    DATABASE_NAME,
    COLLECTION_NAME,
    SOURCES,
    TYPES,
    CATEGORIES,
    TIKTOK_URL_RE,
    toPublicItem,
    toAdminItem,
    readAllPosts,
    readPostById,
    createPost,
    updatePost,
    deletePost,
    reorderPosts,
    getPublicFeed,
    getInstagramFeedFromDb,
    upsertInstagramPost,
    saveSyncState,
    getSyncState,
    validateAdminPayload,
    buildPostFromBody
};
