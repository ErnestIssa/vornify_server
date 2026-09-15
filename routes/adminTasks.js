const express = require('express');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { requirePermission, requireAnyPermission } = require('../middleware/requirePermission');
const { hasPermission } = require('../services/staffAccessPolicy');
const { listAdmins, loadAdminById, adminIdString, resolveAccountStatus } = require('../services/adminAccountState');
const taskService = require('../services/taskService');
const taskStore = require('../services/taskStore');

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

router.get('/', authenticateAdmin, requirePermission('tasks.view'), async (req, res) => {
    try {
        const query = queryOf(req);
        const actorId = String(req.admin.id);
        const rows = await taskStore.readAllTasks();
        const stats = taskService.computeStats(rows, actorId);
        const filtered = taskService.sortTasks(
            rows.filter((doc) => taskService.matchesView(doc, query.view, actorId) && taskService.matchesFilters(doc, query)),
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
        const admins = await listAdmins();
        const items = admins
            .filter((admin) => resolveAccountStatus(admin) === 'active')
            .map((admin) => ({
                id: adminIdString(admin),
                name: admin.name || admin.email || admin.username || 'Staff',
                email: admin.email || admin.username || null,
                role: admin.role || 'admin'
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        res.json({ success: true, items });
    } catch (err) {
        console.error('[TASKS] assignees error:', err);
        res.status(500).json({ success: false, error: 'Failed to list assignees' });
    }
});

router.get('/:id', authenticateAdmin, requirePermission('tasks.view'), async (req, res) => {
    try {
        const doc = await taskStore.readTaskById(req.params.id);
        if (!doc || doc.deletedAt) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }
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
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }
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
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }
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

router.post('/:id/checklist', authenticateAdmin, requireAnyPermission('tasks.edit', 'tasks.manage'), async (req, res) => {
    try {
        const existing = await taskStore.readTaskById(req.params.id);
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }
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
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }
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
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }
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
        if (!existing || existing.deletedAt) {
            return res.status(404).json({ success: false, error: 'Task not found' });
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
