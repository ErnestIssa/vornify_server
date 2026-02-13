const { ObjectId } = require('mongodb');
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

/**
 * Middleware to protect super_admin accounts from deletion/downgrade
 * Must be used after authenticateAdmin middleware
 * Prevents:
 * - Deleting super_admin account
 * - Downgrading super_admin role
 * - Deleting the last super_admin
 * - Self-downgrade
 */
async function protectSuperAdmin(req, res, next) {
    try {
        // Get admin ID from params or body
        const adminId = req.params.id || req.body.adminId || req.body.id;
        
        if (!adminId) {
            // No admin ID specified, continue (might be creating new admin)
            return next();
        }

        // Find the admin being modified
        const adminLookup = ObjectId.isValid(adminId)
            ? { _id: new ObjectId(adminId) }
            : { _id: adminId };

        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: adminLookup
        });

        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;

        if (!admin || admin.role !== 'super_admin') {
            // Not a super_admin, no protection needed
            return next();
        }

        // Check if this is the last super_admin
        const allAdminsResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: { role: 'super_admin', status: 'active' }
        });

        const allSuperAdminsData = allAdminsResult && allAdminsResult.success ? allAdminsResult.data : null;
        const allSuperAdmins = Array.isArray(allSuperAdminsData) 
            ? allSuperAdminsData 
            : (allSuperAdminsData ? [allSuperAdminsData] : []);

        const superAdminCount = allSuperAdmins.length;

        // Prevent deleting the last super_admin
        if (req.method === 'DELETE' && superAdminCount <= 1) {
            console.log('❌ [PROTECT SUPER ADMIN] Attempt to delete last super_admin blocked');
            return res.status(403).json({
                success: false,
                message: 'Cannot delete the last super_admin account',
                errorCode: 'LAST_SUPER_ADMIN'
            });
        }

        // Prevent deleting any super_admin if it would leave less than 1
        if (req.method === 'DELETE' && superAdminCount <= 1) {
            console.log('❌ [PROTECT SUPER ADMIN] Attempt to delete super_admin would leave no super_admin');
            return res.status(403).json({
                success: false,
                message: 'Cannot delete super_admin. At least one super_admin must exist.',
                errorCode: 'LAST_SUPER_ADMIN'
            });
        }

        // Prevent downgrading super_admin role
        if (req.body.role && req.body.role !== 'super_admin') {
            // Check if this is self-downgrade
            const currentAdminId = req.admin.id;
            const targetAdminId = admin._id || admin.id;
            
            if (currentAdminId.toString() === targetAdminId.toString()) {
                console.log('❌ [PROTECT SUPER ADMIN] Attempt to self-downgrade blocked');
                return res.status(403).json({
                    success: false,
                    message: 'Cannot downgrade your own role from super_admin',
                    errorCode: 'SELF_DOWNGRADE'
                });
            }

            // Check if this would leave less than 1 super_admin
            if (superAdminCount <= 1) {
                console.log('❌ [PROTECT SUPER ADMIN] Attempt to downgrade last super_admin blocked');
                return res.status(403).json({
                    success: false,
                    message: 'Cannot downgrade the last super_admin account',
                    errorCode: 'LAST_SUPER_ADMIN'
                });
            }

            console.log('❌ [PROTECT SUPER ADMIN] Attempt to downgrade super_admin blocked');
            return res.status(403).json({
                success: false,
                message: 'Cannot downgrade super_admin role',
                errorCode: 'SUPER_ADMIN_PROTECTED'
            });
        }

        // Prevent changing super_admin email (optional - can be relaxed if needed)
        // This is a security measure to prevent account takeover
        if (req.body.email && req.body.email !== admin.email) {
            console.log('⚠️ [PROTECT SUPER ADMIN] Attempt to change super_admin email detected');
            // Allow but log for audit (can be made stricter if needed)
            // For now, we'll allow it but log it
        }

        // All checks passed, continue
        next();

    } catch (error) {
        console.error('❌ [PROTECT SUPER ADMIN] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during super admin protection check',
            code: 'INTERNAL_SERVER_ERROR'
        });
    }
}

module.exports = protectSuperAdmin;

