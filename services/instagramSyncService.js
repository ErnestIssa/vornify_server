/**
 * Sync Instagram posts via Instagram Graph API → MongoDB cache.
 * Docs: https://developers.facebook.com/docs/instagram-api
 */

const socialPostService = require('./socialPostService');

const DEFAULT_FIELDS =
    'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp';

function isConfigured() {
    return Boolean(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_ACCESS_TOKEN.trim());
}

function getUserId() {
    return (
        process.env.INSTAGRAM_USER_ID ||
        process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ||
        'me'
    );
}

async function fetchInstagramMedia({ limit = 25 } = {}) {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!token) {
        return { ok: false, error: 'INSTAGRAM_ACCESS_TOKEN not configured', code: 'NOT_CONFIGURED' };
    }

    const userId = getUserId();
    const url = new URL(`https://graph.instagram.com/${userId}/media`);
    url.searchParams.set('fields', DEFAULT_FIELDS);
    url.searchParams.set('access_token', token);
    url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))));

    const res = await fetch(url.toString());
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
        const msg = json?.error?.message || res.statusText || 'Instagram API error';
        return { ok: false, error: msg, code: 'INSTAGRAM_API_ERROR', details: json?.error || null };
    }

    const data = Array.isArray(json.data) ? json.data : [];
    return { ok: true, data, paging: json.paging || null };
}

/**
 * @param {object} db — vornifydb instance
 */
async function syncInstagramPosts(db, options = {}) {
    const startedAt = new Date().toISOString();
    if (!isConfigured()) {
        await socialPostService.saveSyncState(db, {
            lastSyncAt: startedAt,
            lastSyncOk: false,
            lastError: 'INSTAGRAM_ACCESS_TOKEN not configured',
            postCount: 0
        });
        return {
            ok: false,
            error: 'Instagram sync not configured',
            code: 'NOT_CONFIGURED'
        };
    }

    const limit = options.limit || Number(process.env.INSTAGRAM_SYNC_LIMIT) || 25;
    const fetched = await fetchInstagramMedia({ limit });

    if (!fetched.ok) {
        await socialPostService.saveSyncState(db, {
            lastSyncAt: startedAt,
            lastSyncOk: false,
            lastError: fetched.error,
            postCount: 0
        });
        return fetched;
    }

    let created = 0;
    let updated = 0;
    for (const post of fetched.data) {
        const result = await socialPostService.upsertInstagramPost(db, post);
        if (result.created) created += 1;
        else updated += 1;
    }

    const summary = {
        lastSyncAt: startedAt,
        lastSyncOk: true,
        lastError: null,
        postCount: fetched.data.length,
        created,
        updated
    };
    await socialPostService.saveSyncState(db, summary);

    return { ok: true, ...summary };
}

module.exports = {
    isConfigured,
    fetchInstagramMedia,
    syncInstagramPosts
};
