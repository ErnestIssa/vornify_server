const { devLog } = require('../core/logging/devConsole');
const { logger } = require('../core/logging/logger');

/**
 * Middleware to require super_admin role
 * Must be used after authenticateAdmin middleware
 * Returns 403 if admin is not super_admin
 */
function requireSuperAdmin(req, res, next) {
    try {
        // authenticateAdmin middleware should have attached req.admin
        if (!req.admin) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                code: 'NO_AUTH'
            });
        }

        // Check if admin has super_admin role
        if (req.admin.role !== 'super_admin') {
            logger.warn('super_admin_required_denied', { role: req.admin.role });
            return res.status(403).json({
                success: false,
                error: 'Only super_admin can access this resource',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }

        devLog('super_admin_gate ok');
        next();

    } catch (error) {
        logger.error('require_super_admin_error', { message: error.message });
        res.status(500).json({
            success: false,
            error: 'Internal server error during authorization check',
            code: 'INTERNAL_SERVER_ERROR'
        });
    }
}

module.exports = requireSuperAdmin;

