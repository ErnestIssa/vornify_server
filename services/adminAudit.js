/**
 * Privileged-action audit log (admin_audit_logs).
 * Never pass passwords, tokens, MFA secrets, or recovery codes in metadata.
 */

const getDBInstance = require('../vornifydb/dbInstance');
const logAdminActivity = require('../utils/auditLogger');
const { clientMeta } = require('./adminSessions');

const db = getDBInstance();

const SENSITIVE_KEY = /password|token|secret|recovery|mfa|cookie|authorization|refresh/i;

function sanitizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (SENSITIVE_KEY.test(key)) continue;
        if (typeof value === 'string' && value.length > 2000) {
            out[key] = value.slice(0, 2000);
        } else {
            out[key] = value;
        }
    }
    return out;
}

async function writeAuditLog({
    actorId = null,
    actorEmail = null,
    action,
    resource = null,
    resourceId = null,
    metadata = {},
    req = null,
    success = true
}) {
    if (!action) return;
    const meta = req ? clientMeta(req) : { ip: 'unknown', userAgent: 'unknown' };
    const entry = {
        actorId: actorId != null ? String(actorId) : null,
        actorEmail: actorEmail || null,
        action,
        resource,
        resourceId: resourceId != null ? String(resourceId) : null,
        metadata: sanitizeMetadata(metadata),
        ip: meta.ip,
        userAgent: meta.userAgent,
        success: success !== false,
        createdAt: new Date().toISOString()
    };

    try {
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admin_audit_logs',
            command: '--create',
            data: entry
        });
    } catch (error) {
        console.error('❌ [AUDIT] admin_audit_logs write failed:', error.message);
    }

    try {
        await logAdminActivity({
            adminId: actorId,
            adminEmail: actorEmail,
            action,
            details: sanitizeMetadata(metadata),
            ipAddress: meta.ip,
            userAgent: meta.userAgent,
            success
        });
    } catch (_) {
        /* existing logger already swallows */
    }
}

function actorFromReq(req) {
    const admin = req && req.admin;
    if (!admin) return { actorId: null, actorEmail: null };
    return {
        actorId: admin.id,
        actorEmail: admin.email || admin.username || null
    };
}

async function auditFromReq(req, { action, resource, resourceId, metadata, success }) {
    const actor = actorFromReq(req);
    return writeAuditLog({
        ...actor,
        action,
        resource,
        resourceId,
        metadata,
        req,
        success
    });
}

module.exports = {
    writeAuditLog,
    auditFromReq,
    actorFromReq,
    sanitizeMetadata
};
