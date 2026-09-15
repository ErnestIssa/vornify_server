/**
 * Build Peak Mode task export files (JSON envelope + Markdown).
 */

const taskService = require('./taskService');

const FORMAT = 'peakmode.tasks';
const VERSION = '1.0.0';

function dateOnly(iso) {
    if (!iso) return null;
    return String(iso).slice(0, 10);
}

function toExportTask(doc) {
    const publicTask = taskService.toPublic(doc);
    const checklist = (publicTask.checklist || []).map((item) => ({
        title: item.title,
        done: Boolean(item.done)
    }));
    const row = {
        title: publicTask.title,
        description: publicTask.description || '',
        status: publicTask.status,
        priority: publicTask.priority,
        category: publicTask.category,
        startDate: dateOnly(publicTask.startDate),
        dueDate: dateOnly(publicTask.dueDate),
        tags: publicTask.tags || [],
        checklist
    };
    if (publicTask.assignee?.email) row.assignee = publicTask.assignee.email;
    return row;
}

function toEnvelope(docs) {
    return {
        format: FORMAT,
        version: VERSION,
        exportedAt: taskService.nowIso(),
        tasks: docs.map(toExportTask)
    };
}

function formatHumanDate(iso) {
    if (!iso) return 'None';
    return new Date(iso).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    });
}

function toMarkdown(docs) {
    const exported = new Date().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
    const lines = ['# Peak Mode Tasks', '', `Exported: ${exported}`, ''];
    if (!docs.length) {
        lines.push('_No tasks in this export._', '');
        return lines.join('\n');
    }
    for (const doc of docs) {
        const task = taskService.toPublic(doc);
        const assignee = task.assignee
            ? `${task.assignee.name}${task.assignee.email ? ` (${task.assignee.email})` : ''}`
            : 'Unassigned';
        lines.push(`## ${task.title}`, '');
        lines.push(`Status: ${task.statusLabel} · Priority: ${task.priorityLabel} · Assignee: ${assignee}`);
        lines.push(`Due: ${task.dueDate ? formatHumanDate(task.dueDate) : 'None'}`);
        lines.push('');
        if (task.description) {
            lines.push(task.description, '');
        }
        if (task.checklist.length) {
            lines.push('### Checklist', '');
            for (const item of task.checklist) {
                lines.push(`- [${item.done ? 'x' : ' '}] ${item.title}`);
            }
            lines.push('');
        }
    }
    return lines.join('\n');
}

module.exports = {
    FORMAT,
    VERSION,
    toEnvelope,
    toMarkdown
};
