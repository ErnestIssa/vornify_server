/**
 * Staff access management APIs.
 * GET  /api/admin/staff
 * GET  /api/admin/staff/roles
 * GET  /api/admin/staff/:id
 * PATCH /api/admin/staff/:id
 * POST /api/admin/staff/:id/suspend
 * POST /api/admin/staff/:id/reactivate
 * POST /api/admin/staff/:id/remove
 * POST /api/admin/staff/:id/revoke-sessions
 * POST /api/admin/staff/:id/reset-mfa
 */

const express = require('express');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { requirePermission } = require('../middleware/requirePermission');
const {
    listAdmins,
    loadAdminById,
    updateAdmin,
    adminIdString,
    resolveAccountStatus,
    isLastActiveSuperAdmin,
    unwrapRead
} = require('../services/adminAccountState');
const {
    normalizeRole,
    isInvitableRole,
    getRoleCatalog,
    getPermissionsForRole
} = require('../services/staffAccessPolicy');
const {
    revokeAllSessions,
    pruneSessions,
    toPublicSession
} = require('../services/adminSessions');
const { auditFromReq } = require('../services/adminAudit');
const getDBInstance = require('../vornifydb/dbInstance');

const router = express.Router();
const db = getDBInstance();

function lastActiveAt(admin) {
    const sessions = Array.isArray(admin.refreshTokens) ? admin.refreshTokens : [];
    const times = sessions
        .map((s) => s.lastUsedAt || s.createdAt)
        .filter(Boolean)
        .map((t) => Date.parse(t))
        .filter((n) => !Number.isNaN(n));
    if (admin.lastLoginAt) {
        const login = Date.parse(admin.lastLoginAt);
        if (!Number.isNaN(login)) times.push(login);
    }
    if (!times.length) return admin.lastLoginAt || null;
    return new Date(Math.max(...times)).toISOString();
}

function toStaffPublic(admin, { includeSessions = false } = {}) {
    if (!admin) return null;
    const role = normalizeRole(admin.role);
    const status = resolveAccountStatus(admin);
    const payload = {
        id: adminIdString(admin),
        name: admin.name || admin.email || admin.username,
        email: admin.email || admin.username || null,
        role,
        status,
        mfaEnabled: Boolean(admin.mfa && admin.mfa.enabled),
        mfaRequired: role === 'super_admin' || role === 'admin',
        lastLoginAt: admin.lastLoginAt || null,
        lastActiveAt: lastActiveAt(admin),
        createdAt: admin.createdAt || null,
        updatedAt: admin.updatedAt || null,
        invitedByEmail: admin.invitedByEmail || null,
        inviteExpiresAt: status === 'pending' ? admin.inviteExpiresAt || null : null,
        permissions: getPermissionsForRole(role)
    };
    if (includeSessions) {
        payload.sessions = (admin.refreshTokens || [])
            .filter((s) => !s.revoked)
            .map((s) => toPublicSession(s, null));
    }
    return payload;
}

function lastSuperAdminError() {
    return {
        success: false,
        message: 'Cannot modify the last active Super Admin',
        errorCode: 'LAST_SUPER_ADMIN'
    };
}

router.get('/roles', authenticateAdmin, requirePermission('staff.view'), (_req, res) => {
    res.json({
        success: true,
        data: {
            roles: getRoleCatalog(),
            permissions: getPermissionsForRole('super_admin')
        }
    });
});

router.get('/', authenticateAdmin, requirePermission('staff.view'), async (_req, res) => {
    try {
        const admins = await listAdmins();
        const staff = admins
            .map((admin) => toStaffPublic(admin))
            .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
        res.json({ success: true, data: staff });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to load staff',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

router.get('/:id', authenticateAdmin, requirePermission('staff.view'), async (req, res) => {
    try {
        const admin = await loadAdminById(req.params.id);
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Staff account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }
        res.json({
            success: true,
            data: {
                ...toStaffPublic(admin, { includeSessions: true }),
                permissions: getPermissionsForRole(admin.role)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to load staff account',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

router.patch('/:id', authenticateAdmin, requirePermission('staff.edit'), async (req, res) => {
    try {
        const admin = await loadAdminById(req.params.id);
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Staff account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }

        const body = req.body || {};
        const update = {};
        const changes = {};

        if (body.name != null) {
            const name = String(body.name).trim();
            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'Name is required',
                    errorCode: 'VALIDATION_ERROR'
                });
            }
            update.name = name;
            changes.name = name;
        }

        if (body.role != null) {
            const nextRole = String(body.role).toLowerCase().trim();
            const currentRole = normalizeRole(admin.role);

            if (nextRole === 'super_admin' && currentRole !== 'super_admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Super Admin cannot be created by changing another staff role',
                    errorCode: 'SUPER_ADMIN_PROTECTED'
                });
            }

            if (nextRole !== currentRole) {
                if (!isInvitableRole(nextRole) && nextRole !== 'super_admin') {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid role',
                        errorCode: 'INVALID_ROLE'
                    });
                }
                if (currentRole === 'super_admin' && nextRole !== 'super_admin') {
                    if (await isLastActiveSuperAdmin(admin)) {
                        return res.status(400).json(lastSuperAdminError());
                    }
                }
                update.role = nextRole;
                changes.role = { from: currentRole, to: nextRole };
            }
        }

        if (Object.keys(update).length === 0) {
            return res.json({ success: true, data: toStaffPublic(admin) });
        }

        const roleChanged = Boolean(update.role);
        if (roleChanged) {
            update.refreshTokens = revokeAllSessions(admin.refreshTokens || []);
        }

        await updateAdmin(adminIdString(admin), update);
        await auditFromReq(req, {
            action: roleChanged ? 'admin.role_changed' : 'admin.updated',
            resource: 'staff',
            resourceId: adminIdString(admin),
            metadata: { email: admin.email, ...changes }
        });

        const fresh = await loadAdminById(req.params.id);
        res.json({ success: true, data: toStaffPublic(fresh) });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update staff account',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

router.post('/:id/suspend', authenticateAdmin, requirePermission('staff.suspend'), async (req, res) => {
    try {
        const admin = await loadAdminById(req.params.id);
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Staff account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }
        if (String(adminIdString(admin)) === String(req.admin.id)) {
            return res.status(400).json({
                success: false,
                message: 'You cannot suspend your own account',
                errorCode: 'CANNOT_SUSPEND_SELF'
            });
        }
        if (await isLastActiveSuperAdmin(admin)) {
            return res.status(400).json(lastSuperAdminError());
        }

        await updateAdmin(adminIdString(admin), {
            status: 'suspended',
            active: false,
            refreshTokens: pruneSessions(revokeAllSessions(admin.refreshTokens || []))
        });
        await auditFromReq(req, {
            action: 'admin.suspended',
            resource: 'staff',
            resourceId: adminIdString(admin),
            metadata: { email: admin.email }
        });
        const fresh = await loadAdminById(req.params.id);
        res.json({ success: true, data: toStaffPublic(fresh) });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to suspend staff account',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

router.post('/:id/reactivate', authenticateAdmin, requirePermission('staff.suspend'), async (req, res) => {
    try {
        const admin = await loadAdminById(req.params.id);
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Staff account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }
        const status = resolveAccountStatus(admin);
        if (status === 'pending') {
            return res.status(400).json({
                success: false,
                message: 'Pending invitations must be accepted before the account can be activated',
                errorCode: 'STILL_PENDING'
            });
        }
        if (status === 'removed') {
            return res.status(400).json({
                success: false,
                message: 'Removed accounts cannot be reactivated. Invite the person again.',
                errorCode: 'ACCOUNT_REMOVED'
            });
        }

        await updateAdmin(adminIdString(admin), {
            status: 'active',
            active: true
        });
        await auditFromReq(req, {
            action: 'admin.reactivated',
            resource: 'staff',
            resourceId: adminIdString(admin),
            metadata: { email: admin.email }
        });
        const fresh = await loadAdminById(req.params.id);
        res.json({ success: true, data: toStaffPublic(fresh) });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to reactivate staff account',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

router.post('/:id/remove', authenticateAdmin, requirePermission('staff.remove'), async (req, res) => {
    try {
        const admin = await loadAdminById(req.params.id);
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Staff account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }
        if (String(adminIdString(admin)) === String(req.admin.id)) {
            return res.status(400).json({
                success: false,
                message: 'You cannot remove your own account',
                errorCode: 'CANNOT_REMOVE_SELF'
            });
        }
        if (await isLastActiveSuperAdmin(admin)) {
            return res.status(400).json(lastSuperAdminError());
        }

        await updateAdmin(adminIdString(admin), {
            status: 'removed',
            active: false,
            inviteToken: null,
            inviteExpiresAt: null,
            resetPasswordToken: null,
            resetPasswordExpires: null,
            refreshTokens: pruneSessions(revokeAllSessions(admin.refreshTokens || [])),
            mfa: { enabled: false, secret: null, recoveryHashes: [], enrolledAt: null }
        });
        await auditFromReq(req, {
            action: 'admin.removed',
            resource: 'staff',
            resourceId: adminIdString(admin),
            metadata: { email: admin.email }
        });
        const fresh = await loadAdminById(req.params.id);
        res.json({ success: true, data: toStaffPublic(fresh) });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to remove staff account',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

router.post('/:id/revoke-sessions', authenticateAdmin, requirePermission('staff.edit'), async (req, res) => {
    try {
        const admin = await loadAdminById(req.params.id);
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Staff account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }
        await updateAdmin(adminIdString(admin), {
            refreshTokens: pruneSessions(revokeAllSessions(admin.refreshTokens || []))
        });
        await auditFromReq(req, {
            action: 'admin.session_revoked',
            resource: 'staff',
            resourceId: adminIdString(admin),
            metadata: { email: admin.email, scope: 'all' }
        });
        res.json({ success: true, message: 'All sessions revoked' });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to revoke sessions',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

router.post('/:id/reset-mfa', authenticateAdmin, requirePermission('staff.edit'), async (req, res) => {
    try {
        const admin = await loadAdminById(req.params.id);
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Staff account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }
        await updateAdmin(adminIdString(admin), {
            mfa: { enabled: false, secret: null, recoveryHashes: [], enrolledAt: null, resetAt: new Date().toISOString() },
            refreshTokens: pruneSessions(revokeAllSessions(admin.refreshTokens || []))
        });
        await auditFromReq(req, {
            action: 'admin.mfa_reset',
            resource: 'staff',
            resourceId: adminIdString(admin),
            metadata: { email: admin.email }
        });
        res.json({ success: true, message: 'MFA reset. The user must enroll again on next login.' });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to reset MFA',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

// Avoid unused import lint in some setups
void db;
void unwrapRead;

module.exports = router;
