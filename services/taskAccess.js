/**
 * Task lifecycle access. Backend is the source of truth.
 * Archive / restore / permanent delete require tasks.delete or tasks.manage.
 * Only Super Admin may change a task created by someone else.
 * Tasks with no creator are Super Admin only (fail closed).
 */

const { hasPermission, normalizeRole } = require('./staffAccessPolicy');

function idOf(value, depth = 0) {
    if (value == null || depth > 4) return '';
    if (typeof value === 'object') {
        if (value.id != null) {
            const nested = idOf(value.id, depth + 1);
            if (nested) return nested;
        }
        if (value._id != null) {
            const nested = idOf(value._id, depth + 1);
            if (nested) return nested;
        }
        if (typeof value.toString === 'function') {
            const next = String(value.toString()).trim();
            if (next && next !== '[object Object]') return next;
        }
        return '';
    }
    const next = String(value).trim();
    return next === '[object Object]' ? '' : next;
}

function actorId(admin) {
    if (!admin) return '';
    return idOf(admin.id || admin._id);
}

function isSuperAdmin(admin) {
    return normalizeRole(admin?.role) === 'super_admin';
}

function hasDeletePermission(admin) {
    return hasPermission(admin?.permissions, 'tasks.delete') || hasPermission(admin?.permissions, 'tasks.manage');
}

function ownsTask(admin, doc) {
    const owner = idOf(doc?.createdBy);
    const actor = actorId(admin);
    return Boolean(owner && actor && owner === actor);
}

function deny(error, code) {
    return { ok: false, error, code };
}

function allow() {
    return { ok: true, error: null, code: null };
}

function inspectLifecycle(admin, doc) {
    if (!doc) return deny('Task not found', 'not_found');
    if (!hasDeletePermission(admin)) {
        return deny('You do not have permission to archive or delete tasks', 'forbidden');
    }
    if (isSuperAdmin(admin)) return allow();
    if (!actorId(admin)) {
        return deny('You can only archive or delete tasks you created', 'not_owner');
    }
    if (!idOf(doc?.createdBy)) {
        return deny('Only Super Admin can change a task with no creator', 'not_owner');
    }
    if (!ownsTask(admin, doc)) {
        return deny('You can only archive or delete tasks you created', 'not_owner');
    }
    return allow();
}

function canArchiveTask(admin, doc) {
    const access = inspectLifecycle(admin, doc);
    if (!access.ok) return access;
    return allow();
}

function canRestoreTask(admin, doc) {
    return inspectLifecycle(admin, doc);
}

function canPurgeTask(admin, doc) {
    return inspectLifecycle(admin, doc);
}

function canChangeFile(admin, file) {
    if (!hasDeletePermission(admin)) {
        return deny('You do not have permission to manage imported files', 'forbidden');
    }
    if (isSuperAdmin(admin)) return allow();
    const uploader = idOf(file?.uploadedBy);
    const actor = actorId(admin);
    if (uploader && actor && uploader === actor) return allow();
    return deny('You can only manage JSON files you uploaded', 'not_owner');
}

module.exports = {
    actorId,
    isSuperAdmin,
    hasDeletePermission,
    ownsTask,
    inspectLifecycle,
    canArchiveTask,
    canRestoreTask,
    canPurgeTask,
    canChangeFile
};
