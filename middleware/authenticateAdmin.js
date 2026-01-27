const jwt = require('jsonwebtoken');
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

// JWT secret from environment variable
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET;

/**
 * Middleware to authenticate admin requests
 * Verifies JWT token from Authorization header
 * Attaches admin info to req.admin if valid
 * Returns 401 if token is missing, invalid, or expired
 */
async function authenticateAdmin(req, res, next) {
    try {
        // Get token from Authorization header
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

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token
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
            } else if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid token. Please login again.',
                    code: 'INVALID_TOKEN'
                });
            } else {
                throw jwtError;
            }
        }

        // Verify admin still exists and is active
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: { 
                filter: { 
                    _id: decoded.adminId || { id: decoded.adminId },
                    active: { $ne: false } // Active or undefined
                } 
            }
        });

        if (!adminResult.success || !adminResult.data) {
            return res.status(401).json({
                success: false,
                error: 'Admin account not found or disabled',
                code: 'ADMIN_NOT_FOUND'
            });
        }

        const admin = adminResult.data;

        // Attach admin info to request object
        req.admin = {
            id: admin._id || admin.id,
            username: admin.username,
            role: admin.role || 'admin',
            name: admin.name || admin.username
        };

        // Continue to next middleware/route
        next();

    } catch (error) {
        console.error('❌ [AUTH MIDDLEWARE] Authentication error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during authentication'
        });
    }
}

module.exports = authenticateAdmin;

