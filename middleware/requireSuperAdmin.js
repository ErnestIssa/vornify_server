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
            console.log(`❌ [REQUIRE SUPER ADMIN] Access denied for ${req.admin.email || req.admin.username}. Role: ${req.admin.role}`);
            return res.status(403).json({
                success: false,
                error: 'Only super_admin can access this resource',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }

        // Admin is super_admin, continue
        console.log(`✅ [REQUIRE SUPER ADMIN] Access granted for ${req.admin.email || req.admin.username}`);
        next();

    } catch (error) {
        console.error('❌ [REQUIRE SUPER ADMIN] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during authorization check',
            code: 'INTERNAL_SERVER_ERROR'
        });
    }
}

module.exports = requireSuperAdmin;

