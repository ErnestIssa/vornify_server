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
                error: 'Username and password are required'
            });
        }

        if (!JWT_SECRET) {
            return res.status(500).json({
                success: false,
                error: 'Server configuration error: JWT_SECRET not set'
            });
        }

        // Find admin in database
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            // VortexDB expects the query directly (NOT { filter: ... })
            data: { username: normalizedUsername }
        });

        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;

        if (!adminResult.success || !admin) {
            // Return generic error to prevent username enumeration
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        if (!admin.password || typeof admin.password !== 'string') {
            return res.status(500).json({
                success: false,
                error: 'Admin account is misconfigured (missing password hash). Please re-create the admin account.',
                errorCode: 'ADMIN_PASSWORD_MISSING'
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
                    const filter = (admin._id && ObjectId.isValid(admin._id)) ? { _id: new ObjectId(admin._id) } : { username: normalizedUsername };
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'admins',
                        command: '--update',
                        data: {
                            filter,
                            update: {
                                password: upgradedHash,
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
                error: 'Invalid username or password'
            });
        }

        // Check if admin is active
        if (admin.active === false) {
            return res.status(403).json({
                success: false,
                error: 'Admin account is disabled'
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
        const updateFilter = (admin._id && ObjectId.isValid(admin._id)) ? { _id: new ObjectId(admin._id) } : { username: normalizedUsername };
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
                username: admin.username,
                role: admin.role || 'admin',
                name: admin.name || admin.username
            }
        });

    } catch (error) {
        console.error('❌ [ADMIN AUTH] Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during login'
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
                valid: false,
                error: 'No token provided'
            });
        }

        if (!JWT_SECRET) {
            return res.status(500).json({
                valid: false,
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
                    valid: false,
                    error: 'Token expired'
                });
            } else if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    valid: false,
                    error: 'Invalid token'
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
                valid: false,
                error: 'Admin account not found or disabled'
            });
        }

        // Return valid response
        res.json({
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
            valid: false,
            error: 'Internal server error during verification'
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
            error: 'Internal server error during logout'
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

        // Get default credentials from request or environment
        const { username, password, name } = req.body;
        const defaultUsername = (username || process.env.ADMIN_USERNAME || 'admin').toLowerCase().trim();
        const defaultPassword = password || process.env.ADMIN_PASSWORD || 'admin123';
        const adminName = name || process.env.ADMIN_NAME || 'Administrator';

        if (!defaultPassword || defaultPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 6 characters long'
            });
        }

        // If an admin already exists with this username, allow "upgrade" if it was created incorrectly (plaintext password)
        const existingByUsername = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: { username: defaultUsername }
        });
        const existingUserData = existingByUsername && existingByUsername.success ? existingByUsername.data : null;
        const existingAdmin = Array.isArray(existingUserData) ? existingUserData[0] : existingUserData;

        if (existingAdmin) {
            const looksLikeBcryptHash = typeof existingAdmin.password === 'string' &&
                (existingAdmin.password.startsWith('$2a$') || existingAdmin.password.startsWith('$2b$') || existingAdmin.password.startsWith('$2y$'));

            if (looksLikeBcryptHash) {
                return res.status(409).json({
                    success: false,
                    error: 'Admin account already exists. Please login instead.',
                    errorCode: 'ADMIN_ALREADY_EXISTS'
                });
            }

            if (existingAdmin.password !== defaultPassword) {
                return res.status(409).json({
                    success: false,
                    error: 'Admin account already exists, but the password does not match. Please login with the existing password or reset it.',
                    errorCode: 'ADMIN_EXISTS_PASSWORD_MISMATCH'
                });
            }

            // Upgrade plaintext password to bcrypt
            const upgradedHash = await bcrypt.hash(defaultPassword, 10);
            const filter = (existingAdmin._id && ObjectId.isValid(existingAdmin._id)) ? { _id: new ObjectId(existingAdmin._id) } : { username: defaultUsername };
            const upgradeResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'admins',
                command: '--update',
                data: {
                    filter,
                    update: {
                        password: upgradedHash,
                        name: existingAdmin.name || adminName,
                        updatedAt: new Date().toISOString(),
                        passwordUpgradedAt: new Date().toISOString()
                    }
                }
            });

            if (!upgradeResult.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to upgrade admin password hashing',
                    errorCode: 'PASSWORD_UPGRADE_FAILED'
                });
            }

            return res.json({
                success: true,
                message: 'Admin account already existed; password was upgraded to secure hashing. You can now login.',
                admin: {
                    username: defaultUsername,
                    name: existingAdmin.name || adminName,
                    role: existingAdmin.role || 'admin'
                }
            });
        }

        // If ANY admin exists already, disable init to prevent arbitrary admin creation
        if (existingAdmins.length > 0) {
            return res.status(403).json({
                success: false,
                error: 'Admin initialization is disabled because an admin already exists. Please login instead.',
                errorCode: 'INIT_DISABLED'
            });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);

        // Create admin account
        const newAdmin = {
            username: defaultUsername,
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
                    name: newAdmin.name,
                    role: newAdmin.role
                },
                warning: 'Please change the default password after first login'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to create admin account',
                details: createResult
            });
        }

    } catch (error) {
        console.error('❌ [ADMIN AUTH] Init error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during admin initialization'
        });
    }
});

module.exports = router;

