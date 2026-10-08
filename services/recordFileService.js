/**
 * Admin Records file storage on Cloudinary.
 * Everything lives under peakmode/records/{files|photos}/ — no loose root uploads.
 */

const multer = require('multer');
const path = require('path');
const cloudinary = require('../config/cloudinary');

const ROOT_FOLDER = 'peakmode/records';
const MAX_BYTES = 25 * 1024 * 1024;

const PHOTO_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const FILE_MIME = new Set([
    ...PHOTO_MIME,
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/csv'
]);

function cloudinaryReady() {
    const cfg = cloudinary.config();
    return Boolean(cfg.cloud_name && cfg.api_key && cfg.api_secret);
}

function kindFolder(recordType) {
    return recordType === 'photo' ? 'photos' : 'files';
}

function folderFor(recordType) {
    return `${ROOT_FOLDER}/${kindFolder(recordType)}`;
}

function resourceTypeFor(mimeType, recordType) {
    if (recordType === 'photo' || String(mimeType || '').startsWith('image/')) return 'image';
    return 'raw';
}

function sanitizeFilename(name) {
    const raw = String(name || 'file')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .trim();
    return (raw.slice(0, 220) || 'file').replace(/\s+/g, ' ');
}

function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function assertAllowed(file, recordType) {
    if (!file?.buffer) return { error: 'Choose a file to upload' };
    if (file.size > MAX_BYTES) return { error: 'File is too large (max 25 MB)' };
    const mime = String(file.mimetype || '').toLowerCase();
    if (recordType === 'photo') {
        if (!PHOTO_MIME.has(mime)) return { error: 'Photos must be JPG, PNG, WebP, or GIF' };
    } else if (!FILE_MIME.has(mime)) {
        return { error: 'Unsupported file type. Use PDF, Word, Excel, CSV, text, or an image.' };
    }
    return { ok: true, mime };
}

function uploadBuffer({ buffer, mimeType, originalName, recordType, recordId }) {
    if (!cloudinaryReady()) {
        return Promise.reject(new Error('Cloudinary is not configured'));
    }
    const folder = folderFor(recordType);
    const resource_type = resourceTypeFor(mimeType, recordType);
    const ext = path.extname(String(originalName || '')).replace(/^\./, '').toLowerCase().slice(0, 12);
    const public_id = `rec-${String(recordId).slice(0, 64)}-${Date.now()}`;

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                public_id,
                resource_type,
                overwrite: false,
                unique_filename: false,
                use_filename: false
            },
            (error, result) => {
                if (error) return reject(error);
                resolve({
                    cloudinaryPublicId: result.public_id,
                    fileUrl: result.secure_url,
                    bytes: result.bytes || buffer.length,
                    format: result.format || ext || null,
                    resourceType: resource_type,
                    folder
                });
            }
        );
        stream.end(buffer);
    });
}

async function destroyAsset(publicId, resourceType = 'raw') {
    if (!publicId || !cloudinaryReady()) return { success: true, skipped: true };
    try {
        await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType === 'image' ? 'image' : 'raw'
        });
        return { success: true };
    } catch (error) {
        console.warn('[RECORDS] Cloudinary destroy failed:', error.message);
        return { success: false, error: error.message };
    }
}

async function readRemote(fileUrl) {
    if (!fileUrl) throw new Error('No file stored for this record');
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error('Could not read the stored file');
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES }
}).single('file');

module.exports = {
    ROOT_FOLDER,
    MAX_BYTES,
    cloudinaryReady,
    folderFor,
    resourceTypeFor,
    sanitizeFilename,
    formatBytes,
    assertAllowed,
    uploadBuffer,
    destroyAsset,
    readRemote,
    uploadMiddleware
};
