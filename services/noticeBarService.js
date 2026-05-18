/**
 * Notice bar CMS — validation, scheduling, and document helpers (Phase 1).
 */

const NOTICE_BAR_PLACEMENTS = [
    'home_below_hero',
    'home_above_social',
    'hero_below_nav_desktop'
];

/** Admin UI short labels → canonical placement stored + returned on public API */
const PLACEMENT_ALIASES = {
    global: 'home_below_hero',
    home: 'home_below_hero',
    hero: 'hero_below_nav_desktop',
    home_below_hero: 'home_below_hero',
    home_above_social: 'home_above_social',
    hero_below_nav_desktop: 'hero_below_nav_desktop'
};

function normalizePlacement(placement) {
    const raw = placement != null ? String(placement).trim() : '';
    if (!raw) return '';
    return PLACEMENT_ALIASES[raw] || raw;
}

const NOTICE_BAR_ANIMATIONS = ['scroll_marquee', 'fade', 'slide_in', 'none'];

const TEXT_MAX = 120;
const TEXT_MIN = 1;
const MAX_BULLET_SEGMENTS = 4;

const DEFAULT_CONTENT = {
    text: '',
    thinOnDesktop: false,
    animation: 'scroll_marquee',
    locale: null,
    style: {},
    media: {}
};

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

function buildProductLookupQuery(id) {
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

function countBulletSegments(text) {
    return String(text)
        .split('•')
        .map((s) => s.trim())
        .filter(Boolean).length;
}

function isHexColor(value) {
    return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

/** Map admin/storefront aliases into canonical NoticeBarContent before validate/save */
function normalizeDraftPayload(input) {
    if (!input || typeof input !== 'object') return input;
    const d = { ...input };
    if (d.message != null && d.text == null) {
        d.text = d.message;
        delete d.message;
    }
    const bg = d.backgroundUrl || d.imageUrl;
    if (bg != null && bg !== '') {
        d.media = { ...(d.media && typeof d.media === 'object' ? d.media : {}), backgroundImageUrl: String(bg).trim() };
        delete d.backgroundUrl;
        delete d.imageUrl;
    }
    return d;
}

function contentForAdminResponse(content) {
    if (!content || typeof content !== 'object') return { ...DEFAULT_CONTENT };
    return {
        ...content,
        backgroundUrl: content.media?.backgroundImageUrl || null
    };
}

function normalizeContent(input, { partial = false } = {}) {
    const base = partial ? {} : { ...DEFAULT_CONTENT };
    if (!input || typeof input !== 'object') {
        return partial ? null : { ...DEFAULT_CONTENT };
    }
    const normalized = normalizeDraftPayload(input);
    const out = {
        ...DEFAULT_CONTENT,
        ...(partial ? {} : {}),
        ...base
    };
    if (normalized.text !== undefined) out.text = String(normalized.text).trim();
    if (normalized.thinOnDesktop !== undefined) out.thinOnDesktop = Boolean(normalized.thinOnDesktop);
    if (normalized.animation !== undefined) out.animation = String(normalized.animation).trim();
    if (normalized.locale !== undefined) {
        const loc = normalized.locale;
        out.locale = loc === 'en' || loc === 'sv' ? loc : null;
    }
    if (normalized.style !== undefined && normalized.style && typeof normalized.style === 'object') {
        out.style = { ...out.style, ...normalized.style };
    }
    if (normalized.media !== undefined && normalized.media && typeof normalized.media === 'object') {
        out.media = { ...out.media, ...normalized.media };
    }
    return out;
}

/**
 * @returns {{ ok: true, content: object } | { ok: false, error: string, fields?: Record<string, string> }}
 */
function validateNoticeBarContent(content, { partial = false } = {}) {
    const fields = {};
    if (!content || typeof content !== 'object') {
        return { ok: false, error: 'Invalid content', fields: { draft: 'Content object required' } };
    }

    if (!partial || content.text !== undefined) {
        const text = content.text !== undefined ? String(content.text).trim() : '';
        if (!partial && (!text || text.length < TEXT_MIN)) {
            fields.text = `Text is required (${TEXT_MIN}–${TEXT_MAX} characters)`;
        } else if (text.length > TEXT_MAX) {
            fields.text = `Text must be at most ${TEXT_MAX} characters`;
        } else if (text && countBulletSegments(text) > MAX_BULLET_SEGMENTS) {
            fields.text = `At most ${MAX_BULLET_SEGMENTS} segments separated by •`;
        }
    }

    if (!partial || content.animation !== undefined) {
        const anim = content.animation != null ? String(content.animation) : '';
        if (!partial && !anim) {
            fields.animation = 'Animation is required';
        } else if (anim && !NOTICE_BAR_ANIMATIONS.includes(anim)) {
            fields.animation = `Must be one of: ${NOTICE_BAR_ANIMATIONS.join(', ')}`;
        }
    }

    if (content.locale !== undefined && content.locale !== null) {
        if (content.locale !== 'en' && content.locale !== 'sv') {
            fields.locale = 'Locale must be en, sv, or null';
        }
    }

    if (content.style && typeof content.style === 'object') {
        for (const key of ['gradientFrom', 'gradientVia', 'gradientTo', 'textColor']) {
            const v = content.style[key];
            if (v != null && v !== '' && !isHexColor(v)) {
                fields[`style.${key}`] = 'Must be a hex color (#RRGGBB)';
            }
        }
    }

    if (content.media?.backgroundImageUrl) {
        const url = String(content.media.backgroundImageUrl).trim();
        if (url && !/^https:\/\//i.test(url)) {
            fields['media.backgroundImageUrl'] = 'Must be an HTTPS URL';
        }
    }

    if (Object.keys(fields).length) {
        return { ok: false, error: 'Validation failed', fields };
    }
    return { ok: true, content: normalizeContent(content, { partial }) };
}

function validateSchedule(schedule) {
    const fields = {};
    if (!schedule || typeof schedule !== 'object') {
        return { ok: true, schedule: { startAt: null, endAt: null } };
    }
    const startAt = schedule.startAt == null || schedule.startAt === '' ? null : String(schedule.startAt);
    const endAt = schedule.endAt == null || schedule.endAt === '' ? null : String(schedule.endAt);
    if (startAt && Number.isNaN(Date.parse(startAt))) {
        fields['schedule.startAt'] = 'Invalid ISO date';
    }
    if (endAt && Number.isNaN(Date.parse(endAt))) {
        fields['schedule.endAt'] = 'Invalid ISO date';
    }
    if (startAt && endAt && !fields['schedule.startAt'] && !fields['schedule.endAt']) {
        if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
            fields['schedule.endAt'] = 'endAt must be after startAt';
        }
    }
    if (Object.keys(fields).length) {
        return { ok: false, error: 'Validation failed', fields };
    }
    return { ok: true, schedule: { startAt, endAt } };
}

function validateDocumentMeta(body, { partial = false, isCreate = false } = {}) {
    const fields = {};
    if (isCreate || body.placement !== undefined) {
        const placement = normalizePlacement(body.placement);
        if (!placement || !NOTICE_BAR_PLACEMENTS.includes(placement)) {
            fields.placement = `Must be one of: ${NOTICE_BAR_PLACEMENTS.join(', ')} (aliases: global, home, hero)`;
        }
    }
    if (body.priority !== undefined) {
        const p = Number(body.priority);
        if (!Number.isFinite(p) || p < 0 || p > 100 || Math.floor(p) !== p) {
            fields.priority = 'Priority must be an integer 0–100';
        }
    }
    if (Object.keys(fields).length) {
        return { ok: false, error: 'Validation failed', fields };
    }
    return { ok: true };
}

function isWithinSchedule(schedule, now = new Date()) {
    if (!schedule) return true;
    const t = now.getTime();
    if (schedule.startAt) {
        const s = new Date(schedule.startAt).getTime();
        if (!Number.isNaN(s) && t < s) return false;
    }
    if (schedule.endAt) {
        const e = new Date(schedule.endAt).getTime();
        if (!Number.isNaN(e) && t > e) return false;
    }
    return true;
}

function contentMatches(a, b) {
    return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function computeHasUnpublishedChanges(doc) {
    if (!doc.published) return true;
    return !contentMatches(doc.draft, doc.published);
}

function toListItem(doc) {
    const d = normalizeId(doc);
    const draftText = d.draft?.text || '';
    return {
        id: d.id,
        enabled: d.enabled !== false,
        placement: d.placement,
        priority: typeof d.priority === 'number' ? d.priority : 0,
        hasUnpublishedChanges: Boolean(d.hasUnpublishedChanges),
        version: typeof d.version === 'number' ? d.version : 0,
        publishedAt: d.publishedAt || null,
        updatedAt: d.updatedAt || null,
        schedule: d.schedule || { startAt: null, endAt: null },
        previewText: draftText ? draftText.slice(0, 60) : ''
    };
}

function toAdminDetail(doc) {
    const d = normalizeId(doc);
    return {
        id: d.id,
        enabled: d.enabled !== false,
        placement: d.placement,
        priority: typeof d.priority === 'number' ? d.priority : 0,
        hasUnpublishedChanges: Boolean(d.hasUnpublishedChanges),
        version: typeof d.version === 'number' ? d.version : 0,
        publishedAt: d.publishedAt || null,
        updatedAt: d.updatedAt || null,
        createdAt: d.createdAt || null,
        schedule: d.schedule || { startAt: null, endAt: null },
        draft: contentForAdminResponse(d.draft || { ...DEFAULT_CONTENT }),
        published: d.published ? contentForAdminResponse(d.published) : null
    };
}

function toPublicItem(doc) {
    const d = normalizeId(doc);
    return {
        id: d.id,
        placement: d.placement,
        priority: typeof d.priority === 'number' ? d.priority : 0,
        content: d.published || { ...DEFAULT_CONTENT }
    };
}

function newDocumentDefaults(body = {}, adminUsername = 'system') {
    const now = new Date().toISOString();
    const draftInput = normalizeDraftPayload(
        body.draft ||
            body.content || {
                text: body.text || body.message || 'New notice',
                thinOnDesktop: false,
                animation: 'scroll_marquee'
            }
    );
    const draft = normalizeContent(draftInput);
    const placement = normalizePlacement(body.placement) || 'home_below_hero';
    return {
        enabled: body.enabled !== false,
        placement,
        priority: typeof body.priority === 'number' ? body.priority : 0,
        schedule: body.schedule || { startAt: null, endAt: null },
        draft,
        published: null,
        hasUnpublishedChanges: true,
        version: 0,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
        updatedBy: adminUsername,
        deletedAt: null
    };
}

module.exports = {
    NOTICE_BAR_PLACEMENTS,
    PLACEMENT_ALIASES,
    NOTICE_BAR_ANIMATIONS,
    DEFAULT_CONTENT,
    normalizeId,
    normalizePlacement,
    normalizeDraftPayload,
    contentForAdminResponse,
    buildProductLookupQuery,
    normalizeContent,
    validateNoticeBarContent,
    validateSchedule,
    validateDocumentMeta,
    isWithinSchedule,
    computeHasUnpublishedChanges,
    toListItem,
    toAdminDetail,
    toPublicItem,
    newDocumentDefaults
};
