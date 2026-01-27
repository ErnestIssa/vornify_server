const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const getDBInstance = require('../vornifydb/dbInstance');

const router = express.Router();
const db = getDBInstance();

// JWT secret from environment variable (required)
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h'; // Default 24 hours

if (!JWT_SECRET) {
    console.warn('⚠️  [ADMIN AUTH] JWT_SECRET not set. Admin authentication will fail.');
    console.warn('⚠️  [ADMIN AUTH] Please set JWT_SECRET or ADMIN_JWT_SECRET environment variable.');
}

/**
 * POST /api/admin/auth/login
 * Admin login endpoint
 * Accepts: { username, password }
 * Returns: { success: true, token: "jwt_token", admin: {...} }
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const normalizedUsername = String(username || '').toLowerCase().trim();

        if (!normalizedUsername || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        if (!JWT_SECRET) {
            return res.status(500).json({
                success: false,
                message: 'Server configuration error: JWT_SECRET not set',
                errorCode: 'SERVER_CONFIG_ERROR'
            });
        }

        // Find admin in database (support both username and email fields)
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            // VortexDB expects the query directly (NOT { filter: ... })
            data: { $or: [{ username: normalizedUsername }, { email: normalizedUsername }] }
        });

        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;

        if (!adminResult.success || !admin) {
            // Return generic error to prevent username enumeration
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password',
                errorCode: 'INVALID_CREDENTIALS'
            });
        }

        if (!admin.password || typeof admin.password !== 'string') {
            // Treat as invalid credentials (do not leak account state)
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password',
                errorCode: 'INVALID_CREDENTIALS'
            });
        }

        // Verify password
        const looksLikeBcryptHash = admin.password.startsWith('$2a$') || admin.password.startsWith('$2b$') || admin.password.startsWith('$2y$');
        let passwordMatch = false;

        if (looksLikeBcryptHash) {
            passwordMatch = await bcrypt.compare(password, admin.password);
        } else {
            // Legacy/incorrectly-created admin (plain text password).
            // Allow login IF it matches, then upgrade to bcrypt hash.
            if (admin.password === password) {
                passwordMatch = true;

                try {
                    const upgradedHash = await bcrypt.hash(password, 10);
                    const filter = (admin._id && ObjectId.isValid(admin._id))
                        ? { _id: new ObjectId(admin._id) }
                        : { $or: [{ username: normalizedUsername }, { email: normalizedUsername }] };
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'admins',
                        command: '--update',
                        data: {
                            filter,
                            update: {
                                password: upgradedHash,
                                // Ensure both fields exist for consistency with unique email indexes
                                username: admin.username || normalizedUsername,
                                email: admin.email || normalizedUsername,
                                updatedAt: new Date().toISOString(),
                                passwordUpgradedAt: new Date().toISOString()
                            }
                        }
                    });
                    console.log(`🔐 [ADMIN AUTH] Upgraded plaintext password to bcrypt for ${normalizedUsername}`);
                } catch (upgradeErr) {
                    console.warn('⚠️ [ADMIN AUTH] Password upgrade failed (login still allowed):', upgradeErr.message);
                }
            } else {
                passwordMatch = false;
            }
        }

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password',
                errorCode: 'INVALID_CREDENTIALS'
            });
        }

        // Check if admin is active
        if (admin.active === false) {
            return res.status(403).json({
                success: false,
                message: 'Admin account is disabled',
                errorCode: 'ADMIN_DISABLED'
            });
        }

        // Generate JWT token
        const tokenPayload = {
            adminId: admin._id || admin.id,
            username: admin.username,
            role: admin.role || 'admin'
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN
        });

        // Update last login timestamp
        const updateFilter = (admin._id && ObjectId.isValid(admin._id))
            ? { _id: new ObjectId(admin._id) }
            : { $or: [{ username: normalizedUsername }, { email: normalizedUsername }] };
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--update',
            data: {
                filter: updateFilter,
                update: {
                    lastLoginAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });

        // Return success response (exclude password)
        res.json({
            success: true,
            token,
            admin: {
                id: admin._id || admin.id,
                username: admin.username || admin.email || normalizedUsername,
                email: admin.email || admin.username || normalizedUsername,
                role: admin.role || 'admin',
                name: admin.name || admin.username
            }
        });

    } catch (error) {
        console.error('❌ [ADMIN AUTH] Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during login',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * POST /api/admin/auth/verify
 * Verify admin JWT token
 * Accepts: Authorization header with Bearer token
 * Returns: { valid: true, admin: {...} }
 */
router.post('/verify', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                valid: false,
                message: 'No token provided',
                errorCode: 'NO_TOKEN'
            });
        }

        if (!JWT_SECRET) {
            return res.status(500).json({
                success: false,
                valid: false,
                message: 'Server configuration error: JWT_SECRET not set',
                errorCode: 'SERVER_CONFIG_ERROR'
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
                    valid: false,
                    message: 'Token expired',
                    errorCode: 'TOKEN_EXPIRED'
                });
            } else if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    success: false,
                    valid: false,
                    message: 'Invalid token',
                    errorCode: 'INVALID_TOKEN'
                });
            } else {
                throw jwtError;
            }
        }

        // Verify admin still exists and is active
        const adminLookup = (decoded && decoded.adminId && ObjectId.isValid(decoded.adminId))
            ? { _id: new ObjectId(decoded.adminId), active: { $ne: false } }
            : { username: decoded.username, active: { $ne: false } };

        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: adminLookup
        });

        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;

        if (!adminResult.success || !admin) {
            return res.status(401).json({
                success: false,
                valid: false,
                message: 'Admin account not found or disabled',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }

        // Return valid response
        res.json({
            success: true,
            valid: true,
            admin: {
                id: admin._id || admin.id,
                username: admin.username,
                role: admin.role || 'admin',
                name: admin.name || admin.username
            }
        });

    } catch (error) {
        console.error('❌ [ADMIN AUTH] Verify error:', error);
        res.status(500).json({
            success: false,
            valid: false,
            message: 'Internal server error during verification',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * POST /api/admin/auth/logout
 * Logout endpoint (client-side token removal)
 * Note: JWT tokens are stateless, so logout is handled client-side
 * This endpoint exists for consistency and can log logout events
 */
router.post('/logout', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            
            // Optionally decode token to log logout event
            try {
                if (JWT_SECRET) {
                    const decoded = jwt.decode(token);
                    if (decoded && decoded.adminId) {
                        // Could log logout event here if needed
                        console.log(`🔓 [ADMIN AUTH] Admin ${decoded.username} logged out`);
                    }
                }
            } catch (err) {
                // Ignore decode errors
            }
        }

        res.json({
            success: true,
            message: 'Logout successful. Please remove token from client storage.'
        });

    } catch (error) {
        console.error('❌ [ADMIN AUTH] Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during logout',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * POST /api/admin/auth/init
 * Initialize admin account (development/setup only)
 * WARNING: This should be protected or removed in production
 * Creates initial admin account if none exists
 */
router.post('/init', async (req, res) => {
    try {
        // Check if any admins exist
        const existingAdminsResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: {}
        });

        const existingAdmins = existingAdminsResult.success && existingAdminsResult.data
            ? (Array.isArray(existingAdminsResult.data) ? existingAdminsResult.data : [existingAdminsResult.data])
            : [];

        // Production-ready bootstrap: allow init ONLY if no admins exist.
        if (existingAdmins.length > 0) {
            return res.status(403).json({
                success: false,
                message: 'Init disabled after first admin. Please login instead.',
                errorCode: 'INIT_DISABLED'
            });
        }

        // Get default credentials from request or environment
        const { username, password, name } = req.body;
        const defaultUsername = (username || process.env.ADMIN_USERNAME || 'admin').toLowerCase().trim();
        const defaultPassword = password || process.env.ADMIN_PASSWORD || 'admin123';
        const adminName = name || process.env.ADMIN_NAME || 'Administrator';

        if (!defaultPassword || defaultPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        // Defensive: if an admin already exists with this username/email (race), return 409.
        const existingByUsername = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: { $or: [{ username: defaultUsername }, { email: defaultUsername }] }
        });
        const existingUserData = existingByUsername && existingByUsername.success ? existingByUsername.data : null;
        const existingAdmin = Array.isArray(existingUserData) ? existingUserData[0] : existingUserData;

        if (existingAdmin) {
            return res.status(409).json({
                success: false,
                message: 'Admin already exists',
                errorCode: 'ADMIN_EXISTS'
            });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);

        // Create admin account
        const newAdmin = {
            username: defaultUsername,
            email: defaultUsername,
            password: hashedPassword,
            name: adminName,
            role: 'admin',
            active: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const createResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--create',
            data: newAdmin
        });

        if (createResult.success) {
            console.log('✅ [ADMIN AUTH] Initial admin account created');
            res.json({
                success: true,
                message: 'Initial admin account created successfully',
                admin: {
                    username: newAdmin.username,
                    email: newAdmin.email,
                    name: newAdmin.name,
                    role: newAdmin.role
                },
                warning: 'Please change the default password after first login'
            });
        } else {
            const errMsg = (createResult && (createResult.error || createResult.message)) ? String(createResult.error || createResult.message) : '';
            const isDup = errMsg.includes('E11000') || errMsg.toLowerCase().includes('duplicate key');
            return res.status(isDup ? 409 : 500).json({
                success: false,
                message: isDup ? 'Admin already exists' : 'Failed to create admin account',
                errorCode: isDup ? 'ADMIN_EXISTS' : 'INTERNAL_SERVER_ERROR'
            });
        }

    } catch (error) {
        console.error('❌ [ADMIN AUTH] Init error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during admin initialization',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

module.exports = router;

