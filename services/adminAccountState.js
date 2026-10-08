/**
 * Authoritative staff account state. Status is checked on every
 * authenticated request and session refresh — not from JWT claims.
 */

const { ObjectId } = require('mongodb');
const getDBInstance = require('../vornifydb/dbInstance');
const { normalizeRole } = require('./staffAccessPolicy');

const db = getDBInstance();

function adminIdString(admin) {
    if (!admin) return null;
    const raw = admin._id || admin.id;
    return raw && typeof raw.toString === 'function' ? raw.toString() : String(raw);
}

function adminIdFilter(id) {
    if (!id) return null;
    return ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
}

/**
 * pending | active | suspended | removed
 * Legacy `active: false` maps to suspended.
 * Unknown status is denied (fail closed).
 */
function resolveAccountStatus(admin) {
    if (!admin) return 'removed';
    const status = admin.status != null ? String(admin.status).toLowerCase().trim() : '';
    if (status === 'removed' || status === 'deactivated') return 'removed';
    if (status === 'suspended') return 'suspended';
    if (status === 'pending') return 'pending';
    if (admin.active === false) return 'suspended';
    if (!status || status === 'active') return 'active';
    return 'suspended';
}

function canAuthenticate(admin) {
    return resolveAccountStatus(admin) === 'active';
}

function denialForStatus(status) {
    if (status === 'pending') {
        return {
            httpStatus: 403,
            code: 'ADMIN_PENDING',
            message: 'Admin account is pending invitation acceptance'
        };
    }
    if (status === 'suspended') {
        return {
            httpStatus: 403,
            code: 'ADMIN_DISABLED',
            message: 'Admin account is suspended'
        };
    }
    return {
        httpStatus: 403,
        code: 'ADMIN_DISABLED',
        message: 'Admin account is not active'
    };
}

function unwrapRead(result) {
    const data = result && result.success ? result.data : null;
    if (!data) return null;
    return Array.isArray(data) ? data[0] : data;
}

function listRead(result) {
    const data = result && result.success ? result.data : null;
    if (!data) return [];
    return Array.isArray(data) ? data : [data];
}

async function loadAdminById(id) {
    const filter = adminIdFilter(id);
    if (!filter) return null;
    const result = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--read',
        data: filter
    });
    return unwrapRead(result);
}

async function listAdmins() {
    const result = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--read',
        data: {}
    });
    return listRead(result);
}

async function countActiveSuperAdmins(excludeId) {
    const admins = await listAdmins();
    const exclude = excludeId != null ? String(excludeId) : null;
    return admins.filter((admin) => {
        if (normalizeRole(admin.role) !== 'super_admin') return false;
        if (resolveAccountStatus(admin) !== 'active') return false;
        if (exclude && adminIdString(admin) === exclude) return false;
        return true;
    }).length;
}

async function isLastActiveSuperAdmin(admin) {
    if (!admin || normalizeRole(admin.role) !== 'super_admin') return false;
    if (resolveAccountStatus(admin) !== 'active') return false;
    const others = await countActiveSuperAdmins(adminIdString(admin));
    return others === 0;
}

async function updateAdmin(id, update) {
    const filter = adminIdFilter(id);
    if (!filter) return { success: false };
    return db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--update',
        data: {
            filter,
            update: {
                ...update,
                updatedAt: new Date().toISOString()
            }
        }
    });
}

/**
 * Re-check the signed-in admin's password for sensitive actions.
 * Returns { ok: true } or { ok: false, error, code }.
 */
async function verifyAdminPassword(adminId, password) {
    const bcrypt = require('bcrypt');
    const raw = String(password || '');
    if (!raw) {
        return { ok: false, error: 'Password is required', code: 'PASSWORD_REQUIRED' };
    }
    const admin = await loadAdminById(adminId);
    if (!admin) {
        return { ok: false, error: 'Admin not found', code: 'ADMIN_NOT_FOUND' };
    }
    if (!admin.password || typeof admin.password !== 'string') {
        return { ok: false, error: 'Password verification failed', code: 'PASSWORD_MISMATCH' };
    }
    const looksLikeBcrypt =
        admin.password.startsWith('$2a$') ||
        admin.password.startsWith('$2b$') ||
        admin.password.startsWith('$2y$');
    let match = false;
    if (looksLikeBcrypt) {
        match = await bcrypt.compare(raw, admin.password);
    } else {
        match = admin.password === raw;
    }
    if (!match) {
        return { ok: false, error: 'Password does not match', code: 'PASSWORD_MISMATCH' };
    }
    return { ok: true, admin };
}

module.exports = {
    adminIdString,
    adminIdFilter,
    resolveAccountStatus,
    canAuthenticate,
    denialForStatus,
    unwrapRead,
    listRead,
    loadAdminById,
    listAdmins,
    countActiveSuperAdmins,
    isLastActiveSuperAdmin,
    updateAdmin,
    verifyAdminPassword
};
