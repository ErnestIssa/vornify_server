/**
 * Release & Updates — validation, document shape, audience filtering, read receipts.
 * Backend is the source of truth for versions, publish state, and unread.
 */

const RELEASE_TYPES = ['new', 'improved', 'fixed', 'security', 'maintenance'];
const RELEASE_SEVERITIES = ['informational', 'recommended', 'required'];
const RELEASE_AUDIENCES = ['everyone', 'shop', 'admins', 'role'];
const RELEASE_STATUSES = ['draft', 'scheduled', 'published', 'archived'];
const SEMVER = /^\d+\.\d+\.\d+$/;
const TITLE_MAX = 120;
const SUMMARY_MAX = 280;
const TEXT_MAX = 4000;
const CTA_LABEL_MAX = 40;

const TYPE_LABELS = {
    new: 'New',
    improved: 'Improved',
    fixed: 'Fixed',
    security: 'Security',
    maintenance: 'Maintenance'
};

function nowIso() {
    return new Date().toISOString();
}

function normalizeId(doc) {
    if (!doc) return null;
    const out = { ...doc };
    if (out._id != null && out.id == null) {
        out.id = typeof out._id === 'string' ? out._id : out._id.toString();
    }
    if (out._id && typeof out._id.toString === 'function') {
        out._id = out._id.toString();
    }
    return out;
}

function buildLookupQuery(id) {
    const pid = String(id || '').trim();
    if (!pid) return null;
    if (/^[a-fA-F0-9]{24}$/.test(pid)) {
        try {
            const { ObjectId } = require('mongodb');
            return { $or: [{ id: pid }, { _id: new ObjectId(pid) }] };
        } catch {
            return { id: pid };
        }
    }
    return { id: pid };
}

function str(value, max) {
    const s = value == null ? '' : String(value).trim();
    return max ? s.slice(0, max) : s;
}

function isRelativeOrHttpUrl(value) {
    const s = String(value || '').trim();
    if (!s) return true;
    if (s.startsWith('/')) return true;
    try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function isHttpUrl(value) {
    const s = String(value || '').trim();
    if (!s) return true;
    try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function parseDate(value) {
    if (value == null || value === '') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function newDocumentDefaults(input, actor) {
    const body = input && typeof input === 'object' ? input : {};
    const type = RELEASE_TYPES.includes(body.type) ? body.type : 'new';
    const severity = RELEASE_SEVERITIES.includes(body.severity) ? body.severity : 'informational';
    const audience = RELEASE_AUDIENCES.includes(body.audience) ? body.audience : 'everyone';
    return {
        version: str(body.version, 32),
        title: str(body.title, TITLE_MAX),
        summary: str(body.summary, SUMMARY_MAX),
        description: str(body.description, TEXT_MAX),
        whatsNew: str(body.whatsNew, TEXT_MAX),
        whatsImproved: str(body.whatsImproved, TEXT_MAX),
        bugFixes: str(body.bugFixes, TEXT_MAX),
        type,
        severity,
        audience,
        audienceRole: audience === 'role' ? str(body.audienceRole, 64) : '',
        ctaLabel: str(body.ctaLabel, CTA_LABEL_MAX),
        ctaUrl: str(body.ctaUrl, 500),
        media: {
            imageUrl: str(body.imageUrl || body.media?.imageUrl, 2000),
            videoUrl: str(body.videoUrl || body.media?.videoUrl, 2000)
        },
        status: 'draft',
        scheduledAt: parseDate(body.scheduledAt),
        publishedAt: null,
        archivedAt: null,
        requiresUpdate: severity === 'required',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        createdBy: actor || 'admin',
        updatedBy: actor || 'admin',
        deletedAt: null
    };
}

function applyPatch(existing, patch) {
    const next = { ...existing };
    const body = patch && typeof patch === 'object' ? patch : {};
    const keys = [
        'version',
        'title',
        'summary',
        'description',
        'whatsNew',
        'whatsImproved',
        'bugFixes',
        'ctaLabel',     
        'ctaUrl',
        'audienceRole'
    ];
    for (const key of keys) {
        if (body[key] !== undefined) next[key] = str(body[key], key === 'summary' ? SUMMARY_MAX : key === 'title' ? TITLE_MAX : TEXT_MAX);
    }
    if (body.version !== undefined) next.version = str(body.version, 32);
    if (body.ctaLabel !== undefined) next.ctaLabel = str(body.ctaLabel, CTA_LABEL_MAX);
    if (body.ctaUrl !== undefined) next.ctaUrl = str(body.ctaUrl, 500);
    if (body.audienceRole !== undefined) next.audienceRole = str(body.audienceRole, 64);
    if (body.type !== undefined && RELEASE_TYPES.includes(body.type)) next.type = body.type;
    if (body.severity !== undefined && RELEASE_SEVERITIES.includes(body.severity)) {
        next.severity = body.severity;
        next.requiresUpdate = body.severity === 'required';
    }
    if (body.audience !== undefined && RELEASE_AUDIENCES.includes(body.audience)) {
        next.audience = body.audience;
        if (body.audience !== 'role') next.audienceRole = '';
    }
    if (body.scheduledAt !== undefined) next.scheduledAt = parseDate(body.scheduledAt);
    const imageUrl = body.imageUrl !== undefined ? body.imageUrl : body.media?.imageUrl;
    const videoUrl = body.videoUrl !== undefined ? body.videoUrl : body.media?.videoUrl;
    if (imageUrl !== undefined || videoUrl !== undefined) {
        next.media = {
            imageUrl: imageUrl !== undefined ? str(imageUrl, 2000) : (existing.media?.imageUrl || ''),
            videoUrl: videoUrl !== undefined ? str(videoUrl, 2000) : (existing.media?.videoUrl || '')
        };
    }
    next.updatedAt = nowIso();
    return next;
}

function validateRelease(doc, { forPublish = false } = {}) {
    const fields = {};
    if (!doc || typeof doc !== 'object') {
        return { ok: false, error: 'Invalid release', fields: { body: 'Release object required' } };
    }
    if (forPublish || doc.version) {
        if (!SEMVER.test(String(doc.version || '').trim())) {
            fields.version = 'Use SemVer like 1.4.0';
        }
    }
    if (forPublish || doc.title) {
        const title = String(doc.title || '').trim();
        if (forPublish && !title) fields.title = 'Title is required';
        else if (title.length > TITLE_MAX) fields.title = `Title must be at most ${TITLE_MAX} characters`;
    }
    if (forPublish || doc.summary) {
        const summary = String(doc.summary || '').trim();
        if (forPublish && !summary) fields.summary = 'Summary is required';
        else if (summary.length > SUMMARY_MAX) fields.summary = `Summary must be at most ${SUMMARY_MAX} characters`;
    }
    if (doc.type && !RELEASE_TYPES.includes(doc.type)) fields.type = 'Invalid release type';
    if (doc.severity && !RELEASE_SEVERITIES.includes(doc.severity)) fields.severity = 'Invalid severity';
    if (doc.audience && !RELEASE_AUDIENCES.includes(doc.audience)) fields.audience = 'Invalid audience';
    if (doc.audience === 'role' && !String(doc.audienceRole || '').trim()) {
        fields.audienceRole = 'Role is required when audience is a specific role';
    }
    if (doc.ctaUrl && !isRelativeOrHttpUrl(doc.ctaUrl)) fields.ctaUrl = 'CTA must be a site path or http(s) URL';
    if (doc.media?.imageUrl && !isHttpUrl(doc.media.imageUrl)) fields.imageUrl = 'Image must be an http(s) URL';
    if (doc.media?.videoUrl && !isHttpUrl(doc.media.videoUrl)) fields.videoUrl = 'Video must be an http(s) URL';
    if (Object.keys(fields).length) {
        return { ok: false, error: Object.values(fields)[0], fields };
    }
    return { ok: true };
}

function isPublishedAndLive(doc, now = new Date()) {
    if (!doc || doc.deletedAt) return false;
    if (doc.status === 'published' && doc.publishedAt) return true;
    if (doc.status === 'scheduled' && doc.scheduledAt && new Date(doc.scheduledAt) <= now) return true;
    return false;
}

function matchesAudience(doc, { surface, role } = {}) {
    const audience = doc.audience || 'everyone';
    if (audience === 'everyone') return true;
    if (surface === 'shop') return audience === 'shop';
    if (surface === 'admin') {
        if (audience === 'admins') return true;
        if (audience === 'role') {
            const want = String(doc.audienceRole || '').trim().toLowerCase();
            return want && String(role || '').trim().toLowerCase() === want;
        }
        return false;
    }
    return false;
}

function toPublicItem(doc, receipt) {
    const item = normalizeId(doc);
    if (!item) return null;
    return {
        id: item.id,
        version: item.version,
        title: item.title,
        summary: item.summary,
        description: item.description || '',
        whatsNew: item.whatsNew || '',
        whatsImproved: item.whatsImproved || '',
        bugFixes: item.bugFixes || '',
        type: item.type,
        typeLabel: TYPE_LABELS[item.type] || item.type,
        severity: item.severity,
        audience: item.audience,
        ctaLabel: item.ctaLabel || '',
        ctaUrl: item.ctaUrl || '',
        media: {
            imageUrl: item.media?.imageUrl || '',
            videoUrl: item.media?.videoUrl || ''
        },
        publishedAt: item.publishedAt,
        requiresUpdate: item.severity === 'required',
        highlight: item.severity === 'recommended' || item.severity === 'required' || item.type === 'new',
        readAt: receipt?.readAt || null,
        dismissedAt: receipt?.dismissedAt || null,
        bannerDismissedAt: receipt?.bannerDismissedAt || null
    };
}

function toAdminListItem(doc) {
    const item = normalizeId(doc);
    if (!item) return null;
    return {
        id: item.id,
        version: item.version,
        title: item.title,
        summary: item.summary,
        type: item.type,
        typeLabel: TYPE_LABELS[item.type] || item.type,
        severity: item.severity,
        audience: item.audience,
        audienceRole: item.audienceRole || '',
        status: item.status,
        scheduledAt: item.scheduledAt,
        publishedAt: item.publishedAt,
        archivedAt: item.archivedAt,
        updatedAt: item.updatedAt,
        requiresUpdate: item.severity === 'required'
    };
}

function toAdminDetail(doc) {
    const item = normalizeId(doc);
    if (!item) return null;
    return {
        ...toAdminListItem(item),
        description: item.description || '',
        whatsNew: item.whatsNew || '',
        whatsImproved: item.whatsImproved || '',
        bugFixes: item.bugFixes || '',
        ctaLabel: item.ctaLabel || '',
        ctaUrl: item.ctaUrl || '',
        media: {
            imageUrl: item.media?.imageUrl || '',
            videoUrl: item.media?.videoUrl || ''
        },
        createdAt: item.createdAt,
        createdBy: item.createdBy,
        updatedBy: item.updatedBy
    };
}

function comparePublishedDesc(a, b) {
    const at = new Date(a.publishedAt || a.scheduledAt || a.updatedAt || 0).getTime();
    const bt = new Date(b.publishedAt || b.scheduledAt || b.updatedAt || 0).getTime();
    return bt - at;
}

function appVersions() {
    let backend = '1.0.0';
    try {
        backend = require('../package.json').version || '1.0.0';
    } catch {
        /* ignore */
    }
    return {
        shop: process.env.SHOP_APP_VERSION || '1.0.0',
        admin: process.env.ADMIN_APP_VERSION || '1.0.0',
        backend: process.env.BACKEND_APP_VERSION || backend
    };
}

module.exports = {
    RELEASE_TYPES,
    RELEASE_SEVERITIES,
    RELEASE_AUDIENCES,
    RELEASE_STATUSES,
    TYPE_LABELS,
    SEMVER,
    nowIso,
    normalizeId,
    buildLookupQuery,
    newDocumentDefaults,
    applyPatch,
    validateRelease,
    isPublishedAndLive,
    matchesAudience,
    toPublicItem,
    toAdminListItem,
    toAdminDetail,
    comparePublishedDesc,
    appVersions
};
