/**
 * Staff refresh-session helpers.
 * New sessions store a SHA-256 hash, never the raw refresh token.
 * Legacy records that still store `token` remain valid until rotated.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function newSessionId() {
    return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function clientMeta(req) {
    const forwarded = req && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
    const ip = (typeof forwarded === 'string' && forwarded.split(',')[0].trim())
        || (req && (req.ip || req.connection && req.connection.remoteAddress))
        || 'unknown';
    const userAgent = (req && req.get && req.get('user-agent')) || 'unknown';
    return { ip, userAgent };
}

function buildSessionRecord(refreshToken, req) {
    const now = new Date();
    const meta = clientMeta(req);
    return {
        id: newSessionId(),
        tokenHash: hashRefreshToken(refreshToken),
        createdAt: now.toISOString(),
        lastUsedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + REFRESH_MAX_AGE_MS).toISOString(),
        ip: meta.ip,
        userAgent: meta.userAgent,
        revoked: false,
        revokedAt: null
    };
}

function sessionMatchesToken(record, rawToken) {
    if (!record || !rawToken) return false;
    const incoming = String(rawToken).trim();
    if (record.tokenHash && record.tokenHash === hashRefreshToken(incoming)) return true;
    if (record.token && record.token === incoming) return true;
    return false;
}

function findSession(refreshTokens, rawToken) {
    const list = Array.isArray(refreshTokens) ? refreshTokens : [];
    return list.find((record) => sessionMatchesToken(record, rawToken)) || null;
}

function revokeMatchingSession(refreshTokens, rawToken) {
    const now = new Date().toISOString();
    return (refreshTokens || []).map((record) => {
        if (sessionMatchesToken(record, rawToken) && !record.revoked) {
            return { ...record, revoked: true, revokedAt: now, token: undefined };
        }
        return record;
    });
}

function revokeSessionById(refreshTokens, sessionId) {
    const now = new Date().toISOString();
    let found = false;
    const next = (refreshTokens || []).map((record) => {
        if (String(record.id) === String(sessionId) && !record.revoked) {
            found = true;
            return { ...record, revoked: true, revokedAt: now, token: undefined };
        }
        return record;
    });
    return { tokens: next, found };
}

function revokeAllSessions(refreshTokens) {
    const now = new Date().toISOString();
    return (refreshTokens || []).map((record) => (
        record.revoked
            ? record
            : { ...record, revoked: true, revokedAt: now, token: undefined }
    ));
}

function revokeOtherSessions(refreshTokens, keepSessionId) {
    const now = new Date().toISOString();
    return (refreshTokens || []).map((record) => {
        if (String(record.id) === String(keepSessionId) || record.revoked) return record;
        return { ...record, revoked: true, revokedAt: now, token: undefined };
    });
}

function pruneSessions(refreshTokens) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return (refreshTokens || []).filter((record) => {
        if (!record.revoked) return true;
        const at = record.revokedAt ? Date.parse(record.revokedAt) : 0;
        return at >= cutoff;
    });
}

function signAccessToken(admin) {
    const adminId = admin._id || admin.id;
    return jwt.sign(
        {
            adminId,
            email: admin.email,
            role: admin.role || 'admin'
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function signRefreshToken(admin) {
    const adminId = admin._id || admin.id;
    return jwt.sign(
        {
            adminId,
            email: admin.email,
            role: admin.role || 'admin',
            type: 'refresh',
            sid: newSessionId()
        },
        JWT_SECRET,
        { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
}

function signMfaPendingToken(admin) {
    const adminId = admin._id || admin.id;
    return jwt.sign(
        {
            adminId,
            email: admin.email,
            role: admin.role || 'admin',
            type: 'mfa_pending'
        },
        JWT_SECRET,
        { expiresIn: '5m' }
    );
}

function setRefreshCookie(res, refreshToken) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: REFRESH_MAX_AGE_MS,
        path: '/api/admin/auth'
    });
}

function clearRefreshCookie(res) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/api/admin/auth'
    });
}

function toPublicSession(record, currentRawToken) {
    const isCurrent = currentRawToken ? sessionMatchesToken(record, currentRawToken) : false;
    return {
        id: record.id || null,
        createdAt: record.createdAt || null,
        lastUsedAt: record.lastUsedAt || record.createdAt || null,
        expiresAt: record.expiresAt || null,
        ip: record.ip || null,
        userAgent: record.userAgent || null,
        current: isCurrent,
        revoked: Boolean(record.revoked)
    };
}

module.exports = {
    hashRefreshToken,
    newSessionId,
    clientMeta,
    buildSessionRecord,
    sessionMatchesToken,
    findSession,
    revokeMatchingSession,
    revokeSessionById,
    revokeAllSessions,
    revokeOtherSessions,
    pruneSessions,
    signAccessToken,
    signRefreshToken,
    signMfaPendingToken,
    setRefreshCookie,
    clearRefreshCookie,
    toPublicSession,
    REFRESH_MAX_AGE_MS
};
