/**
 * Admin Records — document shape, validation, filtering, visibility.
 * Backend is the source of truth. Activity is a separate collection from audit logs.
 */

const TYPES = Object.freeze(['file', 'photo', 'link', 'note']);
const STATUSES = Object.freeze(['draft', 'active', 'signed', 'expired', 'archived']);
const LIVE_STATUSES = Object.freeze(['draft', 'active', 'signed', 'expired']);
const VISIBILITIES = Object.freeze(['everyone', 'finance', 'admin_only']);
const ACTIVITY_ACTIONS = Object.freeze(['viewed', 'uploaded', 'edited', 'archived', 'restored', 'deleted']);
const FLAGS = Object.freeze(['all', 'pinned', 'expiring', 'awaiting']);

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const BODY_MAX = 20000;
const TAG_MAX = 40;
const TAGS_MAX = 24;
const URL_MAX = 2000;
const FILE_NAME_MAX = 240;
const CATEGORY_TITLE_MAX = 80;
const CATEGORY_DESC_MAX = 400;
const DOSSIER_TITLE_MAX = 120;
const DOSSIER_SUBJECT_MAX = 80;
const DOSSIER_DESC_MAX = 600;
const EXPIRING_SOON_DAYS = 30;

const TYPE_LABELS = Object.freeze({
    file: 'File',
    photo: 'Photo',
    link: 'Link',
    note: 'Note'
});

const STATUS_LABELS = Object.freeze({
    draft: 'Draft',
    active: 'Active',
    signed: 'Signed',
    expired: 'Expired',
    archived: 'Archived'
});

const VISIBILITY_LABELS = Object.freeze({
    everyone: 'Everyone in admin',
    finance: 'Finance roles only',
    admin_only: 'Admin only'
});

const ACTIVITY_ACTION_LABELS = Object.freeze({
    viewed: 'Viewed',
    uploaded: 'Added',
    edited: 'Edited',
    archived: 'Archived',
    restored: 'Restored',
    deleted: 'Deleted'
});

function nowIso() {
    return new Date().toISOString();
}

function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

function parseDate(value) {
    if (value == null || value === '') return null;
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return `${raw}T09:00:00.000Z`;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeTags(input) {
    const list = Array.isArray(input)
        ? input
        : String(input || '')
              .split(',')
              .map((tag) => tag.trim());
    const cleaned = [];
    const seen = new Set();
    for (const raw of list) {
        const tag = str(raw, TAG_MAX)
            .replace(/^#/, '')
            .toLowerCase();
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        cleaned.push(tag);
        if (cleaned.length >= TAGS_MAX) break;
    }
    return cleaned;
}

function isLive(doc) {
    return !!doc && doc.status !== 'archived' && !doc.deletedAt;
}

function isArchived(doc) {
    return !!doc && (doc.status === 'archived' || !!doc.deletedAt);
}

function isExpiringSoon(doc, withinDays = EXPIRING_SOON_DAYS) {
    if (!doc?.expiresAt || !isLive(doc)) return false;
    const expires = new Date(doc.expiresAt).getTime();
    if (Number.isNaN(expires)) return false;
    const now = Date.now();
    const limit = now + withinDays * 24 * 60 * 60 * 1000;
    return expires >= now && expires <= limit;
}

function isOverdue(doc) {
    if (!doc?.expiresAt || !isLive(doc)) return false;
    const expires = new Date(doc.expiresAt).getTime();
    if (Number.isNaN(expires)) return false;
    return expires < Date.now();
}

function canSeeVisibility(admin, visibility) {
    const role = String(admin?.role || '');
    const permissions = Array.isArray(admin?.permissions) ? admin.permissions : [];
    if (visibility === 'everyone') return true;
    if (visibility === 'admin_only') return role === 'super_admin' || role === 'admin';
    if (visibility === 'finance') {
        return (
            role === 'super_admin' ||
            role === 'admin' ||
            permissions.includes('records.finance') ||
            permissions.includes('records.manage')
        );
    }
    return false;
}

function toPublic(doc) {
    const row = normalizeId(doc);
    if (!row) return null;
    return {
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description || '',
        categoryId: row.categoryId,
        tags: Array.isArray(row.tags) ? row.tags : [],
        dossierId: row.dossierId || null,
        linkedTo: row.linkedTo || null,
        visibility: row.visibility,
        status: row.status,
        expiresAt: row.expiresAt || null,
        awaitingSignature: Boolean(row.awaitingSignature),
        pinned: Boolean(row.pinned),
        addedBy: row.addedBy || '',
        addedById: row.addedById || null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        fileName: row.fileName || undefined,
        fileSize: row.fileSize || undefined,
        fileUrl: row.fileUrl || undefined,
        cloudinaryPublicId: row.cloudinaryPublicId || undefined,
        url: row.url || undefined,
        body: row.body || undefined
    };
}

function toPublicCategory(doc) {
    const row = normalizeId(doc);
    if (!row) return null;
    return {
        id: row.id,
        title: row.title,
        description: row.description || '',
        createdAt: row.createdAt || null,
        updatedAt: row.updatedAt || null
    };
}

function toPublicDossier(doc) {
    const row = normalizeId(doc);
    if (!row) return null;
    return {
        id: row.id,
        title: row.title,
        subject: row.subject || '',
        description: row.description || '',
        createdAt: row.createdAt || null,
        updatedAt: row.updatedAt || null
    };
}

function toPublicActivity(doc) {
    const row = normalizeId(doc);
    if (!row) return null;
    return {
        id: row.id,
        actor: row.actor || '',
        actorId: row.actorId || null,
        action: row.action,
        itemId: row.itemId || null,
        itemTitle: row.itemTitle || '',
        at: row.at || row.createdAt,
        detail: row.detail || undefined
    };
}

function catalog() {
    return {
        types: TYPES,
        statuses: STATUSES,
        liveStatuses: LIVE_STATUSES,
        visibilities: VISIBILITIES,
        flags: FLAGS,
        activityActions: ACTIVITY_ACTIONS,
        typeLabels: TYPE_LABELS,
        statusLabels: STATUS_LABELS,
        visibilityLabels: VISIBILITY_LABELS,
        activityActionLabels: ACTIVITY_ACTION_LABELS,
        expiringSoonDays: EXPIRING_SOON_DAYS
    };
}

function validateCreateInput(input) {
    const type = TYPES.includes(input?.type) ? input.type : null;
    if (!type) return { error: 'Invalid record type' };
    const title = str(input?.title, TITLE_MAX);
    if (!title) return { error: 'Title is required' };
    const categoryId = str(input?.categoryId, 80);
    if (!categoryId) return { error: 'Category is required' };
    const status = STATUSES.includes(input?.status) ? input.status : 'draft';
    const visibility = VISIBILITIES.includes(input?.visibility) ? input.visibility : 'everyone';
    const description = str(input?.description, DESCRIPTION_MAX);
    const tags = normalizeTags(input?.tags);
    const dossierId = input?.dossierId ? str(input.dossierId, 80) : null;
    const linkedTo = str(input?.linkedTo, 200) || null;
    const expiresAt = parseDate(input?.expiresAt);
    const awaitingSignature = Boolean(input?.awaitingSignature);
    const pinned = Boolean(input?.pinned);
    const url = type === 'link' ? str(input?.url, URL_MAX) : undefined;
    if (type === 'link' && !url) return { error: 'Link address is required' };
    const body = type === 'note' ? str(input?.body, BODY_MAX) : undefined;
    const fileName = type === 'file' || type === 'photo' ? str(input?.fileName, FILE_NAME_MAX) || undefined : undefined;
    const fileSize = str(input?.fileSize, 40) || undefined;
    const fileUrl = str(input?.fileUrl, URL_MAX) || undefined;
    const cloudinaryPublicId = str(input?.cloudinaryPublicId, 240) || undefined;

    return {
        value: {
            type,
            title,
            description,
            categoryId,
            tags,
            dossierId: dossierId || null,
            linkedTo,
            visibility,
            status,
            expiresAt,
            awaitingSignature,
            pinned,
            url,
            body,
            fileName,
            fileSize,
            fileUrl,
            cloudinaryPublicId
        }
    };
}

function applyUpdate(existing, input) {
    const next = { ...existing };
    if (input.type != null) {
        if (!TYPES.includes(input.type)) return { error: 'Invalid record type' };
        next.type = input.type;
    }
    if (input.title != null) {
        const title = str(input.title, TITLE_MAX);
        if (!title) return { error: 'Title is required' };
        next.title = title;
    }
    if (input.description != null) next.description = str(input.description, DESCRIPTION_MAX);
    if (input.categoryId != null) {
        const categoryId = str(input.categoryId, 80);
        if (!categoryId) return { error: 'Category is required' };
        next.categoryId = categoryId;
    }
    if (input.tags != null) next.tags = normalizeTags(input.tags);
    if (input.dossierId !== undefined) {
        next.dossierId = input.dossierId ? str(input.dossierId, 80) : null;
    }
    if (input.linkedTo !== undefined) next.linkedTo = str(input.linkedTo, 200) || null;
    if (input.visibility != null) {
        if (!VISIBILITIES.includes(input.visibility)) return { error: 'Invalid visibility' };
        next.visibility = input.visibility;
    }
    if (input.status != null) {
        if (!STATUSES.includes(input.status)) return { error: 'Invalid status' };
        next.status = input.status;
    }
    if (input.expiresAt !== undefined) next.expiresAt = parseDate(input.expiresAt);
    if (input.awaitingSignature != null) next.awaitingSignature = Boolean(input.awaitingSignature);
    if (input.pinned != null) next.pinned = Boolean(input.pinned);
    if (input.url !== undefined) next.url = str(input.url, URL_MAX) || undefined;
    if (input.body !== undefined) next.body = str(input.body, BODY_MAX) || undefined;
    if (input.fileName !== undefined) next.fileName = str(input.fileName, FILE_NAME_MAX) || undefined;
    if (input.fileSize !== undefined) next.fileSize = str(input.fileSize, 40) || undefined;
    if (input.fileUrl !== undefined) next.fileUrl = str(input.fileUrl, URL_MAX) || undefined;
    if (input.cloudinaryPublicId !== undefined) {
        next.cloudinaryPublicId = str(input.cloudinaryPublicId, 240) || undefined;
    }
    if (next.type === 'link' && !next.url) return { error: 'Link address is required' };
    next.updatedAt = nowIso();
    return { value: next };
}

function matchesFilters(doc, query, admin) {
    if (!doc) return false;
    if (!canSeeVisibility(admin, doc.visibility)) return false;

    if (query.view === 'archive') {
        if (!isArchived(doc)) return false;
    } else if (query.view === 'reminders') {
        if (!isLive(doc) || !(isExpiringSoon(doc) || isOverdue(doc))) return false;
    } else if (query.includeArchived !== true) {
        if (!isLive(doc)) return false;
    }

    if (query.type && query.type !== 'all' && doc.type !== query.type) return false;
    if (query.categoryId && query.categoryId !== 'all' && doc.categoryId !== query.categoryId) return false;
    if (query.status && query.status !== 'all' && doc.status !== query.status) return false;
    if (query.addedBy && query.addedBy !== 'all' && doc.addedBy !== query.addedBy) return false;
    if (query.dossierId && doc.dossierId !== query.dossierId) return false;
    if (query.tag) {
        const tag = String(query.tag).toLowerCase();
        if (!(doc.tags || []).includes(tag)) return false;
    }
    if (query.flag === 'pinned' && !doc.pinned) return false;
    if (query.flag === 'expiring' && !(isExpiringSoon(doc) || isOverdue(doc))) return false;
    if (query.flag === 'awaiting' && !doc.awaitingSignature) return false;

    const q = String(query.q || '')
        .trim()
        .toLowerCase();
    if (q) {
        const hay = [doc.title, doc.description, doc.linkedTo || '', doc.body || '', ...(doc.tags || [])]
            .join(' ')
            .toLowerCase();
        if (!hay.includes(q)) return false;
    }
    return true;
}

function sortRecords(items, sort = 'recent') {
    const list = [...items];
    if (sort === 'title') {
        return list.sort((a, b) => a.title.localeCompare(b.title) || b.updatedAt.localeCompare(a.updatedAt));
    }
    if (sort === 'expiry') {
        return list.sort((a, b) => {
            const ae = a.expiresAt || '9999';
            const be = b.expiresAt || '9999';
            return ae.localeCompare(be) || Number(b.pinned) - Number(a.pinned);
        });
    }
    return list.sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt))
    );
}

function computeStats(items, admin) {
    const visible = items.filter((item) => canSeeVisibility(admin, item.visibility));
    const live = visible.filter(isLive);
    return {
        all: live.length,
        pinned: live.filter((item) => item.pinned).length,
        expiring: live.filter((item) => isExpiringSoon(item) || isOverdue(item)).length,
        awaiting: live.filter((item) => item.awaitingSignature).length,
        links: live.filter((item) => item.type === 'link').length,
        archive: visible.filter(isArchived).length
    };
}

function buildCreateDoc(validated, actor) {
    const stamp = nowIso();
    return {
        id: newId('rec'),
        ...validated,
        addedBy: actor?.name || actor?.email || 'Admin',
        addedById: actor?.id ? String(actor.id) : null,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null
    };
}

function validateCategoryInput(input, { partial = false } = {}) {
    const title = input?.title != null ? str(input.title, CATEGORY_TITLE_MAX) : null;
    if (!partial && !title) return { error: 'Category title is required' };
    if (partial && input?.title != null && !title) return { error: 'Category title is required' };
    const description =
        input?.description != null ? str(input.description, CATEGORY_DESC_MAX) : partial ? undefined : '';
    const id =
        input?.id != null
            ? str(input.id, 60)
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]+/g, '-')
                  .replace(/^-+|-+$/g, '')
            : null;
    return {
        value: {
            ...(id ? { id } : {}),
            ...(title != null ? { title } : {}),
            ...(description !== undefined ? { description } : {})
        }
    };
}

function validateDossierInput(input, { partial = false } = {}) {
    const title = input?.title != null ? str(input.title, DOSSIER_TITLE_MAX) : null;
    if (!partial && !title) return { error: 'Dossier title is required' };
    if (partial && input?.title != null && !title) return { error: 'Dossier title is required' };
    const subject = input?.subject != null ? str(input.subject, DOSSIER_SUBJECT_MAX) : partial ? undefined : '';
    const description =
        input?.description != null ? str(input.description, DOSSIER_DESC_MAX) : partial ? undefined : '';
    return {
        value: {
            ...(title != null ? { title } : {}),
            ...(subject !== undefined ? { subject } : {}),
            ...(description !== undefined ? { description } : {})
        }
    };
}

function actorPerson(admin) {
    if (!admin) return { id: null, name: 'Admin', email: null };
    return {
        id: admin.id != null ? String(admin.id) : null,
        name: admin.name || admin.email || admin.username || 'Admin',
        email: admin.email || admin.username || null
    };
}

function resolveDaysFromNow(value) {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.$daysFromNow === 'number') {
        const date = new Date();
        date.setHours(9, 0, 0, 0);
        date.setDate(date.getDate() + value.$daysFromNow);
        return date.toISOString();
    }
    return null;
}

module.exports = {
    TYPES,
    STATUSES,
    LIVE_STATUSES,
    VISIBILITIES,
    ACTIVITY_ACTIONS,
    FLAGS,
    TYPE_LABELS,
    STATUS_LABELS,
    VISIBILITY_LABELS,
    ACTIVITY_ACTION_LABELS,
    EXPIRING_SOON_DAYS,
    nowIso,
    newId,
    normalizeId,
    buildLookupQuery,
    normalizeTags,
    isLive,
    isArchived,
    isExpiringSoon,
    isOverdue,
    canSeeVisibility,
    toPublic,
    toPublicCategory,
    toPublicDossier,
    toPublicActivity,
    catalog,
    validateCreateInput,
    applyUpdate,
    matchesFilters,
    sortRecords,
    computeStats,
    buildCreateDoc,
    validateCategoryInput,
    validateDossierInput,
    actorPerson,
    resolveDaysFromNow
};
