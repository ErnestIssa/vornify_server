/**
 * Parse and preview Peak Mode task JSON. Server is the source of truth.
 * Does not write to the database.
 */

const taskService = require('./taskService');

const FORMAT = 'peakmode.tasks';
const VERSION = '1.0.0';
const SUPPORTED_VERSIONS = new Set(['1.0.0']);
const MAX_BYTES = 256 * 1024;
const MAX_TASKS = 200;
const MAX_DEPTH = 8;

const STATUS_ALIASES = {
    'in progress': 'in_progress',
    inprogress: 'in_progress',
    'to-do': 'todo',
    'to do': 'todo',
    cancelled: 'cancelled',
    canceled: 'cancelled'
};

const PRIORITY_ALIASES = {
    critical: 'urgent',
    normal: 'medium'
};

const CATEGORY_ALIASES = {
    support: 'customer_support',
    'customer support': 'customer_support',
    admin: 'administration',
    tech: 'technical'
};

function ownKeys(value, depth) {
    if (value == null || typeof value !== 'object') return value;
    if (depth > MAX_DEPTH) return null;
    if (Array.isArray(value)) {
        return value.map((item) => ownKeys(item, depth + 1)).filter((item) => item !== undefined);
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        if (!(value instanceof Object) || value instanceof Date) return null;
    }
    const out = {};
    for (const key of Object.keys(value)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        out[key] = ownKeys(value[key], depth + 1);
    }
    return out;
}

function byteLength(source) {
    return Buffer.byteLength(String(source || ''), 'utf8');
}

function pick(row, keys) {
    for (const key of keys) {
        if (row[key] != null && row[key] !== '') return row[key];
    }
    return undefined;
}

function enumValue(raw, allowed, aliases) {
    if (raw == null || raw === '') return null;
    const value = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
    const mapped = aliases[value] || aliases[String(raw).trim().toLowerCase()] || value;
    return allowed.includes(mapped) ? mapped : undefined;
}

function normalizeChecklist(raw) {
    if (raw == null) return [];
    if (!Array.isArray(raw)) return { error: 'Checklist must be an array' };
    const items = [];
    for (const item of raw.slice(0, 40)) {
        if (typeof item === 'string') {
            const title = item.trim();
            if (title) items.push({ title, done: false });
            continue;
        }
        if (!item || typeof item !== 'object') return { error: 'Checklist items must be objects or strings' };
        const title = String(item.title || '').trim();
        if (!title) continue;
        const done = Boolean(item.done ?? item.completed);
        items.push({ title: title.slice(0, 200), done });
    }
    return items;
}

function staffEmail(person) {
    return String(person?.email || person?.username || '').trim().toLowerCase();
}

function resolveAssignee(raw, staff) {
    if (raw == null || raw === '' || raw === 'unassigned') {
        return { person: null, warning: null, error: null };
    }

    let id = '';
    let email = '';
    let name = '';

    if (typeof raw === 'object') {
        id = String(raw.id || raw.assigneeId || '').trim();
        email = String(raw.email || '').trim().toLowerCase();
        name = String(raw.name || '').trim();
    } else {
        const text = String(raw).trim();
        const mailto = text.match(/^mailto:(.+)$/i);
        const cleaned = (mailto ? mailto[1] : text).replace(/^<|>$/g, '').trim();
        if (cleaned.includes('@')) email = cleaned.toLowerCase();
        else if (/^[a-fA-F0-9]{24}$/.test(cleaned)) id = cleaned;
        else name = cleaned;
    }

    const active = Array.isArray(staff) ? staff : [];

    if (id) {
        const hit = active.find((row) => String(row.id) === id);
        if (!hit) return { person: null, warning: null, error: 'Unknown assignee id' };
        return { person: { id: hit.id, name: hit.name, email: hit.email }, warning: null, error: null };
    }

    if (email) {
        const hits = active.filter((row) => staffEmail(row) === email);
        if (hits.length === 1) {
            const hit = hits[0];
            return { person: { id: hit.id, name: hit.name, email: hit.email }, warning: null, error: null };
        }
        if (hits.length === 0) return { person: null, warning: null, error: `Unknown assignee email: ${email}` };
        return { person: null, warning: null, error: `Assignee email is ambiguous: ${email}` };
    }

    if (name) {
        const needle = name.toLowerCase();
        const hits = active.filter((row) => String(row.name || '').trim().toLowerCase() === needle);
        if (hits.length === 1) {
            const hit = hits[0];
            return {
                person: { id: hit.id, name: hit.name, email: hit.email },
                warning: `Resolved “${name}” to ${hit.email || hit.name}`,
                error: null
            };
        }
        if (hits.length === 0) return { person: null, warning: null, error: `Unknown assignee: ${name}` };
        return { person: null, warning: null, error: `Assignee “${name}” matches more than one staff member — use their Peak Mode email` };
    }

    return { person: null, warning: null, error: 'Could not resolve assignee' };
}

function fingerprint(title, dueDate, assigneeEmail) {
    return [String(title || '').trim().toLowerCase(), dueDate || '', assigneeEmail || ''].join('|');
}

function parseEnvelope(source) {
    const text = String(source ?? '');
    if (!text.trim()) {
        return { ok: false, code: 'empty', error: 'The file is empty' };
    }
    if (byteLength(text) > MAX_BYTES) {
        return { ok: false, code: 'oversized', error: 'File is larger than 256 KB' };
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, code: 'malformed', error: 'The file is not valid JSON' };
    }

    const clean = ownKeys(parsed, 0);
    if (clean == null) {
        return { ok: false, code: 'malformed', error: 'JSON contains unsupported values' };
    }

    if (Array.isArray(clean)) {
        if (clean.length > MAX_TASKS) {
            return { ok: false, code: 'too_many', error: `A file can contain at most ${MAX_TASKS} tasks` };
        }
        return { ok: true, format: FORMAT, version: VERSION, inferred: true, tasks: clean };
    }

    if (!clean || typeof clean !== 'object') {
        return { ok: false, code: 'malformed', error: 'JSON must be a task list or a Peak Mode tasks file' };
    }

    if (clean.format && clean.format !== FORMAT) {
        return { ok: false, code: 'unsupported_format', error: `Unsupported file format “${clean.format}”. Expected ${FORMAT}.` };
    }

    if (clean.format === FORMAT && clean.version && !SUPPORTED_VERSIONS.has(String(clean.version))) {
        return {
            ok: false,
            code: 'unsupported_version',
            error: `This Peak Mode tasks file uses version ${clean.version}, which this admin does not support. Supported version: ${VERSION}.`
        };
    }

    const tasks = clean.tasks;
    if (!Array.isArray(tasks)) {
        return { ok: false, code: 'malformed', error: 'A Peak Mode tasks file must include a tasks array' };
    }
    if (tasks.length > MAX_TASKS) {
        return { ok: false, code: 'too_many', error: `A file can contain at most ${MAX_TASKS} tasks` };
    }

    return {
        ok: true,
        format: FORMAT,
        version: clean.version || VERSION,
        inferred: !clean.format,
        tasks
    };
}

function previewRow(raw, index, staff, seen, existingTitles) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {
            index,
            result: 'error',
            error: 'Each task must be an object',
            title: 'Untitled',
            warnings: []
        };
    }

    const warnings = [];
    const title = String(pick(raw, ['title', 'name']) || '').trim();
    const description = String(pick(raw, ['description', 'body', 'notes']) || '');
    const status = enumValue(pick(raw, ['status']), taskService.STATUSES, STATUS_ALIASES);
    const priority = enumValue(pick(raw, ['priority']), taskService.PRIORITIES, PRIORITY_ALIASES);
    const category = enumValue(pick(raw, ['category']), taskService.CATEGORIES, CATEGORY_ALIASES);
    const startRaw = pick(raw, ['startDate', 'start', 'start_date']);
    const dueRaw = pick(raw, ['dueDate', 'due', 'due_date']);
    const startDate = startRaw == null || startRaw === '' ? null : taskService.parseDate(startRaw);
    const dueDate = dueRaw == null || dueRaw === '' ? null : taskService.parseDate(dueRaw);
    const tags = taskService.normalizeTags(pick(raw, ['tags', 'tag']) || []);
    const checklist = normalizeChecklist(pick(raw, ['checklist', 'items']));
    const assigneeRaw = pick(raw, ['assignee', 'assignedTo', 'assigneeEmail', 'assigneeId']);

    if (typeof checklist === 'object' && checklist.error) {
        return { index, result: 'error', error: checklist.error, title: title || 'Untitled', warnings };
    }

    if (!title) {
        return { index, result: 'error', error: 'Title is required', title: 'Untitled', warnings };
    }
    if (pick(raw, ['status']) && !status) {
        return { index, result: 'error', error: 'Invalid status', title, warnings };
    }
    if (pick(raw, ['priority']) && !priority) {
        return { index, result: 'error', error: 'Invalid priority', title, warnings };
    }
    if (pick(raw, ['category']) && !category) {
        return { index, result: 'error', error: 'Invalid category', title, warnings };
    }
    if (startRaw && !startDate) {
        return { index, result: 'error', error: 'Invalid start date', title, warnings };
    }
    if (dueRaw && !dueDate) {
        return { index, result: 'error', error: 'Invalid due date', title, warnings };
    }

    const resolved = resolveAssignee(assigneeRaw, staff);
    if (resolved.error) {
        return {
            index,
            result: 'error',
            error: resolved.error,
            title,
            assigneeLabel: typeof assigneeRaw === 'string' ? assigneeRaw : assigneeRaw?.email || assigneeRaw?.name || 'Unknown',
            warnings
        };
    }
    if (resolved.warning) warnings.push(resolved.warning);

    const assigneeEmail = resolved.person?.email || '';
    const key = fingerprint(title, dueDate, assigneeEmail);
    if (seen.has(key)) {
        warnings.push('Duplicate of an earlier task in this file');
        return {
            index,
            result: 'error',
            error: 'Duplicate of an earlier task in this file',
            title,
            warnings
        };
    }
    seen.add(key);

    if (existingTitles.has(title.toLowerCase())) {
        warnings.push('An open task with this title already exists');
    }

    const payload = {
        title: title.slice(0, 160),
        description: description.slice(0, 8000),
        status: status || 'todo',
        priority: priority || 'medium',
        category: category || 'operations',
        assignee: resolved.person,
        startDate,
        dueDate,
        tags,
        checklist: Array.isArray(checklist) ? checklist : []
    };

    const check = taskService.validateTask(payload);
    if (!check.ok) {
        return { index, result: 'error', error: check.error, title, warnings };
    }

    const due = taskService.dueMeta(dueDate);
    return {
        index,
        result: warnings.length ? 'warning' : 'ready',
        error: null,
        warnings,
        title: payload.title,
        description: payload.description,
        status: payload.status,
        statusLabel: taskService.STATUS_LABELS[payload.status],
        priority: payload.priority,
        priorityLabel: taskService.PRIORITY_LABELS[payload.priority],
        category: payload.category,
        assigneeId: resolved.person?.id || null,
        assigneeLabel: resolved.person ? resolved.person.name : 'Unassigned',
        assigneeEmail: resolved.person?.email || null,
        dueDate: payload.dueDate,
        dueLabel: due.dueLabel,
        payload
    };
}

function sourceText(source) {
    if (source == null) return '';
    if (typeof source === 'string') return source;
    try {
        return JSON.stringify(source);
    } catch {
        return '';
    }
}

function summarize(rows) {
    return {
        total: rows.length,
        ready: rows.filter((row) => row.result === 'ready').length,
        warnings: rows.filter((row) => row.result === 'warning').length,
        errors: rows.filter((row) => row.result === 'error').length,
        skipped: rows.filter((row) => row.result === 'skipped').length
    };
}

function toPreviewPublic(row) {
    if (!row) return row;
    const { payload: _payload, ...rest } = row;
    return rest;
}

function buildPreview(source, staff, existingOpenTitles) {
    const parsed = parseEnvelope(sourceText(source));
    if (!parsed.ok) {
        return {
            ok: false,
            code: parsed.code,
            error: parsed.error,
            filename: null,
            summary: { total: 0, ready: 0, warnings: 0, errors: 0, skipped: 0 },
            rows: []
        };
    }

    const seen = new Set();
    const existing = new Set((existingOpenTitles || []).map((title) => String(title).toLowerCase()));
    const rows = parsed.tasks.map((task, index) => previewRow(task, index, staff, seen, existing));

    return {
        ok: true,
        code: null,
        error: null,
        inferred: parsed.inferred,
        format: parsed.format,
        version: parsed.version,
        summary: summarize(rows),
        rows
    };
}

function prepareCommit(source, staff, existingOpenTitles, options = {}) {
    const parsed = parseEnvelope(sourceText(source));
    if (!parsed.ok) {
        return {
            ok: false,
            code: parsed.code,
            error: parsed.error,
            summary: { total: 0, ready: 0, warnings: 0, errors: 0, skipped: 0 },
            rows: []
        };
    }

    const skipSet = new Set((options.skip || []).map((value) => Number(value)));
    const remap = options.assigneeRemap && typeof options.assigneeRemap === 'object' ? options.assigneeRemap : {};
    const seen = new Set();
    const existing = new Set((existingOpenTitles || []).map((title) => String(title).toLowerCase()));
    const canAssign = options.canAssign !== false;

    const rows = parsed.tasks.map((task, index) => {
        const title = task && typeof task === 'object' ? String(task.title || task.name || 'Untitled') : 'Untitled';
        if (skipSet.has(index)) {
            return { index, result: 'skipped', title, warnings: [], error: null };
        }
        const raw = task && typeof task === 'object' && !Array.isArray(task) ? { ...task } : task;
        const mapped = remap[index] ?? remap[String(index)];
        if (mapped && raw && typeof raw === 'object') raw.assignee = mapped;
        let row = previewRow(raw, index, staff, seen, existing);
        if (!canAssign && row.payload?.assignee) {
            row = {
                ...row,
                payload: { ...row.payload, assignee: null },
                assigneeId: null,
                assigneeLabel: 'Unassigned',
                assigneeEmail: null,
                warnings: [...(row.warnings || []), 'Imported unassigned because you cannot assign tasks'],
                result: row.result === 'error' ? 'error' : 'warning',
                error: row.result === 'error' ? row.error : null
            };
        }
        return row;
    });

    return {
        ok: true,
        code: null,
        error: null,
        inferred: parsed.inferred,
        format: parsed.format,
        version: parsed.version,
        summary: summarize(rows),
        rows
    };
}

module.exports = {
    FORMAT,
    VERSION,
    MAX_BYTES,
    MAX_TASKS,
    parseEnvelope,
    resolveAssignee,
    buildPreview,
    prepareCommit,
    toPreviewPublic,
    sourceText
};
