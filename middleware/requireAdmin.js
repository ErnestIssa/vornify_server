const { logger } = require('../core/logging/logger');
const { isStaffRole } = require('../services/staffAccessPolicy');

/**
 * Authenticated staff gate. Prefer requirePermission() for operations.
 * Must be used after authenticateAdmin.
 */
function requireAdmin(req, res, next) {
    try {
        if (!req.admin) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                code: 'NO_AUTH'
            });
        }

        if (!isStaffRole(req.admin.role)) {
            logger.warn('admin_role_required_denied', { role: req.admin.role });
            return res.status(403).json({
                success: false,
                error: 'Staff access required',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }

        next();
    } catch (error) {
        logger.error('require_admin_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Internal server error during authorization check',
            code: 'INTERNAL_SERVER_ERROR'
        });
    }
}

module.exports = requireAdmin;
