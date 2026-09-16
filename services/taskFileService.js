/**
 * Persist imported task JSON on Cloudinary (raw) with a VortexDB metadata record.
 * If Cloudinary is unavailable, the JSON is kept inline on the file record (256 KB max).
 */

const crypto = require('crypto');
const cloudinary = require('../config/cloudinary');
const taskService = require('./taskService');

function cloudinaryReady() {
    const cfg = cloudinary.config();
    return Boolean(cfg.cloud_name && cfg.api_key && cfg.api_secret);
}

function sanitizeFilename(name) {
    const raw = String(name || 'tasks.json').replace(/[/\\?%*:|"<>]/g, '-').trim();
    const base = raw.slice(0, 160) || 'tasks.json';
    return base.toLowerCase().endsWith('.json') ? base : `${base}.json`;
}

function toPublic(doc, counts = {}) {
    if (!doc) return null;
    return {
        id: String(doc.id),
        filename: doc.filename || 'tasks.json',
        bytes: Number(doc.bytes) || 0,
        format: doc.format || 'peakmode.tasks',
        version: doc.version || '1.0.0',
        importBatchId: doc.importBatchId || null,
        createdAt: doc.createdAt || null,
        uploadedBy: doc.uploadedBy || null,
        storage: doc.cloudinaryPublicId ? 'cloudinary' : 'inline',
        created: Number(doc.created) || 0,
        skipped: Number(doc.skipped) || 0,
        failed: Number(doc.failed) || 0,
        liveCount: Number(counts.liveCount) || 0,
        archivedCount: Number(counts.archivedCount) || 0
    };
}

async function uploadRawJson(source, importBatchId) {
    if (!cloudinaryReady()) {
        throw new Error('Cloudinary is not configured');
    }
    const dataUri = `data:application/json;base64,${Buffer.from(String(source), 'utf8').toString('base64')}`;
    const result = await cloudinary.uploader.upload(dataUri, {
        resource_type: 'raw',
        folder: 'peakmode/tasks',
        public_id: `import-${String(importBatchId).slice(0, 80)}`,
        overwrite: true,
        unique_filename: false,
        use_filename: false
    });
    return {
        public_id: result.public_id,
        secure_url: result.secure_url,
        bytes: result.bytes
    };
}

async function destroyRaw(publicId) {
    if (!publicId || !cloudinaryReady()) return { success: true, skipped: true };
    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
        return { success: true };
    } catch (error) {
        console.warn('[TASKS] Cloudinary destroy failed:', error.message);
        return { success: false, error: error.message };
    }
}

async function persistImport({ source, filename, importBatchId, actor, format, version, created, skipped, failed }) {
    const bytes = Buffer.byteLength(String(source || ''), 'utf8');
    let cloudinaryPublicId = null;
    let cloudinaryUrl = null;
    let inlineSource = null;
    try {
        const uploaded = await uploadRawJson(source, importBatchId);
        cloudinaryPublicId = uploaded.public_id;
        cloudinaryUrl = uploaded.secure_url;
    } catch (error) {
        console.warn('[TASKS] Cloudinary store failed, keeping an inline copy:', error.message);
        inlineSource = String(source || '');
    }
    return {
        filename: sanitizeFilename(filename),
        bytes,
        format: format || 'peakmode.tasks',
        version: version || '1.0.0',
        importBatchId: String(importBatchId),
        createdAt: taskService.nowIso(),
        uploadedBy: taskService.person(actor) || taskService.actorPerson(null),
        cloudinaryPublicId,
        cloudinaryUrl,
        source: inlineSource,
        created: Number(created) || 0,
        skipped: Number(skipped) || 0,
        failed: Number(failed) || 0
    };
}

async function readFileBody(doc) {
    if (doc?.source) return String(doc.source);
    if (doc?.cloudinaryUrl) {
        const response = await fetch(doc.cloudinaryUrl);
        if (!response.ok) throw new Error('Could not read the stored JSON file');
        return response.text();
    }
    throw new Error('This file is no longer available');
}

function countsForBatch(documents, importBatchId) {
    const batch = String(importBatchId || '');
    const linked = documents.filter((doc) => String(doc.importBatchId || '') === batch);
    return {
        liveCount: linked.filter((doc) => !taskService.isArchived(doc)).length,
        archivedCount: linked.filter((doc) => taskService.isArchived(doc)).length,
        tasks: linked
    };
}

function newFileId() {
    return crypto.randomUUID();
}

module.exports = {
    sanitizeFilename,
    toPublic,
    persistImport,
    destroyRaw,
    readFileBody,
    countsForBatch,
    newFileId,
    cloudinaryReady
};
