/**
 * Admin Tasks — document shape, validation, due labels, list filtering.
 * Backend is the source of truth. Task activity is a separate collection from audit logs.
 */

const STATUSES = Object.freeze(['backlog', 'todo', 'in_progress', 'waiting', 'completed', 'cancelled']);
const OPEN_STATUSES = Object.freeze(['backlog', 'todo', 'in_progress', 'waiting']);
const PRIORITIES = Object.freeze(['urgent', 'high', 'medium', 'low']);
const CATEGORIES = Object.freeze([
    'operations',
    'products',
    'marketing',
    'website',
    'customer_support',
    'administration',
    'technical'
]);
const VIEWS = Object.freeze(['mine', 'all', 'overdue', 'today', 'upcoming', 'completed', 'archived']);
const PRIORITY_RANK = Object.freeze({ urgent: 0, high: 1, medium: 2, low: 3 });

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 8000;
const TAG_MAX = 32;
const TAGS_MAX = 12;
const CHECKLIST_MAX = 40;
const CHECKLIST_TITLE_MAX = 200;

const STATUS_LABELS = {
    backlog: 'Backlog',
    todo: 'Todo',
    in_progress: 'In Progress',
    waiting: 'Waiting',
    completed: 'Completed',
    cancelled: 'Cancelled'
};

const PRIORITY_LABELS = {
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low'
};

const CATEGORY_LABELS = {
    operations: 'Operations',
    products: 'Products',
    marketing: 'Marketing',
    website: 'Website',
    customer_support: 'Customer Support',
    administration: 'Administration',
    technical: 'Technical'
};

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
        return `${raw}T12:00:00.000Z`;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function utcDay(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function dueMeta(dueDate) {
    if (!dueDate) return { dueLabel: 'No due date', dueState: 'none' };
    const due = utcDay(dueDate);
    const today = utcDay(nowIso());
    if (due == null || today == null) return { dueLabel: 'No due date', dueState: 'none' };
    const diffDays = Math.round((due - today) / 86400000);
    if (diffDays < 0) {
        const n = Math.abs(diffDays);
        return { dueLabel: `${n} day${n === 1 ? '' : 's'} overdue`, dueState: 'overdue' };
    }
    if (diffDays === 0) return { dueLabel: 'Due today', dueState: 'today' };
    if (diffDays === 1) return { dueLabel: 'Due tomorrow', dueState: 'soon' };
    const formatted = new Date(dueDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    });
    return { dueLabel: `Due ${formatted}`, dueState: 'upcoming' };
}

function person(value) {
    if (!value || typeof value !== 'object') return null;
    const id = str(value.id, 64);
    if (!id) return null;
    return {
        id,
        name: str(value.name, 120) || 'Staff',
        email: str(value.email, 160) || null
    };
}

function normalizeTags(value) {
    const raw = Array.isArray(value)
        ? value
        : String(value || '')
            .split(',')
            .map((t) => t.trim());
    const seen = new Set();
    const tags = [];
    for (const item of raw) {
        const tag = str(item, TAG_MAX).toLowerCase();
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        tags.push(tag);
        if (tags.length >= TAGS_MAX) break;
    }
    return tags;
}

function normalizeChecklist(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, CHECKLIST_MAX).map((item, index) => {
        const row = item && typeof item === 'object' ? item : { title: item };
        const title = str(row.title, CHECKLIST_TITLE_MAX);
        const done = Boolean(row.done);
        return {
            id: str(row.id, 64) || newId('chk'),
            title,
            done,
            sort: Number.isFinite(row.sort) ? row.sort : index,
            completedAt: done ? parseDate(row.completedAt) || nowIso() : null
        };
    }).filter((item) => item.title);
}

function actorPerson(admin) {
    if (!admin) return { id: 'system', name: 'System', email: null };
    return {
        id: String(admin.id || admin._id || 'admin'),
        name: admin.name || admin.email || admin.username || 'Staff',
        email: admin.email || admin.username || null
    };
}

function newDocumentDefaults(input, actor) {
    const body = input && typeof input === 'object' ? input : {};
    const status = STATUSES.includes(body.status) ? body.status : 'todo';
    const priority = PRIORITIES.includes(body.priority) ? body.priority : 'medium';
    const category = CATEGORIES.includes(body.category) ? body.category : 'operations';
    const stamp = nowIso();
    const completed = status === 'completed';
    return {
        title: str(body.title, TITLE_MAX),
        description: str(body.description, DESCRIPTION_MAX),
        status,
        priority,
        category,
        assignee: person(body.assignee) || null,
        createdBy: person(actor) || actorPerson(null),
        startDate: parseDate(body.startDate),
        dueDate: parseDate(body.dueDate),
        completedAt: completed ? parseDate(body.completedAt) || stamp : null,
        tags: normalizeTags(body.tags),
        checklist: normalizeChecklist(body.checklist),
        createdAt: stamp,
        updatedAt: stamp,
        archivedAt: null,
        deletedAt: null,
        importBatchId: str(body.importBatchId, 80) || null
    };
}

function validateTask(doc) {
    const fields = {};
    if (!str(doc?.title, TITLE_MAX)) fields.title = 'Title is required';
    if (doc?.status && !STATUSES.includes(doc.status)) fields.status = 'Invalid status';
    if (doc?.priority && !PRIORITIES.includes(doc.priority)) fields.priority = 'Invalid priority';
    if (doc?.category && !CATEGORIES.includes(doc.category)) fields.category = 'Invalid category';
    if (doc?.startDate && !parseDate(doc.startDate) && doc.startDate !== null) fields.startDate = 'Invalid start date';
    if (doc?.dueDate && !parseDate(doc.dueDate) && doc.dueDate !== null) fields.dueDate = 'Invalid due date';
    const ok = Object.keys(fields).length === 0;
    return { ok, error: ok ? null : Object.values(fields)[0], fields };
}

function applyPatch(existing, body) {
    const next = { ...existing };
    const input = body && typeof body === 'object' ? body : {};
    if (input.title !== undefined) next.title = str(input.title, TITLE_MAX);
    if (input.description !== undefined) next.description = str(input.description, DESCRIPTION_MAX);
    if (input.status !== undefined && STATUSES.includes(input.status)) {
        next.status = input.status;
        if (input.status === 'completed' && !next.completedAt) next.completedAt = nowIso();
        if (input.status !== 'completed') next.completedAt = null;
        if (input.status === 'in_progress' && !next.startDate) next.startDate = nowIso();
    }
    if (input.priority !== undefined && PRIORITIES.includes(input.priority)) next.priority = input.priority;
    if (input.category !== undefined && CATEGORIES.includes(input.category)) next.category = input.category;
    if (input.assignee !== undefined) next.assignee = person(input.assignee);
    if (input.startDate !== undefined) next.startDate = parseDate(input.startDate);
    if (input.dueDate !== undefined) next.dueDate = parseDate(input.dueDate);
    if (input.tags !== undefined) next.tags = normalizeTags(input.tags);
    if (input.checklist !== undefined) next.checklist = normalizeChecklist(input.checklist);
    next.updatedAt = nowIso();
    return next;
}

function isOpen(doc) {
    return OPEN_STATUSES.includes(doc?.status);
}

function isArchived(doc) {
    return Boolean(doc?.archivedAt || doc?.deletedAt);
}

function matchesView(doc, view, actorId) {
    if (view === 'archived') return isArchived(doc);
    if (isArchived(doc)) return false;
    const due = dueMeta(doc.dueDate);
    switch (view) {
        case 'mine':
            return isOpen(doc) && doc.assignee?.id === String(actorId || '');
        case 'overdue':
            return isOpen(doc) && due.dueState === 'overdue';
        case 'today':
            return isOpen(doc) && due.dueState === 'today';
        case 'upcoming':
            return isOpen(doc) && (due.dueState === 'soon' || due.dueState === 'upcoming');
        case 'completed':
            return doc.status === 'completed';
        case 'all':
        default:
            return true;
    }
}

function matchesFilters(doc, query) {
    if (query.status && doc.status !== query.status) return false;
    if (query.priority && doc.priority !== query.priority) return false;
    if (query.category && doc.category !== query.category) return false;
    if (query.assigneeId === 'unassigned' && doc.assignee?.id) return false;
    if (query.assigneeId && query.assigneeId !== 'unassigned' && doc.assignee?.id !== query.assigneeId) return false;
    if (query.createdById && doc.createdBy?.id !== query.createdById) return false;
    if (query.tag && !(doc.tags || []).includes(String(query.tag).toLowerCase())) return false;
    const q = String(query.q || '').trim().toLowerCase();
    if (q) {
        const hay = [
            doc.title,
            doc.description,
            doc.assignee?.name,
            doc.createdBy?.name,
            ...(doc.tags || []),
            ...(doc.checklist || []).map((item) => item.title)
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
    }
    return true;
}

function sortTasks(rows, sort) {
    const next = rows.slice();
    switch (sort) {
        case 'title':
            next.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
            break;
        case 'priority':
            next.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
            break;
        case 'due':
            next.sort((a, b) => {
                const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
                const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
                return ad - bd;
            });
            break;
        default:
            next.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    }
    return next;
}

function computeStats(rows, actorId) {
    const weekAgo = Date.now() - 7 * 86400000;
    let allOpen = 0;
    let mine = 0;
    let dueToday = 0;
    let overdue = 0;
    let inProgress = 0;
    let completedThisWeek = 0;
    for (const doc of rows) {
        const due = dueMeta(doc.dueDate);
        if (isOpen(doc)) {
            allOpen += 1;
            if (doc.assignee?.id === String(actorId || '')) mine += 1;
            if (due.dueState === 'today') dueToday += 1;
            if (due.dueState === 'overdue') overdue += 1;
            if (doc.status === 'in_progress') inProgress += 1;
        }
        if (doc.status === 'completed' && doc.completedAt && new Date(doc.completedAt).getTime() >= weekAgo) {
            completedThisWeek += 1;
        }
    }
    return { allOpen, mine, dueToday, overdue, inProgress, completedThisWeek };
}

function toPublic(doc) {
    if (!doc) return null;
    const due = dueMeta(doc.dueDate);
    const checklist = Array.isArray(doc.checklist) ? doc.checklist : [];
    const done = checklist.filter((item) => item.done).length;
    return {
        id: String(doc.id),
        title: doc.title || '',
        description: doc.description || '',
        status: doc.status,
        statusLabel: STATUS_LABELS[doc.status] || doc.status,
        priority: doc.priority,
        priorityLabel: PRIORITY_LABELS[doc.priority] || doc.priority,
        category: doc.category,
        categoryLabel: CATEGORY_LABELS[doc.category] || doc.category,
        assignee: doc.assignee || null,
        createdBy: doc.createdBy || null,
        startDate: doc.startDate || null,
        dueDate: doc.dueDate || null,
        completedAt: doc.completedAt || null,
        createdAt: doc.createdAt || null,
        updatedAt: doc.updatedAt || null,
        tags: Array.isArray(doc.tags) ? doc.tags : [],
        checklist,
        checklistDone: done,
        checklistTotal: checklist.length,
        dueLabel: due.dueLabel,
        dueState: due.dueState,
        archivedAt: doc.archivedAt || null,
        archived: isArchived(doc)
    };
}

function activityEntry(taskId, actor, action, metadata) {
    const personSnap = person(actor) || actorPerson(null);
    return {
        taskId: String(taskId),
        actorId: personSnap.id,
        actorName: personSnap.name,
        actorEmail: personSnap.email,
        action,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        createdAt: nowIso()
    };
}

function activityLabel(entry) {
    const name = entry.actorName || 'Staff';
    const meta = entry.metadata || {};
    switch (entry.action) {
        case 'created':
            return `${name} created this task`;
        case 'status_changed':
            return `${name} changed status from ${STATUS_LABELS[meta.from] || meta.from || '—'} → ${STATUS_LABELS[meta.to] || meta.to || '—'}`;
        case 'priority_changed':
            return `${name} changed priority from ${PRIORITY_LABELS[meta.from] || meta.from || '—'} → ${PRIORITY_LABELS[meta.to] || meta.to || '—'}`;
        case 'assigned':
            return meta.toName ? `${name} assigned this to ${meta.toName}` : `${name} assigned this task`;
        case 'unassigned':
            return `${name} removed the assignee`;
        case 'due_changed':
            return `${name} updated the due date`;
        case 'checklist_added':
            return `${name} added checklist item “${meta.title || ''}”`;
        case 'checklist_toggled':
            return `${name} ${meta.done ? 'completed' : 'reopened'} “${meta.title || 'checklist item'}”`;
        case 'checklist_removed':
            return `${name} removed a checklist item`;
        case 'completed':
            return `${name} completed this task`;
        case 'cancelled':
            return `${name} cancelled this task`;
        case 'archived':
            return `${name} archived this task`;
        case 'restored':
            return `${name} restored this task from Archives`;
        case 'imported':
            return `${name} imported this task from JSON`;
        case 'updated':
        default:
            return `${name} updated this task`;
    }
}

function toActivityPublic(entry) {
    const row = normalizeId(entry);
    if (!row) return null;
    return {
        id: String(row.id),
        taskId: row.taskId,
        actorId: row.actorId,
        actorName: row.actorName,
        action: row.action,
        metadata: row.metadata || {},
        label: activityLabel(row),
        createdAt: row.createdAt
    };
}

function patchPermissionOk(permissions, patch, hasPermission) {
    if (hasPermission(permissions, 'tasks.manage')) return true;
    const keys = Object.keys(patch || {}).filter((key) => patch[key] !== undefined);
    const editKeys = ['title', 'description', 'category', 'tags', 'priority', 'startDate', 'dueDate', 'checklist'];
    if (keys.some((key) => editKeys.includes(key)) && !hasPermission(permissions, 'tasks.edit')) return false;
    if (keys.includes('assignee') && !hasPermission(permissions, 'tasks.assign')) return false;
    if (keys.includes('status')) {
        if (patch.status === 'completed') {
            if (!hasPermission(permissions, 'tasks.complete') && !hasPermission(permissions, 'tasks.edit')) return false;
        } else if (!hasPermission(permissions, 'tasks.edit')) {
            return false;
        }
    }
    return keys.length > 0;
}

function diffActivity(before, after, actor) {
    const entries = [];
    if (before.status !== after.status) {
        const action = after.status === 'completed' ? 'completed' : after.status === 'cancelled' ? 'cancelled' : 'status_changed';
        entries.push(activityEntry(after.id, actor, action, { from: before.status, to: after.status }));
    }
    if (before.priority !== after.priority) {
        entries.push(activityEntry(after.id, actor, 'priority_changed', { from: before.priority, to: after.priority }));
    }
    const beforeAssignee = before.assignee?.id || null;
    const afterAssignee = after.assignee?.id || null;
    if (beforeAssignee !== afterAssignee) {
        entries.push(activityEntry(after.id, actor, afterAssignee ? 'assigned' : 'unassigned', {
            from: beforeAssignee,
            to: afterAssignee,
            toName: after.assignee?.name || null
        }));
    }
    if ((before.dueDate || null) !== (after.dueDate || null)) {
        entries.push(activityEntry(after.id, actor, 'due_changed', { from: before.dueDate, to: after.dueDate }));
    }
    if (entries.length === 0) {
        entries.push(activityEntry(after.id, actor, 'updated', {}));
    }
    return entries;
}

module.exports = {
    STATUSES,
    OPEN_STATUSES,
    PRIORITIES,
    CATEGORIES,
    VIEWS,
    STATUS_LABELS,
    PRIORITY_LABELS,
    CATEGORY_LABELS,
    nowIso,
    newId,
    normalizeId,
    buildLookupQuery,
    parseDate,
    dueMeta,
    person,
    actorPerson,
    normalizeTags,
    normalizeChecklist,
    newDocumentDefaults,
    validateTask,
    applyPatch,
    isOpen,
    isArchived,
    matchesView,
    matchesFilters,
    sortTasks,
    computeStats,
    toPublic,
    activityEntry,
    activityLabel,
    toActivityPublic,
    patchPermissionOk,
    diffActivity
};
