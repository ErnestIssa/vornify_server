/**
 * Current-user security: MFA, sessions, and audit log.
 * GET  /api/admin/security/mfa
 * POST /api/admin/security/mfa/setup
 * POST /api/admin/security/mfa/enable
 * POST /api/admin/security/mfa/disable
 * GET  /api/admin/security/sessions
 * DELETE /api/admin/security/sessions/:id
 * POST /api/admin/security/sessions/revoke-others
 * POST /api/admin/security/sessions/revoke-all
 * GET  /api/admin/audit
 */

const express = require('express');
const bcrypt = require('bcrypt');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { requirePermission } = require('../middleware/requirePermission');
const {
    loadAdminById,
    updateAdmin,
    adminIdString,
    listRead
} = require('../services/adminAccountState');
const { mfaRequiredForRole } = require('../services/staffAccessPolicy');
const {
    generateSecret,
    encryptSecret,
    decryptSecret,
    verifyTotp,
    otpauthUrl,
    qrDataUrl,
    generateRecoveryCodes,
    hashRecoveryCode,
    consumeRecoveryCode
} = require('../services/totp');
const {
    findSession,
    revokeSessionById,
    revokeOtherSessions,
    revokeAllSessions,
    pruneSessions,
    toPublicSession
} = require('../services/adminSessions');
const { auditFromReq } = require('../services/adminAudit');
const getDBInstance = require('../vornifydb/dbInstance');

const router = express.Router();
const db = getDBInstance();

const pendingSetup = new Map();

function pendingKey(adminId) {
    return String(adminId);
}

router.get('/security/mfa', authenticateAdmin, async (req, res) => {
    try {
        const admin = await loadAdminById(req.admin.id);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found', errorCode: 'ADMIN_NOT_FOUND' });
        }
        const enrolled = Boolean(admin.mfa && admin.mfa.enabled);
        res.json({
            success: true,
            data: {
                enrolled,
                required: mfaRequiredForRole(admin.role),
                enrolledAt: (admin.mfa && admin.mfa.enrolledAt) || null,
                recoveryCodesRemaining: Array.isArray(admin.mfa && admin.mfa.recoveryHashes)
                    ? admin.mfa.recoveryHashes.length
                    : 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load MFA status', errorCode: 'INTERNAL_SERVER_ERROR' });
    }
});

router.post('/security/mfa/setup', authenticateAdmin, async (req, res) => {
    try {
        const admin = await loadAdminById(req.admin.id);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found', errorCode: 'ADMIN_NOT_FOUND' });
        }
        const secret = generateSecret();
        pendingSetup.set(pendingKey(adminIdString(admin)), {
            secret,
            createdAt: Date.now()
        });
        const url = otpauthUrl(admin.email || admin.username || 'staff', secret);
        const qr = await qrDataUrl(url);
        res.json({
            success: true,
            data: {
                otpauthUrl: url,
                qrDataUrl: qr
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to start MFA setup', errorCode: 'INTERNAL_SERVER_ERROR' });
    }
});

router.post('/security/mfa/enable', authenticateAdmin, async (req, res) => {
    try {
        const code = req.body && req.body.code;
        const admin = await loadAdminById(req.admin.id);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found', errorCode: 'ADMIN_NOT_FOUND' });
        }
        const pending = pendingSetup.get(pendingKey(adminIdString(admin)));
        if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
            pendingSetup.delete(pendingKey(adminIdString(admin)));
            return res.status(400).json({
                success: false,
                message: 'MFA setup expired. Start setup again.',
                errorCode: 'MFA_SETUP_EXPIRED'
            });
        }
        if (!verifyTotp(pending.secret, code)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid authenticator code',
                errorCode: 'INVALID_MFA_CODE'
            });
        }
        const recoveryCodes = generateRecoveryCodes();
        await updateAdmin(adminIdString(admin), {
            mfa: {
                enabled: true,
                secret: encryptSecret(pending.secret),
                recoveryHashes: recoveryCodes.map(hashRecoveryCode),
                enrolledAt: new Date().toISOString()
            }
        });
        pendingSetup.delete(pendingKey(adminIdString(admin)));
        await auditFromReq(req, {
            action: 'admin.mfa_enabled',
            resource: 'security',
            resourceId: adminIdString(admin)
        });
        res.json({
            success: true,
            data: {
                enrolled: true,
                recoveryCodes
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to enable MFA', errorCode: 'INTERNAL_SERVER_ERROR' });
    }
});

router.post('/security/mfa/disable', authenticateAdmin, async (req, res) => {
    try {
        const { password, code } = req.body || {};
        const admin = await loadAdminById(req.admin.id);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found', errorCode: 'ADMIN_NOT_FOUND' });
        }
        if (mfaRequiredForRole(admin.role)) {
            return res.status(403).json({
                success: false,
                message: 'MFA is required for this role. Ask a Super Admin to reset MFA if you lost access.',
                errorCode: 'MFA_REQUIRED_FOR_ROLE'
            });
        }
        let verified = false;
        if (password && admin.password) {
            verified = await bcrypt.compare(password, admin.password);
        }
        if (!verified && admin.mfa && admin.mfa.enabled && admin.mfa.secret) {
            const secret = decryptSecret(admin.mfa.secret);
            verified = secret ? verifyTotp(secret, code) : false;
        }
        if (!verified) {
            return res.status(401).json({
                success: false,
                message: 'Re-authentication required to disable MFA',
                errorCode: 'REAUTH_REQUIRED'
            });
        }
        await updateAdmin(adminIdString(admin), {
            mfa: { enabled: false, secret: null, recoveryHashes: [], disabledAt: new Date().toISOString() }
        });
        await auditFromReq(req, {
            action: 'admin.mfa_disabled',
            resource: 'security',
            resourceId: adminIdString(admin)
        });
        res.json({ success: true, data: { enrolled: false } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to disable MFA', errorCode: 'INTERNAL_SERVER_ERROR' });
    }
});

router.get('/security/sessions', authenticateAdmin, async (req, res) => {
    try {
        const admin = await loadAdminById(req.admin.id);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found', errorCode: 'ADMIN_NOT_FOUND' });
        }
        const currentToken = req.cookies && req.cookies.refreshToken;
        const sessions = (admin.refreshTokens || [])
            .filter((s) => !s.revoked)
            .map((s) => toPublicSession(s, currentToken));
        res.json({ success: true, data: sessions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load sessions', errorCode: 'INTERNAL_SERVER_ERROR' });
    }
});

router.delete('/security/sessions/:id', authenticateAdmin, async (req, res) => {
    try {
        const admin = await loadAdminById(req.admin.id);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found', errorCode: 'ADMIN_NOT_FOUND' });
        }
        const { tokens, found } = revokeSessionById(admin.refreshTokens || [], req.params.id);
        if (!found) {
            return res.status(404).json({ success: false, message: 'Session not found', errorCode: 'SESSION_NOT_FOUND' });
        }
        await updateAdmin(adminIdString(admin), { refreshTokens: pruneSessions(tokens) });
        await auditFromReq(req, {
            action: 'admin.session_revoked',
            resource: 'session',
            resourceId: req.params.id
        });
        res.json({ success: true, message: 'Session revoked' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to revoke session', errorCode: 'INTERNAL_SERVER_ERROR' });
    }
});

router.post('/security/sessions/revoke-others', authenticateAdmin, async (req, res) => {
    try {
        const admin = await loadAdminById(req.admin.id);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found', errorCode: 'ADMIN_NOT_FOUND' });
        }
        const currentToken = req.cookies && req.cookies.refreshToken;
        const current = findSession(admin.refreshTokens || [], currentToken);
        const keepId = current && current.id;
        const tokens = pruneSessions(revokeOtherSessions(admin.refreshTokens || [], keepId));
        await updateAdmin(adminIdString(admin), { refreshTokens: tokens });
        await auditFromReq(req, {
            action: 'admin.session_revoked',
            resource: 'session',
            metadata: { scope: 'others' }
        });
        res.json({ success: true, message: 'Other sessions revoked' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to revoke sessions', errorCode: 'INTERNAL_SERVER_ERROR' });
    }
});

router.post('/security/sessions/revoke-all', authenticateAdmin, async (req, res) => {
    try {
        const admin = await loadAdminById(req.admin.id);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found', errorCode: 'ADMIN_NOT_FOUND' });
        }
        await updateAdmin(adminIdString(admin), {
            refreshTokens: pruneSessions(revokeAllSessions(admin.refreshTokens || []))
        });
        await auditFromReq(req, {
            action: 'admin.session_revoked',
            resource: 'session',
            metadata: { scope: 'all' }
        });
        res.json({ success: true, message: 'All sessions revoked' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to revoke sessions', errorCode: 'INTERNAL_SERVER_ERROR' });
    }
});

router.get('/audit', authenticateAdmin, requirePermission('audit.view'), async (req, res) => {
    try {
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admin_audit_logs',
            command: '--read',
            data: {}
        });
        const rows = listRead(result)
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .slice(0, limit)
            .map((row) => ({
                id: row._id || row.id,
                actorId: row.actorId || null,
                actorEmail: row.actorEmail || null,
                action: row.action,
                resource: row.resource || null,
                resourceId: row.resourceId || null,
                metadata: row.metadata || {},
                ip: row.ip || null,
                createdAt: row.createdAt || row.timestamp || null,
                success: row.success !== false
            }));
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load audit log', errorCode: 'INTERNAL_SERVER_ERROR' });
    }
});

module.exports = router;
