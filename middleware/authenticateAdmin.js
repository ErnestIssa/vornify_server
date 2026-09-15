const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const getDBInstance = require('../vornifydb/dbInstance');
const {
    canAuthenticate,
    denialForStatus,
    resolveAccountStatus,
    unwrapRead
} = require('../services/adminAccountState');
const { getPermissionsForRole, normalizeRole } = require('../services/staffAccessPolicy');

const db = getDBInstance();
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET;

function attachAdmin(req, admin) {
    const role = normalizeRole(admin.role);
    req.admin = {
        id: admin._id || admin.id,
        username: admin.username,
        email: admin.email || admin.username || null,
        role,
        name: admin.name || admin.username || admin.email,
        status: resolveAccountStatus(admin),
        permissions: getPermissionsForRole(role),
        mfaEnabled: Boolean(admin.mfa && admin.mfa.enabled)
    };
}

async function loadAdminFromDecoded(decoded) {
    const lookup = (decoded && decoded.adminId && ObjectId.isValid(decoded.adminId))
        ? { _id: new ObjectId(decoded.adminId) }
        : { username: decoded.username };
    const adminResult = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--read',
        data: lookup
    });
    return unwrapRead(adminResult);
}

/**
 * Middleware to authenticate admin requests.
 * Verifies JWT, then re-loads current account status/role from Mongo.
 * Status is authoritative — a still-valid access token cannot bypass suspension.
 */
async function authenticateAdmin(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required. Please provide a valid token.',
                code: 'NO_TOKEN'
            });
        }

        if (!JWT_SECRET) {
            console.error('❌ [AUTH MIDDLEWARE] JWT_SECRET not configured');
            return res.status(500).json({
                success: false,
                error: 'Server configuration error: JWT_SECRET not set'
            });
        }

        const token = authHeader.substring(7);

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (jwtError) {
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    error: 'Token expired. Please login again.',
                    code: 'TOKEN_EXPIRED'
                });
            }
            if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid token. Please login again.',
                    code: 'INVALID_TOKEN'
                });
            }
            throw jwtError;
        }

        if (decoded && decoded.type && decoded.type !== 'access') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token type',
                code: 'INVALID_TOKEN'
            });
        }

        const admin = await loadAdminFromDecoded(decoded);

        if (!admin) {
            return res.status(401).json({
                success: false,
                error: 'Admin account not found or disabled',
                code: 'ADMIN_NOT_FOUND'
            });
        }

        if (!canAuthenticate(admin)) {
            const denial = denialForStatus(resolveAccountStatus(admin));
            return res.status(denial.httpStatus).json({
                success: false,
                error: denial.message,
                code: denial.code
            });
        }

        attachAdmin(req, admin);
        next();
    } catch (error) {
        console.error('❌ [AUTH MIDDLEWARE] Authentication error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during authentication'
        });
    }
}

/**
 * Optional admin auth: does not 401. Suspended/pending accounts are treated as unauthenticated.
 */
async function optionalAuthenticateAdmin(req, res, next) {
    req.isAdminRequest = false;
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ') || !JWT_SECRET) {
            return next();
        }
        const token = authHeader.substring(7);
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (_) {
            return next();
        }
        if (decoded && decoded.type && decoded.type !== 'access') {
            return next();
        }
        const admin = await loadAdminFromDecoded(decoded);
        if (!admin || !canAuthenticate(admin)) return next();
        attachAdmin(req, admin);
        req.isAdminRequest = true;
    } catch (_) {
        // ignore
    }
    next();
}

module.exports = authenticateAdmin;
module.exports.optionalAuthenticateAdmin = optionalAuthenticateAdmin;
