/**
 * Mongo access for admin tasks and task activity (not audit logs).
 */

const getDBInstance = require('../vornifydb/dbInstance');
const taskService = require('./taskService');

const db = getDBInstance();
const DATABASE_NAME = 'peakmode';
const TASKS = 'admin_tasks';
const ACTIVITY = 'task_activity';

function writableFields(updateFields) {
    if (!updateFields || typeof updateFields !== 'object') return {};
    const { _id, ...rest } = updateFields;
    return rest;
}

async function readTaskDocuments() {
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: TASKS,
        command: '--read',
        data: {}
    });
    if (!result.success || !result.data) return [];
    return (Array.isArray(result.data) ? result.data : [result.data])
        .map(taskService.normalizeId)
        .filter(Boolean);
}

async function readAllTasks() {
    return (await readTaskDocuments()).filter((doc) => !taskService.isArchived(doc));
}

async function readArchivedTasks() {
    return (await readTaskDocuments()).filter((doc) => taskService.isArchived(doc));
}

async function readTaskById(id) {
    const query = taskService.buildLookupQuery(id);
    if (!query) return null;
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: TASKS,
        command: '--read',
        data: query
    });
    if (!result.success || !result.data) return null;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    const row = rows.find((item) => !item.deletedAt) || rows[0];
    return taskService.normalizeId(row);
}

async function updateTaskById(id, updateFields) {
    const query = taskService.buildLookupQuery(id);
    if (!query) return { success: false, error: 'Invalid id' };
    return db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: TASKS,
        command: '--update',
        data: { filter: query, update: writableFields(updateFields) }
    });
}

async function createTask(doc) {
    const createResult = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: TASKS,
        command: '--create',
        data: doc
    });
    if (!createResult.success) return { success: false, error: createResult.error || 'Failed to create task' };
    const insertedId = createResult.data?.insertedId?.toString?.();
    if (insertedId) {
        await updateTaskById(insertedId, { id: insertedId });
    }
    const created = insertedId ? await readTaskById(insertedId) : doc;
    return { success: true, data: created };
}

async function archiveTask(id) {
    const stamp = taskService.nowIso();
    return updateTaskById(id, { archivedAt: stamp, deletedAt: null, updatedAt: stamp });
}

async function restoreTask(id) {
    const stamp = taskService.nowIso();
    return updateTaskById(id, { archivedAt: null, deletedAt: null, updatedAt: stamp });
}

async function createActivity(entry) {
    const createResult = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: ACTIVITY,
        command: '--create',
        data: entry
    });
    if (!createResult.success) return { success: false, error: createResult.error || 'Failed to write activity' };
    const insertedId = createResult.data?.insertedId?.toString?.();
    if (insertedId) {
        await db.executeOperation({
            database_name: DATABASE_NAME,
            collection_name: ACTIVITY,
            command: '--update',
            data: { filter: { _id: insertedId }, update: { id: insertedId } }
        });
    }
    return { success: true, data: { ...entry, id: insertedId } };
}

async function readActivityForTask(taskId) {
    const result = await db.executeOperation({
        database_name: DATABASE_NAME,
        collection_name: ACTIVITY,
        command: '--read',
        data: { taskId: String(taskId) }
    });
    if (!result.success || !result.data) return [];
    return (Array.isArray(result.data) ? result.data : [result.data])
        .map(taskService.normalizeId)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

module.exports = {
    readTaskDocuments,
    readAllTasks,
    readArchivedTasks,
    readTaskById,
    updateTaskById,
    createTask,
    archiveTask,
    restoreTask,
    createActivity,
    readActivityForTask
};
