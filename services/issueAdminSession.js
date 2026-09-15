const {
    signAccessToken,
    signRefreshToken,
    buildSessionRecord,
    pruneSessions,
    setRefreshCookie
} = require('./adminSessions');
const { adminIdString, updateAdmin } = require('./adminAccountState');
const { getPermissionsForRole, normalizeRole, mfaRequiredForRole } = require('./staffAccessPolicy');
const { resolveAccountStatus } = require('./adminAccountState');

function publicAdmin(admin) {
    const role = normalizeRole(admin.role);
    return {
        id: adminIdString(admin),
        name: admin.name || admin.email || admin.username,
        email: admin.email || admin.username,
        role,
        status: resolveAccountStatus(admin),
        permissions: getPermissionsForRole(role),
        mfa: {
            enrolled: Boolean(admin.mfa && admin.mfa.enabled),
            required: mfaRequiredForRole(role)
        }
    };
}

async function issueAdminSession(admin, req, res, extraUpdate = {}) {
    const accessToken = signAccessToken(admin);
    const refreshToken = signRefreshToken(admin);
    const session = buildSessionRecord(refreshToken, req);
    const refreshTokens = pruneSessions([...(admin.refreshTokens || []), session]);
    await updateAdmin(adminIdString(admin), {
        lastLoginAt: new Date().toISOString(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...extraUpdate,
        refreshTokens
    });
    setRefreshCookie(res, refreshToken);
    return {
        token: accessToken,
        admin: publicAdmin({ ...admin, ...extraUpdate, role: extraUpdate.role || admin.role })
    };
}

module.exports = {
    publicAdmin,
    issueAdminSession
};
