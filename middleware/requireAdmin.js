/**
 * Middleware to require admin role (super_admin or admin)
 * Must be used after authenticateAdmin middleware
 * Returns 403 if admin is not super_admin or admin
 * 
 * Note: This is mostly for consistency and explicit role checking.
 * Most routes that use authenticateAdmin already allow both roles.
 */
function requireAdmin(req, res, next) {
    try {
        // authenticateAdmin middleware should have attached req.admin
        if (!req.admin) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                code: 'NO_AUTH'
            });
        }

        // Check if admin has super_admin or admin role
        const allowedRoles = ['super_admin', 'admin'];
        if (!allowedRoles.includes(req.admin.role)) {
            console.log(`❌ [REQUIRE ADMIN] Access denied for ${req.admin.email || req.admin.username}. Role: ${req.admin.role}`);
            return res.status(403).json({
                success: false,
                error: 'Admin access required',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }

        // Admin has valid role, continue
        next();

    } catch (error) {
        console.error('❌ [REQUIRE ADMIN] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during authorization check',
            code: 'INTERNAL_SERVER_ERROR'
        });
    }
}

module.exports = requireAdmin;

