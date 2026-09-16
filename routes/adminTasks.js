const crypto = require('crypto');
const express = require('express');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { requirePermission, requireAnyPermission } = require('../middleware/requirePermission');
const { hasPermission } = require('../services/staffAccessPolicy');
const { listAdmins, loadAdminById, adminIdString, resolveAccountStatus } = require('../services/adminAccountState');
const taskService = require('../services/taskService');
const taskStore = require('../services/taskStore');
const taskImportService = require('../services/taskImportService');
const taskExportService = require('../services/taskExportService');
const taskFileService = require('../services/taskFileService');
const taskAccess = require('../services/taskAccess');

const router = express.Router();

function actor(req) {
    return taskService.actorPerson(req.admin);
}

function queryOf(req) {
    return {
        view: taskService.VIEWS.includes(String(req.query.view || '')) ? String(req.query.view) : 'all',
        q: String(req.query.q || '').trim(),
        status: taskService.STATUSES.includes(String(req.query.status || '')) ? String(req.query.status) : '',
        priority: taskService.PRIORITIES.includes(String(req.query.priority || '')) ? String(req.query.priority) : '',
        category: taskService.CATEGORIES.includes(String(req.query.category || '')) ? String(req.query.category) : '',
        assigneeId: String(req.query.assigneeId || '').trim(),
        createdById: String(req.query.createdById || '').trim(),
        tag: String(req.query.tag || '').trim(),
        importBatchId: String(req.query.importBatchId || '').trim(),
        sort: String(req.query.sort || 'recent')
    };
}

function catalog() {
    return {
        statuses: taskService.STATUSES,
        priorities: taskService.PRIORITIES,
        categories: taskService.CATEGORIES,
        views: taskService.VIEWS,
        statusLabels: taskService.STATUS_LABELS,
        priorityLabels: taskService.PRIORITY_LABELS,
        categoryLabels: taskService.CATEGORY_LABELS
    };
}

function parseIds(value) {
    return String(value || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 200);
}

function parseIdList(value) {
    if (Array.isArray(value)) {
        return [...new Set(value.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 200);
    }
    return parseIds(value);
}

function denyAccess(res, decision) {
    res.status(decision.code === 'not_found' ? 404 : 403).json({
        success: false,
        error: decision.error,
        code: decision.code
    });
}

async function purgeTaskDocument(doc) {
    await taskStore.deleteActivityForTask(doc.id);
    return taskStore.deleteTaskById(doc.id);
}

async function resolveAssignee(assigneeId) {
    if (assigneeId === null || assigneeId === '' || assigneeId === 'unassigned' || assigneeId === undefined) {
        return { person: null };
    }
    const admin = await loadAdminById(String(assigneeId));
    if (!admin) return { error: 'Assignee not found' };
    if (resolveAccountStatus(admin) !== 'active') return { error: 'Assignee is not an active staff member' };
    return {
        person: taskService.actorPerson({
            id: adminIdString(admin),
            name: admin.name,
            email: admin.email || admin.username
        })
    };
}

async function loadStaff() {
    const admins = await listAdmins();
    return admins
        .filter((admin) => resolveAccountStatus(admin) === 'active')
        .map((admin) => ({
            id: adminIdString(admin),
            name: admin.name || admin.email || admin.username || 'Staff',
            email: admin.email || admin.username || null,
            role: admin.role || 'admin'
        }));
}

function rejectIfMissing(doc, res) {
    if (!doc) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return true;
    }
    return false;
}

function rejectIfArchived(doc, res) {
    if (taskService.isArchived(doc)) {
        res.status(409).json({ success: false, error: 'Restore this task from Archives before editing it' });
        return true;
    }
    return false;
}

router.get('/', authenticateAdmin, requirePermission('tasks.view'), async (req, res) => {
    try {
        const query = queryOf(req);
        const actorId = String(req.admin.id);
        const documents = await taskStore.readTaskDocuments();
        const active = documents.filter((doc) => !taskService.isArchived(doc));
        const archived = documents.filter((doc) => taskService.isArchived(doc));
        const stats = { ...taskService.computeStats(active, actorId), archived: archived.length };
        const pool = query.view === 'archived' ? archived : active;
        const filtered = taskService.sortTasks(
            pool.filter((doc) => taskService.matchesView(doc, query.view, actorId) && taskService.matchesFilters(doc, query)),
            query.sort
        );
        res.json({
            success: true,
            items: filtered.map(taskService.toPublic),
            stats,
            catalog: catalog()
        });
    } catch (err) {
        console.error('[TASKS] list error:', err);
        res.status(500).json({ success: false, error: 'Failed to list tasks' });
    }
});

router.get('/assignees', authenticateAdmin, requireAnyPermission('tasks.view', 'tasks.assign'), async (_req, res) => {
    try {
        const items = (await loadStaff()).sort((a, b) => a.name.localeCompare(b.name));
        res.json({ success: true, items });
    } catch (err) {
        console.error('[TASKS] assignees error:', err);
        res.status(500).json({ success: false, error: 'Failed to list assignees' });
    }
});

router.get('/export', authenticateAdmin, requirePermission('tasks.view'), async (req, res) => {
    try {
        const query = queryOf(req);
        const ids = parseIds(req.query.ids);
        const format = String(req.query.format || 'json').toLowerCase() === 'markdown' ? 'markdown' : 'json';
        const documents = await taskStore.readTaskDocuments();
        let rows;
        if (ids.length) {
            const wanted = new Set(ids);
            rows = documents.filter((doc) => wanted.has(String(doc.id)));
        } else {
            const pool = query.view === 'archived' ? documents.filter((doc) => taskService.isArchived(doc)) : documents.filter((doc) => !taskService.isArchived(doc));
            rows = taskService.sortTasks(
                pool.filter((doc) => taskService.matchesView(doc, query.view, req.admin.id) && taskService.matchesFilters(doc, query)),
                query.sort
            );
        }
        const stamp = new Date().toISOString().slice(0, 10);
        if (format === 'markdown') {
            const body = taskExportService.toMarkdown(rows);
            const filename = `peakmode-tasks-${stamp}.md`;
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(body);
        }
        const envelope = taskExportService.toEnvelope(rows);
        const filename = `peakmode-tasks-${stamp}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(JSON.stringify(envelope, null, 2));
    } catch (err) {
        console.error('[TASKS] export error:', err);
        res.status(500).json({ success: false, error: 'Failed to export tasks' });
    }
});

router.post('/import/preview', authenticateAdmin, requireAnyPermission('tasks.create', 'tasks.manage'), async (req, res) => {
    try {
        const source = req.body?.source;
        if (source == null || source === '') {
            return res.status(400).json({ success: false, error: 'Choose a JSON file to import' });
        }
        const staff = await loadStaff();
        const openTitles = (await taskStore.readAllTasks()).filter(taskService.isOpen).map((doc) => doc.title);
        const preview = taskImportService.buildPreview(source, staff, openTitles);
        if (!preview.ok) {
            return res.status(400).json({
                success: false,
                code: preview.code,
                error: preview.error,
                summary: preview.summary,
                rows: []
            });
        }
        res.json({
            success: true,
            inferred: preview.inferred,
            format: preview.format,
            version: preview.version,
            summary: preview.summary,
            rows: preview.rows.map(taskImportService.toPreviewPublic)
        });
    } catch (err) {
        console.error('[TASKS] import preview error:', err);
        res.status(500).json({ success: false, error: 'Failed to preview import' });
    }
});

router.post('/import', authenticateAdmin, requireAnyPermission('tasks.create', 'tasks.manage'), async (req, res) => {
    try {
        const source = req.body?.source;
        if (source == null || source === '') {
            return res.status(400).json({ success: false, error: 'Choose a JSON file to import' });
        }
        const filename = String(req.body?.filename || 'tasks.json').slice(0, 180);
        const staff = await loadStaff();
        const openTitles = (await taskStore.readAllTasks()).filter(taskService.isOpen).map((doc) => doc.title);
        const plan = taskImportService.prepareCommit(source, staff, openTitles, {
            skip: Array.isArray(req.body?.skip) ? req.body.skip : [],
            assigneeRemap: req.body?.assigneeRemap && typeof req.body.assigneeRemap === 'object' ? req.body.assigneeRemap : {},
            canAssign: hasPermission(req.admin.permissions, 'tasks.assign') || hasPermission(req.admin.permissions, 'tasks.manage')
        });
        if (!plan.ok) {
            return res.status(400).json({
                success: false,
                code: plan.code,
                error: plan.error,
                summary: plan.summary,
                created: 0,
                skipped: 0,
                failed: 0
            });
        }

        const importBatchId = crypto.randomUUID();
        const created = [];
        const failed = [];
        for (const row of plan.rows) {
            if (row.result === 'skipped') continue;
            if (row.result === 'error' || !row.payload) {
                failed.push({ index: row.index, title: row.title, error: row.error || 'Could not import this task' });
                continue;
            }
            const doc = taskService.newDocumentDefaults({ ...row.payload, importBatchId }, actor(req));
            const check = taskService.validateTask(doc);
            if (!check.ok) {
                failed.push({ index: row.index, title: row.title, error: check.error });
                continue;
            }
            const saved = await taskStore.createTask(doc);
            if (!saved.success || !saved.data?.id) {
                failed.push({ index: row.index, title: row.title, error: saved.error || 'Could not create task' });
                continue;
            }
            await taskStore.createActivity(taskService.activityEntry(saved.data.id, actor(req), 'imported', {
                filename,
                importBatchId
            }));
            if (saved.data.assignee?.id) {
                await taskStore.createActivity(taskService.activityEntry(saved.data.id, actor(req), 'assigned', {
                    to: saved.data.assignee.id,
                    toName: saved.data.assignee.name
                }));
            }
            created.push(taskService.toPublic(saved.data));
        }

        let storedFile = null;
        try {
            const fileDoc = await taskFileService.persistImport({
                source,
                filename,
                importBatchId,
                actor: actor(req),
                format: plan.format,
                version: plan.version,
                created: created.length,
                skipped: plan.summary.skipped,
                failed: failed.length
            });
            const savedFile = await taskStore.createTaskFile(fileDoc);
            if (savedFile.success) storedFile = taskFileService.toPublic(savedFile.data || fileDoc);
        } catch (fileError) {
            console.warn('[TASKS] Could not store import file:', fileError.message);
        }

        res.status(created.length ? 201 : 200).json({
            success: true,
            importBatchId,
            created: created.length,
            skipped: plan.summary.skipped,
            failed: failed.length,
            errors: failed,
            items: created,
            summary: plan.summary,
            file: storedFile
        });
    } catch (err) {
        console.error('[TASKS] import error:', err);
        res.status(500).json({ success: false, error: 'Failed to import tasks' });
    }
});

function fileWithCounts(file, documents) {
    const counts = taskFileService.countsForBatch(documents, file.importBatchId);
    return taskFileService.toPublic(file, counts);
}

async function loadFileOr404(req, res) {
    const file = await taskStore.readTaskFileById(req.params.id);
    if (!file) {
        res.status(404).json({ success: false, error: 'File not found' });
        return null;
    }
    return file;
}

router.get('/files', authenticateAdmin, requirePermission('tasks.view'), async (_req, res) => {
    try {
        const [files, documents] = await Promise.all([taskStore.readTaskFiles(), taskStore.readTaskDocuments()]);
        res.json({
            success: true,
            items: files.map((file) => fileWithCounts(file, documents))
        });
    } catch (err) {
        console.error('[TASKS] files list error:', err);
        res.status(500).json({ success: false, error: 'Failed to list uploaded files' });
    }
});

router.get('/files/:id/download', authenticateAdmin, requirePermission('tasks.view'), async (req, res) => {
    try {
        const file = await loadFileOr404(req, res);
        if (!file) return;
        const body = await taskFileService.readFileBody(file);
        const filename = taskFileService.sanitizeFilename(file.filename);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(body);
    } catch (err) {
        console.error('[TASKS] file download error:', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to download file' });
    }
});

router.post('/files/:id/archive-tasks', authenticateAdmin, requireAnyPermission('tasks.delete', 'tasks.manage'), async (req, res) => {
    try {
        const file = await loadFileOr404(req, res);
        if (!file) return;
        const fileAccess = taskAccess.canChangeFile(req.admin, file);
        if (!fileAccess.ok) return denyAccess(res, fileAccess);
        const documents = await taskStore.readTaskDocuments();
        const linked = taskFileService.countsForBatch(documents, file.importBatchId).tasks;
        let archived = 0;
        let skipped = 0;
        for (const task of linked) {
            if (taskService.isArchived(task)) continue;
            const access = taskAccess.canArchiveTask(req.admin, task);
            if (!access.ok) {
                skipped += 1;
                continue;
            }
            await taskStore.archiveTask(task.id);
            await taskStore.createActivity(taskService.activityEntry(task.id, actor(req), 'archived', {
                filename: file.filename,
                importBatchId: file.importBatchId
            }));
            archived += 1;
        }
        const next = await taskStore.readTaskDocuments();
        res.json({ success: true, archived, skipped, data: fileWithCounts(file, next) });
    } catch (err) {
        console.error('[TASKS] archive file tasks error:', err);
        res.status(500).json({ success: false, error: 'Failed to archive tasks from this file' });
    }
});

router.post('/files/:id/restore-tasks', authenticateAdmin, requireAnyPermission('tasks.delete', 'tasks.manage'), async (req, res) => {
    try {
        const file = await loadFileOr404(req, res);
        if (!file) return;
        const fileAccess = taskAccess.canChangeFile(req.admin, file);
        if (!fileAccess.ok) return denyAccess(res, fileAccess);
        const documents = await taskStore.readTaskDocuments();
        const linked = taskFileService.countsForBatch(documents, file.importBatchId).tasks;
        let restored = 0;
        let skipped = 0;
        for (const task of linked) {
            if (!taskService.isArchived(task)) continue;
            const access = taskAccess.canRestoreTask(req.admin, task);
            if (!access.ok) {
                skipped += 1;
                continue;
            }
            await taskStore.restoreTask(task.id);
            await taskStore.createActivity(taskService.activityEntry(task.id, actor(req), 'restored', {
                filename: file.filename,
                importBatchId: file.importBatchId
            }));
            restored += 1;
        }
        const next = await taskStore.readTaskDocuments();
        res.json({ success: true, restored, skipped, data: fileWithCounts(file, next) });
    } catch (err) {
        console.error('[TASKS] restore file tasks error:', err);
        res.status(500).json({ success: false, error: 'Failed to restore tasks from this file' });
    }
});

router.delete('/files/:id', authenticateAdmin, requireAnyPermission('tasks.delete', 'tasks.manage'), async (req, res) => {
    try {
        const file = await loadFileOr404(req, res);
        if (!file) return;
        const fileAccess = taskAccess.canChangeFile(req.admin, file);
        if (!fileAccess.ok) return denyAccess(res, fileAccess);
        const withTasks = req.query.withTasks === '1' || req.body?.withTasks === true;
        let deletedTasks = 0;
        let skipped = 0;
        if (withTasks && file.importBatchId) {
            const documents = await taskStore.readTaskDocuments();
            const linked = taskFileService.countsForBatch(documents, file.importBatchId).tasks;
            const blocked = linked.filter((task) => !taskAccess.canPurgeTask(req.admin, task).ok);
            if (blocked.length && !taskAccess.isSuperAdmin(req.admin)) {
                return res.status(403).json({
                    success: false,
                    code: 'not_owner',
                    error: 'This file still has tasks created by someone else. Delete the file only, or ask Super Admin to remove those tasks.'
                });
            }
            for (const task of linked) {
                const access = taskAccess.canPurgeTask(req.admin, task);
                if (!access.ok) {
                    skipped += 1;
                    continue;
                }
                await purgeTaskDocument(task);
                deletedTasks += 1;
            }
        }
        await taskFileService.destroyRaw(file.cloudinaryPublicId);
        await taskStore.deleteTaskFile(file.id);
        res.json({ success: true, deletedTasks, skipped, fileDeleted: true });
    } catch (err) {
        console.error('[TASKS] delete file error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete this file' });
    }
});

router.post('/bulk-action', authenticateAdmin, requireAnyPermission('tasks.delete', 'tasks.manage'), async (req, res) => {
    try {
        const action = String(req.body?.action || '').trim();
        if (!['archive', 'restore', 'delete'].includes(action)) {
            return res.status(400).json({ success: false, error: 'action must be archive, restore, or delete' });
        }
        const ids = parseIdList(req.body?.ids);
        if (!ids.length) {
            return res.status(400).json({ success: false, error: 'Select at least one task' });
        }
        const updated = [];
        const skipped = [];
        const failed = [];
        for (const id of ids) {
            const existing = await taskStore.readTaskById(id);
            if (!existing) {
                failed.push({ id, error: 'Task not found' });
                continue;
            }
            const access = action === 'restore'
                ? taskAccess.canRestoreTask(req.admin, existing)
                : action === 'archive'
                    ? taskAccess.canArchiveTask(req.admin, existing)
                    : taskAccess.canPurgeTask(req.admin, existing);
            if (!access.ok) {
                skipped.push({ id, title: existing.title, error: access.error, code: access.code });
                continue;
            }
            try {
                if (action === 'archive') {
                    if (taskService.isArchived(existing)) {
                        skipped.push({ id, title: existing.title, error: 'Already in Archives', code: 'already_archived' });
                        continue;
                    }
                    await taskStore.archiveTask(existing.id);
                    await taskStore.createActivity(taskService.activityEntry(existing.id, actor(req), 'archived', {}));
                } else if (action === 'restore') {
                    if (!taskService.isArchived(existing)) {
                        skipped.push({ id, title: existing.title, error: 'This task is not in Archives', code: 'not_archived' });
                        continue;
                    }
                    await taskStore.restoreTask(existing.id);
                    await taskStore.createActivity(taskService.activityEntry(existing.id, actor(req), 'restored', {}));
                } else {
                    await purgeTaskDocument(existing);
                }
                updated.push(id);
            } catch (error) {
                failed.push({ id, title: existing.title, error: error.message || 'Could not update this task' });
            }
        }
        res.json({
            success: true,
            action,
            processed: ids.length,
            updated: updated.length,
            skipped: skipped.length,
            failed: failed.length,
            ids: updated,
            skippedItems: skipped,
            failedItems: failed
        });
    } catch (err) {
        console.error('[TASKS] bulk action error:', err);
        res.status(500).json({ success: false, error: 'Failed to update the selected tasks' });
    }
});

router.get('/:id', authenticateAdmin, requirePermission('tasks.view'), async (req, res) => {
    try {
        const doc = await taskStore.readTaskById(req.params.id);
        if (rejectIfMissing(doc, res)) return;
        const activity = await taskStore.readActivityForTask(doc.id);
        res.json({
            success: true,
            data: {
                ...taskService.toPublic(doc),
                activity: activity.map(taskService.toActivityPublic)
            }
        });
    } catch (err) {
        console.error('[TASKS] detail error:', err);
        res.status(500).json({ success: false, error: 'Failed to load task' });
    }
});

router.post('/', authenticateAdmin, requireAnyPermission('tasks.create', 'tasks.manage'), async (req, res) => {
    try {
        const body = req.body || {};
        const assigneeResult = body.assigneeId !== undefined
            ? await resolveAssignee(body.assigneeId === '' || body.assigneeId === 'unassigned' ? null : body.assigneeId)
            : { person: body.assignee ? taskService.person(body.assignee) : null };
        if (assigneeResult?.error) {
            return res.status(400).json({ success: false, error: assigneeResult.error });
        }
        const doc = taskService.newDocumentDefaults(
            { ...body, assignee: assigneeResult?.person === undefined ? body.assignee : assigneeResult.person },
            actor(req)
        );
        const check = taskService.validateTask(doc);
        if (!check.ok) {
            return res.status(400).json({ success: false, error: check.error, fields: check.fields });
        }
        const created = await taskStore.createTask(doc);
        if (!created.success) {
            return res.status(500).json({ success: false, error: created.error });
        }
        await taskStore.createActivity(taskService.activityEntry(created.data.id, actor(req), 'created', {}));
        if (created.data.assignee?.id) {
            await taskStore.createActivity(taskService.activityEntry(created.data.id, actor(req), 'assigned', {
                to: created.data.assignee.id,
                toName: created.data.assignee.name
            }));
        }
        res.status(201).json({ success: true, data: taskService.toPublic(created.data) });
    } catch (err) {
        console.error('[TASKS] create error:', err);
        res.status(500).json({ success: false, error: 'Failed to create task' });
    }
});

router.patch('/:id', authenticateAdmin, requireAnyPermission('tasks.edit', 'tasks.assign', 'tasks.complete', 'tasks.manage'), async (req, res) => {
    try {
        const existing = await taskStore.readTaskById(req.params.id);
        if (rejectIfMissing(existing, res) || rejectIfArchived(existing, res)) return;
        const body = { ...(req.body || {}) };
        if (body.assigneeId !== undefined) {
            const resolved = await resolveAssignee(body.assigneeId === '' || body.assigneeId === 'unassigned' ? null : body.assigneeId);
            if (resolved?.error) return res.status(400).json({ success: false, error: resolved.error });
            body.assignee = resolved.person === undefined ? null : resolved.person;
            delete body.assigneeId;
        }
        if (!taskService.patchPermissionOk(req.admin.permissions, body, hasPermission)) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to perform this action',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }
        const next = taskService.applyPatch(existing, body);
        const check = taskService.validateTask(next);
        if (!check.ok) {
            return res.status(400).json({ success: false, error: check.error, fields: check.fields });
        }
        await taskStore.updateTaskById(existing.id, next);
        const updated = await taskStore.readTaskById(existing.id);
        const events = taskService.diffActivity(existing, updated, actor(req));
        for (const event of events) {
            await taskStore.createActivity(event);
        }
        const activity = await taskStore.readActivityForTask(existing.id);
        res.json({
            success: true,
            data: { ...taskService.toPublic(updated), activity: activity.map(taskService.toActivityPublic) }
        });
    } catch (err) {
        console.error('[TASKS] update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update task' });
    }
});

router.post('/:id/complete', authenticateAdmin, requireAnyPermission('tasks.complete', 'tasks.manage'), async (req, res) => {
    try {
        const existing = await taskStore.readTaskById(req.params.id);
        if (rejectIfMissing(existing, res) || rejectIfArchived(existing, res)) return;
        const next = taskService.applyPatch(existing, { status: 'completed' });
        await taskStore.updateTaskById(existing.id, next);
        const updated = await taskStore.readTaskById(existing.id);
        await taskStore.createActivity(taskService.activityEntry(existing.id, actor(req), 'completed', {
            from: existing.status,
            to: 'completed'
        }));
        res.json({ success: true, data: taskService.toPublic(updated) });
    } catch (err) {
        console.error('[TASKS] complete error:', err);
        res.status(500).json({ success: false, error: 'Failed to complete task' });
    }
});

router.post('/:id/restore', authenticateAdmin, requireAnyPermission('tasks.delete', 'tasks.manage'), async (req, res) => {
    try {
        const existing = await taskStore.readTaskById(req.params.id);
        if (rejectIfMissing(existing, res)) return;
        const access = taskAccess.canRestoreTask(req.admin, existing);
        if (!access.ok) return denyAccess(res, access);
        if (!taskService.isArchived(existing)) {
            return res.status(400).json({ success: false, error: 'This task is not in Archives' });
        }
        await taskStore.restoreTask(existing.id);
        await taskStore.createActivity(taskService.activityEntry(existing.id, actor(req), 'restored', {}));
        const updated = await taskStore.readTaskById(existing.id);
        res.json({ success: true, data: taskService.toPublic(updated) });
    } catch (err) {
        console.error('[TASKS] restore error:', err);
        res.status(500).json({ success: false, error: 'Failed to restore task' });
    }
});

router.post('/:id/purge', authenticateAdmin, requireAnyPermission('tasks.delete', 'tasks.manage'), async (req, res) => {
    try {
        const existing = await taskStore.readTaskById(req.params.id);
        if (rejectIfMissing(existing, res)) return;
        const access = taskAccess.canPurgeTask(req.admin, existing);
        if (!access.ok) return denyAccess(res, access);
        await purgeTaskDocument(existing);
        res.json({ success: true });
    } catch (err) {
        console.error('[TASKS] purge error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete task' });
    }
});

router.post('/:id/checklist', authenticateAdmin, requireAnyPermission('tasks.edit', 'tasks.manage'), async (req, res) => {
    try {
        const existing = await taskStore.readTaskById(req.params.id);
        if (rejectIfMissing(existing, res) || rejectIfArchived(existing, res)) return;
        const title = String(req.body?.title || '').trim();
        if (!title) return res.status(400).json({ success: false, error: 'Checklist title is required' });
        const item = {
            id: taskService.newId('chk'),
            title: title.slice(0, 200),
            done: false,
            sort: (existing.checklist || []).length,
            completedAt: null
        };
        const checklist = [...(existing.checklist || []), item];
        await taskStore.updateTaskById(existing.id, { checklist, updatedAt: taskService.nowIso() });
        await taskStore.createActivity(taskService.activityEntry(existing.id, actor(req), 'checklist_added', { title: item.title }));
        const updated = await taskStore.readTaskById(existing.id);
        res.status(201).json({ success: true, data: taskService.toPublic(updated) });
    } catch (err) {
        console.error('[TASKS] checklist add error:', err);
        res.status(500).json({ success: false, error: 'Failed to add checklist item' });
    }
});

router.patch('/:id/checklist/:itemId', authenticateAdmin, requireAnyPermission('tasks.edit', 'tasks.complete', 'tasks.manage'), async (req, res) => {
    try {
        const existing = await taskStore.readTaskById(req.params.id);
        if (rejectIfMissing(existing, res) || rejectIfArchived(existing, res)) return;
        const itemId = String(req.params.itemId);
        const checklist = (existing.checklist || []).map((item) => {
            if (item.id !== itemId) return item;
            const done = req.body?.done !== undefined ? Boolean(req.body.done) : item.done;
            const title = req.body?.title !== undefined ? String(req.body.title).trim().slice(0, 200) : item.title;
            return {
                ...item,
                title: title || item.title,
                done,
                completedAt: done ? item.completedAt || taskService.nowIso() : null
            };
        });
        const changed = (existing.checklist || []).find((item) => item.id === itemId);
        const nextItem = checklist.find((item) => item.id === itemId);
        if (!changed || !nextItem) return res.status(404).json({ success: false, error: 'Checklist item not found' });
        await taskStore.updateTaskById(existing.id, { checklist, updatedAt: taskService.nowIso() });
        if (changed.done !== nextItem.done) {
            await taskStore.createActivity(taskService.activityEntry(existing.id, actor(req), 'checklist_toggled', {
                title: nextItem.title,
                done: nextItem.done
            }));
        }
        const updated = await taskStore.readTaskById(existing.id);
        res.json({ success: true, data: taskService.toPublic(updated) });
    } catch (err) {
        console.error('[TASKS] checklist update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update checklist item' });
    }
});

router.delete('/:id/checklist/:itemId', authenticateAdmin, requireAnyPermission('tasks.edit', 'tasks.manage'), async (req, res) => {
    try {
        const existing = await taskStore.readTaskById(req.params.id);
        if (rejectIfMissing(existing, res) || rejectIfArchived(existing, res)) return;
        const itemId = String(req.params.itemId);
        const removed = (existing.checklist || []).find((item) => item.id === itemId);
        if (!removed) return res.status(404).json({ success: false, error: 'Checklist item not found' });
        const checklist = (existing.checklist || []).filter((item) => item.id !== itemId);
        await taskStore.updateTaskById(existing.id, { checklist, updatedAt: taskService.nowIso() });
        await taskStore.createActivity(taskService.activityEntry(existing.id, actor(req), 'checklist_removed', { title: removed.title }));
        const updated = await taskStore.readTaskById(existing.id);
        res.json({ success: true, data: taskService.toPublic(updated) });
    } catch (err) {
        console.error('[TASKS] checklist delete error:', err);
        res.status(500).json({ success: false, error: 'Failed to remove checklist item' });
    }
});

router.delete('/:id', authenticateAdmin, requireAnyPermission('tasks.delete', 'tasks.manage'), async (req, res) => {
    try {
        const existing = await taskStore.readTaskById(req.params.id);
        if (rejectIfMissing(existing, res)) return;
        const access = taskAccess.canArchiveTask(req.admin, existing);
        if (!access.ok) return denyAccess(res, access);
        if (taskService.isArchived(existing)) {
            return res.status(400).json({ success: false, error: 'This task is already in Archives' });
        }
        await taskStore.archiveTask(existing.id);
        await taskStore.createActivity(taskService.activityEntry(existing.id, actor(req), 'archived', {}));
        res.json({ success: true });
    } catch (err) {
        console.error('[TASKS] archive error:', err);
        res.status(500).json({ success: false, error: 'Failed to archive task' });
    }
});

module.exports = router;
