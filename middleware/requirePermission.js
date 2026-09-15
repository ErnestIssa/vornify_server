const { hasPermission } = require('../services/staffAccessPolicy');
const { logger } = require('../core/logging/logger');

/**
 * Deny-by-default permission gate. Use after authenticateAdmin.
 * Checks req.admin.permissions (resolved server-side from current role).
 */
function requirePermission(...needed) {
    const required = needed.flat().filter(Boolean);

    return function requirePermissionMiddleware(req, res, next) {
        try {
            if (!req.admin) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required',
                    code: 'NO_AUTH'
                });
            }

            if (required.length === 0) {
                return next();
            }

            const permissions = Array.isArray(req.admin.permissions) ? req.admin.permissions : [];
            const missing = required.filter((perm) => !hasPermission(permissions, perm));

            if (missing.length > 0) {
                logger.warn('permission_denied', {
                    adminId: String(req.admin.id || ''),
                    role: req.admin.role,
                    needed: required,
                    missing
                });
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to perform this action',
                    code: 'INSUFFICIENT_PERMISSIONS',
                    required: required
                });
            }

            next();
        } catch (error) {
            logger.error('require_permission_error', { message: error.message });
            return res.status(500).json({
                success: false,
                error: 'Internal server error during authorization check',
                code: 'INTERNAL_SERVER_ERROR'
            });
        }
    };
}

function requireAnyPermission(...needed) {
    const required = needed.flat().filter(Boolean);

    return function requireAnyPermissionMiddleware(req, res, next) {
        if (!req.admin) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                code: 'NO_AUTH'
            });
        }
        const permissions = Array.isArray(req.admin.permissions) ? req.admin.permissions : [];
        const ok = required.length === 0 || required.some((perm) => hasPermission(permissions, perm));
        if (!ok) {
            logger.warn('permission_denied_any', {
                adminId: String(req.admin.id || ''),
                role: req.admin.role,
                needed: required
            });
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to perform this action',
                code: 'INSUFFICIENT_PERMISSIONS',
                required
            });
        }
        next();
    };
}

module.exports = requirePermission;
module.exports.requirePermission = requirePermission;
module.exports.requireAnyPermission = requireAnyPermission;
