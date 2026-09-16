/**
 * Run: node scripts/testTaskImport.js
 */
const assert = require('assert');
const taskImportService = require('../services/taskImportService');
const taskExportService = require('../services/taskExportService');
const taskService = require('../services/taskService');

const staff = [
    { id: 'a1', name: 'Alex', email: 'alex@peakmode.se' },
    { id: 'j1', name: 'John', email: 'john@peakmode.se' },
    { id: 'j2', name: 'Jordan', email: 'jordan@peakmode.se' }
];

function envelope(tasks, extras = {}) {
    return JSON.stringify({
        format: 'peakmode.tasks',
        version: '1.0.0',
        ...extras,
        tasks
    });
}

const sampleTask = {
    title: 'Update homepage',
    description: 'Refresh homepage content',
    status: 'todo',
    priority: 'high',
    category: 'website',
    assignee: 'john@peakmode.se',
    startDate: '2026-09-15',
    dueDate: '2026-09-20',
    tags: ['website', 'marketing'],
    checklist: [{ title: 'Prepare content', done: false }]
};

const envelopeOk = taskImportService.buildPreview(envelope([sampleTask]), staff, []);
assert.strictEqual(envelopeOk.ok, true, 'envelope 1.0.0 should preview');
assert.strictEqual(envelopeOk.summary.ready, 1);
assert.strictEqual(envelopeOk.rows[0].assigneeEmail, 'john@peakmode.se');

const rawArray = taskImportService.buildPreview(JSON.stringify([sampleTask]), staff, []);
assert.strictEqual(rawArray.ok, true, 'raw array should be accepted');
assert.strictEqual(rawArray.inferred, true);

const wrongFormat = taskImportService.buildPreview(JSON.stringify({
    format: 'peakmode.orders',
    version: '1.0.0',
    tasks: [sampleTask]
}), staff, []);
assert.strictEqual(wrongFormat.ok, false);
assert.strictEqual(wrongFormat.code, 'unsupported_format');

const v2 = taskImportService.buildPreview(JSON.stringify({
    format: 'peakmode.tasks',
    version: '2.0.0',
    tasks: [sampleTask]
}), staff, []);
assert.strictEqual(v2.ok, false);
assert.strictEqual(v2.code, 'unsupported_version');

const malformed = taskImportService.buildPreview('{not json', staff, []);
assert.strictEqual(malformed.ok, false);
assert.strictEqual(malformed.code, 'malformed');

const empty = taskImportService.buildPreview('   ', staff, []);
assert.strictEqual(empty.code, 'empty');

const proto = taskImportService.parseEnvelope('{"format":"peakmode.tasks","version":"1.0.0","__proto__":{"polluted":true},"tasks":[]}');
assert.strictEqual(proto.ok, true);
assert.strictEqual(Object.prototype.polluted, undefined);

const tooMany = taskImportService.parseEnvelope(JSON.stringify({
    format: 'peakmode.tasks',
    version: '1.0.0',
    tasks: Array.from({ length: 201 }, (_, i) => ({ title: `Task ${i}` }))
}));
assert.strictEqual(tooMany.code, 'too_many');

const unknownAssignee = taskImportService.buildPreview(envelope([{
    title: 'Need a person',
    assignee: 'ghost@peakmode.se'
}]), staff, []);
assert.strictEqual(unknownAssignee.rows[0].result, 'error');
assert.match(unknownAssignee.rows[0].error, /Unknown assignee/i);

const remapped = taskImportService.prepareCommit(envelope([{
    title: 'Need a person',
    assignee: 'ghost@peakmode.se'
}]), staff, [], {
    assigneeRemap: { 0: 'alex@peakmode.se' },
    canAssign: true
});
assert.strictEqual(remapped.rows[0].result, 'ready');
assert.strictEqual(remapped.rows[0].assigneeEmail, 'alex@peakmode.se');

const skipped = taskImportService.prepareCommit(envelope([sampleTask, { title: 'Broken', status: 'nope' }]), staff, [], {
    skip: [1],
    canAssign: true
});
assert.strictEqual(skipped.rows[1].result, 'skipped');
assert.strictEqual(skipped.summary.skipped, 1);

const noAssign = taskImportService.prepareCommit(envelope([sampleTask]), staff, [], { canAssign: false });
assert.strictEqual(noAssign.rows[0].assigneeId, null);
assert.strictEqual(noAssign.rows[0].result, 'warning');

const aliases = taskImportService.buildPreview(envelope([{
    title: 'Aliases',
    status: 'in progress',
    priority: 'critical',
    category: 'support',
    assignedTo: 'john@peakmode.se',
    checklist: [{ title: 'One', completed: true }]
}]), staff, []);
assert.strictEqual(aliases.rows[0].status, 'in_progress');
assert.strictEqual(aliases.rows[0].priority, 'urgent');
assert.strictEqual(aliases.rows[0].category, 'customer_support');
assert.strictEqual(aliases.rows[0].payload.checklist[0].done, true);

const existingTitle = taskImportService.buildPreview(envelope([sampleTask]), staff, ['Update homepage']);
assert.ok(existingTitle.rows[0].warnings.some((w) => /already exists/i.test(w)));

const doc = {
    id: 't1',
    title: 'Update homepage',
    description: 'Refresh homepage content',
    status: 'todo',
    priority: 'high',
    category: 'website',
    assignee: { id: 'j1', name: 'John', email: 'john@peakmode.se' },
    createdBy: { id: 'a1', name: 'Alex', email: 'alex@peakmode.se' },
    startDate: '2026-09-15T12:00:00.000Z',
    dueDate: '2026-09-20T12:00:00.000Z',
    tags: ['website'],
    checklist: [{ id: 'c1', title: 'Prepare content', done: false }],
    archivedAt: null,
    deletedAt: null,
    importBatchId: 'should-not-export'
};
const exported = taskExportService.toEnvelope([doc]);
assert.strictEqual(exported.format, 'peakmode.tasks');
assert.strictEqual(exported.version, '1.0.0');
assert.strictEqual(exported.tasks[0].assignee, 'john@peakmode.se');
assert.strictEqual(exported.tasks[0].id, undefined);
assert.strictEqual(exported.tasks[0].createdBy, undefined);
assert.strictEqual(exported.tasks[0].deletedAt, undefined);
assert.strictEqual(exported.tasks[0].importBatchId, undefined);

const roundTrip = taskImportService.buildPreview(JSON.stringify(exported), staff, []);
assert.strictEqual(roundTrip.ok, true);
assert.strictEqual(roundTrip.summary.ready + roundTrip.summary.warnings, 1);
assert.notStrictEqual(roundTrip.rows[0].result, 'error');

const markdown = taskExportService.toMarkdown([doc]);
assert.match(markdown, /^# Peak Mode Tasks/m);
assert.match(markdown, /## Update homepage/);
assert.doesNotMatch(markdown, /%PDF/);
assert.doesNotMatch(markdown, /createdBy/);

assert.strictEqual(taskService.isArchived({ archivedAt: '2026-09-15T00:00:00.000Z' }), true);
assert.strictEqual(taskService.isArchived({ deletedAt: '2026-09-15T00:00:00.000Z' }), true);
assert.strictEqual(taskService.isArchived({ archivedAt: null, deletedAt: null }), false);
assert.strictEqual(taskService.matchesView({ archivedAt: 'x', status: 'todo' }, 'archived'), true);
assert.strictEqual(taskService.matchesView({ archivedAt: 'x', status: 'todo', assignee: { id: 'a' } }, 'mine', 'a'), false);
assert.strictEqual(taskService.activityLabel({ action: 'imported', actorName: 'Alex' }), 'Alex imported this task from JSON');
assert.match(taskService.activityLabel({ action: 'restored', actorName: 'Alex' }), /Archives/);

const publicTask = taskService.toPublic({ ...doc, archivedAt: '2026-09-15T00:00:00.000Z' });
assert.strictEqual(publicTask.archived, true);
assert.ok(publicTask.archivedAt);
assert.strictEqual(taskService.toPublic({ ...doc, importBatchId: 'batch-1' }).importBatchId, 'batch-1');
assert.strictEqual(
    taskService.matchesFilters({ title: 'A', importBatchId: 'batch-1' }, { importBatchId: 'batch-1' }),
    true
);
assert.strictEqual(
    taskService.matchesFilters({ title: 'A', importBatchId: 'batch-1' }, { importBatchId: 'other' }),
    false
);

const taskFileService = require('../services/taskFileService');
assert.strictEqual(taskFileService.sanitizeFilename('tasks1.json'), 'tasks1.json');
assert.strictEqual(taskFileService.sanitizeFilename('weird/name?.txt'), 'weird-name-.txt.json');
const filePublic = taskFileService.toPublic(
    {
        id: 'f1',
        filename: 'tasks1.json',
        bytes: 1200,
        importBatchId: 'batch-1',
        cloudinaryPublicId: 'peakmode/tasks/import-batch-1',
        created: 4,
        skipped: 1,
        failed: 0
    },
    { liveCount: 3, archivedCount: 1 }
);
assert.strictEqual(filePublic.storage, 'cloudinary');
assert.strictEqual(filePublic.liveCount, 3);
assert.strictEqual(filePublic.source, undefined);

const counts = taskFileService.countsForBatch([
    { importBatchId: 'batch-1', archivedAt: null },
    { importBatchId: 'batch-1', archivedAt: '2026-09-16T00:00:00.000Z' },
    { importBatchId: 'other' }
], 'batch-1');
assert.strictEqual(counts.liveCount, 1);
assert.strictEqual(counts.archivedCount, 1);
assert.strictEqual(counts.tasks.length, 2);

console.log('task import/export tests passed');
