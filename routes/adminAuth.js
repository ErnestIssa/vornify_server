const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ObjectId } = require('mongodb');
const getDBInstance = require('../vornifydb/dbInstance');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const logAdminActivity = require('../utils/auditLogger');
const emailService = require('../services/emailService');

const router = express.Router();
const db = getDBInstance();

/**
 * Enhanced password validation
 * Requirements: min 12 chars, uppercase, lowercase, number, special character
 */
function validatePassword(password) {
    if (!password || password.length < 12) {
        return { valid: false, error: 'Password must be at least 12 characters long' };
    }
    
    if (!/[A-Z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one uppercase letter' };
    }
    
    if (!/[a-z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one lowercase letter' };
    }
    
    if (!/[0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one number' };
    }
    
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one special character' };
    }
    
    return { valid: true };
}

// JWT secret from environment variable (required)
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'; // Access token: 15 minutes
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d'; // Refresh token: 7 days

// Admin app base URL for invite and reset links (admin panel, not backend or main store)
const getAdminAppBaseUrl = () => {
    const url = (process.env.ADMIN_APP_BASE_URL || process.env.FRONTEND_ADMIN_URL || process.env.ADMIN_FRONTEND_URL || 'https://peakmode-admin.onrender.com').trim();
    return url.replace(/\/$/, '');
};

// Account lock configuration
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// Rate limiting for login endpoint (IP-based brute force protection)
const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per IP per 15 minutes
    message: {
        success: false,
        message: 'Too many login attempts from this IP, please try again later',
        errorCode: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for whitelisted IPs (optional)
        const whitelistedIPs = process.env.ADMIN_IP_WHITELIST ? process.env.ADMIN_IP_WHITELIST.split(',') : [];
        return whitelistedIPs.includes(req.ip);
    }
});

if (!JWT_SECRET) {
    console.warn('⚠️  [ADMIN AUTH] JWT_SECRET not set. Admin authentication will fail.');
    console.warn('⚠️  [ADMIN AUTH] Please set JWT_SECRET or ADMIN_JWT_SECRET environment variable.');
}

/**
 * POST /api/admin/auth/login
 * Admin login endpoint
 * Accepts: { email, password } (also supports legacy { username, password })
 * Returns: { success: true, data: { admin: {...}, token: "..." } }
 * Sets refresh token in httpOnly cookie
 */
router.post('/login', loginRateLimit, async (req, res) => {
    try {
        // Support both 'email' and 'username' for backward compatibility
        const { email, username, password } = req.body;
        const emailOrUsername = email || username;
        const normalizedEmail = String(emailOrUsername || '').toLowerCase().trim();

        console.log('🔐 [ADMIN AUTH LOGIN] Request received:', {
            email: normalizedEmail,
            passwordLength: password ? password.length : 0,
            timestamp: new Date().toISOString()
        });

        if (!normalizedEmail || !password) {
            console.log('❌ [ADMIN AUTH LOGIN] Missing email or password');
            return res.status(400).json({
                success: false,
                message: 'Email and password are required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        // Email domain validation: Only @peakmode.se emails allowed
        if (!normalizedEmail.endsWith('@peakmode.se')) {
            console.log('❌ [ADMIN AUTH LOGIN] Invalid email domain:', normalizedEmail);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                errorCode: 'INVALID_CREDENTIALS'
            });
        }

        if (!JWT_SECRET) {
            console.error('❌ [ADMIN AUTH LOGIN] JWT_SECRET not configured');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error: JWT_SECRET not set',
                errorCode: 'SERVER_CONFIG_ERROR'
            });
        }

        // Find admin in database by email (primary) or username (backward compatibility)
        console.log('🔍 [ADMIN AUTH LOGIN] Searching admin by email/username:', normalizedEmail);
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: { $or: [{ email: normalizedEmail }, { username: normalizedEmail }] }
        });

        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;

        if (!adminResult.success || !admin) {
            console.log('❌ [ADMIN AUTH LOGIN] Admin not found for:', normalizedEmail);
            // Return generic error to prevent email enumeration
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                errorCode: 'INVALID_CREDENTIALS'
            });
        }

        console.log('✅ [ADMIN AUTH LOGIN] Admin found:', {
            id: admin._id || admin.id,
            email: admin.email,
            name: admin.name,
            role: admin.role,
            status: admin.status,
            lockedUntil: admin.lockedUntil,
            failedLoginAttempts: admin.failedLoginAttempts || 0
        });

        // Check if account is locked
        const now = new Date();
        if (admin.lockedUntil && new Date(admin.lockedUntil) > now) {
            const lockExpiresAt = new Date(admin.lockedUntil);
            const minutesRemaining = Math.ceil((lockExpiresAt - now) / (1000 * 60));
            console.log('❌ [ADMIN AUTH LOGIN] 403 ACCOUNT_LOCKED until:', lockExpiresAt.toISOString(), 'Origin:', req.get('origin'));
            return res.status(403).json({
                success: false,
                message: `Account is locked. Please try again in ${minutesRemaining} minute(s).`,
                errorCode: 'ACCOUNT_LOCKED'
            });
        }

        // If lock expired, clear it
        if (admin.lockedUntil && new Date(admin.lockedUntil) <= now) {
            console.log('✅ [ADMIN AUTH LOGIN] Lock expired, clearing lock status');
            const updateFilter = (admin._id && ObjectId.isValid(admin._id))
                ? { _id: new ObjectId(admin._id) }
                : { email: normalizedEmail };
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'admins',
                command: '--update',
                data: {
                    filter: updateFilter,
                    update: {
                        lockedUntil: null,
                        failedLoginAttempts: 0,
                        updatedAt: new Date().toISOString()
                    }
                }
            });
        }

        if (!admin.password || typeof admin.password !== 'string') {
            console.log('❌ [ADMIN AUTH LOGIN] Admin has no password field');
            // Treat as invalid credentials (do not leak account state)
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                errorCode: 'INVALID_CREDENTIALS'
            });
        }

        // Verify password
        const looksLikeBcryptHash = admin.password.startsWith('$2a$') || admin.password.startsWith('$2b$') || admin.password.startsWith('$2y$');
        let passwordMatch = false;

        if (looksLikeBcryptHash) {
            passwordMatch = await bcrypt.compare(password, admin.password);
        } else {
            // Legacy plaintext password - upgrade to bcrypt
            if (admin.password === password) {
                passwordMatch = true;
                console.log('✅ [ADMIN AUTH LOGIN] Plaintext password matches, upgrading to bcrypt...');
                try {
                    const upgradedHash = await bcrypt.hash(password, 10);
                    const filter = (admin._id && ObjectId.isValid(admin._id))
                        ? { _id: new ObjectId(admin._id) }
                        : { email: normalizedEmail };
                    await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'admins',
                        command: '--update',
                        data: {
                            filter,
                            update: {
                                password: upgradedHash,
                                email: admin.email || normalizedEmail,
                                updatedAt: new Date().toISOString()
                            }
                        }
                    });
                } catch (upgradeErr) {
                    console.error('⚠️ [ADMIN AUTH LOGIN] Password upgrade failed:', upgradeErr.message);
                }
            }
        }

        if (!passwordMatch) {
            console.log('❌ [ADMIN AUTH LOGIN] Password verification failed');
            
            // Increment failed login attempts
            const currentAttempts = (admin.failedLoginAttempts || 0) + 1;
            const updateFilter = (admin._id && ObjectId.isValid(admin._id))
                ? { _id: new ObjectId(admin._id) }
                : { email: normalizedEmail };
            
            const updateData = {
                failedLoginAttempts: currentAttempts,
                updatedAt: new Date().toISOString()
            };

            // Lock account if max attempts reached
            if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
                updateData.lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
                console.log('🔒 [ADMIN AUTH LOGIN] Account locked due to too many failed attempts');
            }

            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'admins',
                command: '--update',
                data: { filter: updateFilter, update: updateData }
            });

            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                errorCode: 'INVALID_CREDENTIALS'
            });
        }

        // Check if admin status is active
        if (admin.status && admin.status !== 'active') {
            console.log('❌ [ADMIN AUTH LOGIN] 403 ADMIN_DISABLED status:', admin.status, 'Origin:', req.get('origin'));
            return res.status(403).json({
                success: false,
                message: 'Admin account is not active',
                errorCode: 'ADMIN_DISABLED'
            });
        }

        // Also check legacy 'active' field for backward compatibility
        if (admin.active === false) {
            console.log('❌ [ADMIN AUTH LOGIN] 403 ADMIN_DISABLED (legacy active=false) Origin:', req.get('origin'));
            return res.status(403).json({
                success: false,
                message: 'Admin account is disabled',
                errorCode: 'ADMIN_DISABLED'
            });
        }

        // Login successful - reset failed attempts and clear lock
        const adminId = admin._id || admin.id;
        const updateFilter = ObjectId.isValid(adminId)
            ? { _id: new ObjectId(adminId) }
            : { email: normalizedEmail };

        // Generate access token (15 minutes)
        const accessTokenPayload = {
            adminId: adminId,
            email: admin.email || normalizedEmail,
            role: admin.role || 'admin'
        };
        const accessToken = jwt.sign(accessTokenPayload, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN
        });

        // Generate refresh token (7 days)
        const refreshTokenPayload = {
            adminId: adminId,
            email: admin.email || normalizedEmail,
            role: admin.role || 'admin',
            type: 'refresh'
        };
        const refreshToken = jwt.sign(refreshTokenPayload, JWT_SECRET, {
            expiresIn: JWT_REFRESH_EXPIRES_IN
        });

        // Store refresh token in database
        const refreshTokens = admin.refreshTokens || [];
        refreshTokens.push({
            token: refreshToken,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
            revoked: false,
            revokedAt: null
        });

        // Update admin: clear failed attempts, update last login, store refresh token
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--update',
            data: {
                filter: updateFilter,
                update: {
                    failedLoginAttempts: 0,
                    lockedUntil: null,
                    lastLoginAt: new Date().toISOString(),
                    refreshTokens: refreshTokens,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        console.log('✅ [ADMIN AUTH LOGIN] Login successful, tokens generated');
        
        // Log successful login
        await logAdminActivity({
            adminId: adminId,
            adminEmail: admin.email || normalizedEmail,
            action: 'login',
            details: { role: admin.role || 'admin' },
            ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown',
            userAgent: req.get('user-agent') || 'unknown',
            success: true
        });
        
        // Set refresh token in httpOnly cookie (secure, not accessible via JavaScript)
        // Cross-origin: admin app (e.g. peakmode-admin.onrender.com) and API (vornify-server.onrender.com)
        // are different origins, so cookie must use sameSite: 'none' and secure: true to be sent.
        const isProduction = process.env.NODE_ENV === 'production';
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax', // 'none' required for cross-origin (deployed admin → API)
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/api/admin/auth'
        });
        
        // Return success response (access token only, refresh token in cookie)
        res.json({
            success: true,
            data: {
                admin: {
                    id: adminId,
                    name: admin.name || admin.email || normalizedEmail,
                    email: admin.email || normalizedEmail,
                    role: admin.role || 'admin',
                    status: admin.status || 'active'
                },
                token: accessToken
                // refreshToken is in httpOnly cookie, not in response
            }
        });

    } catch (error) {
        console.error('❌ [ADMIN AUTH LOGIN] Error:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
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
 * Logout endpoint - revokes refresh token
 * Authentication: Optional (can revoke specific refresh token)
 * Reads refresh token from httpOnly cookie (fallback to body for backward compatibility)
 * Returns: { success: true, message: "Logged out successfully" }
 * Clears refresh token cookie
 */
router.post('/logout', async (req, res) => {
    try {
        // Read refresh token from cookie (preferred) or body (backward compatibility)
        let tokenToRevoke = req.cookies.refreshToken || req.body.refreshToken;

        // If refresh token not in cookie/body, try to get from Authorization header (access token)
        if (!tokenToRevoke) {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                tokenToRevoke = authHeader.substring(7);
            }
        }

        if (!tokenToRevoke) {
            // No token provided, just return success (client will clear tokens)
            return res.json({
                success: true,
                message: 'Logout successful. Please remove tokens from client storage.'
            });
        }

        // Verify and decode token to get admin ID
        let decoded;
        try {
            decoded = jwt.verify(tokenToRevoke.trim(), JWT_SECRET);
        } catch (jwtError) {
            // Token is invalid or expired, but we'll still return success
            // (client should clear tokens anyway)
            console.log('⚠️ [LOGOUT] Invalid or expired token provided, but logout still successful');
            return res.json({
                success: true,
                message: 'Logout successful. Please remove tokens from client storage.'
            });
        }

        // Find admin and revoke refresh token
        const adminId = decoded.adminId;
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

        if (admin && admin.refreshTokens) {
            // Revoke the refresh token
            const updatedRefreshTokens = admin.refreshTokens.map(t => {
                if (t.token === tokenToRevoke.trim() && !t.revoked) {
                    return {
                        ...t,
                        revoked: true,
                        revokedAt: new Date().toISOString()
                    };
                }
                return t;
            });

            // Update admin with revoked token
            const updateFilter = ObjectId.isValid(adminId)
                ? { _id: new ObjectId(adminId) }
                : { _id: adminId };

            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'admins',
                command: '--update',
                data: {
                    filter: updateFilter,
                    update: {
                        refreshTokens: updatedRefreshTokens,
                        updatedAt: new Date().toISOString()
                    }
                }
            });

            console.log(`✅ [LOGOUT] Refresh token revoked for admin ${decoded.email || decoded.username}`);
        }

        // Log logout if we have admin info
        if (decoded && decoded.adminId) {
            await logAdminActivity({
                adminId: decoded.adminId,
                adminEmail: decoded.email,
                action: 'logout',
                ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown',
                userAgent: req.get('user-agent') || 'unknown',
                success: true
            });
        }

        // Clear refresh token cookie (same options as when it was set)
        const isProduction = process.env.NODE_ENV === 'production';
        res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax',
            path: '/api/admin/auth'
        });

        res.json({
            success: true,
            message: 'Logged out successfully. Refresh token has been revoked.'
        });

    } catch (error) {
        console.error('❌ [ADMIN AUTH] Logout error:', error);
        // Even if there's an error, return success (client should clear tokens)
        res.json({
            success: true,
            message: 'Logout successful. Please remove tokens from client storage.'
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

/**
 * GET /api/admin/auth/diagnostic
 * Diagnostic endpoint to check admin database state
 * Returns admin count, admin list (without passwords), and password info
 */
router.get('/diagnostic', async (req, res) => {
    try {
        console.log('🔍 [ADMIN AUTH DIAGNOSTIC] Request received');

        // Get all admins (without passwords for security)
        const allAdminsResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: {}
        });

        const allAdminsData = allAdminsResult.success && allAdminsResult.data
            ? (Array.isArray(allAdminsResult.data) ? allAdminsResult.data : [allAdminsResult.data])
            : [];

        const adminCount = allAdminsData.length;

        // Get one admin with password info (for debugging - sanitized)
        let passwordInfo = null;
        if (allAdminsData.length > 0) {
            const sampleAdmin = allAdminsData[0];
            passwordInfo = {
                hasPassword: !!sampleAdmin.password,
                passwordLength: sampleAdmin.password ? sampleAdmin.password.length : 0,
                passwordType: typeof sampleAdmin.password,
                passwordStartsWith: sampleAdmin.password ? sampleAdmin.password.substring(0, 10) : null,
                isBcryptHash: sampleAdmin.password ? (
                    sampleAdmin.password.startsWith('$2b$') ||
                    sampleAdmin.password.startsWith('$2a$') ||
                    sampleAdmin.password.startsWith('$2y$')
                ) : false
            };
        }

        // Format admin list (exclude passwords)
        const adminsList = allAdminsData.map(a => ({
            id: a._id || a.id,
            username: a.username,
            email: a.email,
            name: a.name,
            role: a.role || 'admin',
            active: a.active !== false,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
            lastLoginAt: a.lastLoginAt
        }));

        console.log('🔍 [ADMIN AUTH DIAGNOSTIC] Results:', {
            adminCount,
            admins: adminsList.map(a => ({ id: a.id, username: a.username, email: a.email })),
            passwordInfo
        });

        res.json({
            success: true,
            adminCount,
            admins: adminsList,
            passwordInfo,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [ADMIN AUTH DIAGNOSTIC] Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * POST /api/admin/auth/reset-password
 * Reset admin password (requires reset secret or no admins exist)
 * Body: { username, newPassword, resetSecret? }
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { username, newPassword, resetSecret } = req.body;

        if (!username || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Username and newPassword are required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        // Check reset secret if set in env (optional security)
        const requiredSecret = process.env.ADMIN_RESET_SECRET;
        if (requiredSecret && resetSecret !== requiredSecret) {
            return res.status(403).json({
                success: false,
                message: 'Invalid reset secret',
                errorCode: 'INVALID_SECRET'
            });
        }

        const normalizedUsername = String(username).toLowerCase().trim();

        // Find admin
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: { $or: [{ username: normalizedUsername }, { email: normalizedUsername }] }
        });

        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;

        if (!adminResult.success || !admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        const filter = (admin._id && ObjectId.isValid(admin._id))
            ? { _id: new ObjectId(admin._id) }
            : { $or: [{ username: normalizedUsername }, { email: normalizedUsername }] };

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--update',
            data: {
                filter,
                update: {
                    password: hashedPassword,
                    updatedAt: new Date().toISOString(),
                    passwordResetAt: new Date().toISOString()
                }
            }
        });

        if (updateResult.success) {
            console.log(`✅ [ADMIN AUTH RESET] Password reset for ${normalizedUsername}`);
            res.json({
                success: true,
                message: 'Password reset successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to reset password',
                errorCode: 'UPDATE_FAILED'
            });
        }

    } catch (error) {
        console.error('❌ [ADMIN AUTH RESET] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * POST /api/admin/invite
 * Create invite for new admin (super_admin only)
 * Authentication: Requires JWT token with super_admin role
 * Request Body: { name: string, email: string }
 * Returns: { success: true, data: { inviteToken, expiresAt, inviteLink } }
 */
router.post('/invite', authenticateAdmin, requireSuperAdmin, async (req, res) => {
    try {
        const { name, email } = req.body;

        console.log('📧 [ADMIN INVITE] Request received:', {
            name,
            email,
            requester: req.admin.email || req.admin.username
        });

        // Validate required fields
        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Admin name is required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        if (!email || !email.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Email is required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        const normalizedEmail = String(email).toLowerCase().trim();

        // Email domain validation: Only @peakmode.se emails allowed
        if (!normalizedEmail.endsWith('@peakmode.se')) {
            return res.status(400).json({
                success: false,
                message: 'Email must end with @peakmode.se',
                errorCode: 'INVALID_EMAIL_DOMAIN'
            });
        }

        // Check if email already exists
        const existingAdminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: { email: normalizedEmail }
        });

        const existingAdminData = existingAdminResult && existingAdminResult.success ? existingAdminResult.data : null;
        const existingAdmin = Array.isArray(existingAdminData) ? existingAdminData[0] : existingAdminData;

        if (existingAdmin) {
            return res.status(409).json({
                success: false,
                message: 'An admin with this email already exists',
                errorCode: 'ADMIN_EXISTS'
            });
        }

        // Check total admin count (max 2 admins: 1 super_admin + 1 admin)
        const allAdminsResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: {}
        });

        const allAdminsData = allAdminsResult && allAdminsResult.success ? allAdminsResult.data : null;
        const allAdmins = Array.isArray(allAdminsData) ? allAdminsData : (allAdminsData ? [allAdminsData] : []);

        if (allAdmins.length >= 2) {
            return res.status(400).json({
                success: false,
                message: 'Maximum admin limit reached (2 admins)',
                errorCode: 'MAX_ADMINS_REACHED'
            });
        }

        // Generate secure invite token (32 bytes = 64 hex characters)
        const inviteToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

        // Create admin record with invite token (status: 'pending' until invite is accepted)
        const invitedByEmail = req.admin.email || req.admin.username || null;
        const invitedByName = req.admin.name || req.admin.email || req.admin.username || 'Super Admin';
        const newAdmin = {
            name: name.trim(),
            email: normalizedEmail,
            password: null, // Will be set when invite is accepted
            role: 'admin', // New admins are always 'admin', not 'super_admin'
            status: 'pending', // Will be set to 'active' when invite is accepted
            inviteToken: inviteToken,
            inviteExpiresAt: expiresAt.toISOString(),
            invitedByEmail,
            invitedByName,
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: null,
            refreshTokens: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const createResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--create',
            data: newAdmin
        });

        if (!createResult.success) {
            const errMsg = (createResult && (createResult.error || createResult.message)) ? String(createResult.error || createResult.message) : '';
            const isDup = errMsg.includes('E11000') || errMsg.toLowerCase().includes('duplicate key');
            return res.status(isDup ? 409 : 500).json({
                success: false,
                message: isDup ? 'An admin with this email already exists' : 'Failed to create invite',
                errorCode: isDup ? 'ADMIN_EXISTS' : 'INTERNAL_SERVER_ERROR'
            });
        }

        // Generate invite link (must point to admin panel, e.g. peakmode-admin.onrender.com)
        const inviteLink = `${getAdminAppBaseUrl()}/accept-invite?token=${inviteToken}`;
        const expiryHours = 24;
        const year = new Date().getFullYear();

        // Send emails (after invite created; do not block response on email failure)
        try {
            await emailService.sendAdminInviteEmail(normalizedEmail, {
                admin_name: name.trim(),
                admin_email: normalizedEmail,
                invited_by: invitedByName,
                invite_link: inviteLink,
                expiry_hours: expiryHours,
                year
            });
            if (invitedByEmail) {
                await emailService.sendSuperAdminInviteNotification(invitedByEmail, {
                    admin_name: name.trim(),
                    admin_email: normalizedEmail,
                    invite_link: inviteLink,
                    year
                });
            }
        } catch (emailErr) {
            console.error('❌ [ADMIN INVITE] Email send error (invite still created):', emailErr.message);
        }

        // Log invite sent
        await logAdminActivity({
            adminId: req.admin.id,
            adminEmail: req.admin.email,
            action: 'invite_sent',
            details: { invitedEmail: normalizedEmail, invitedName: name.trim() },
            ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown',
            userAgent: req.get('user-agent') || 'unknown',
            success: true
        });

        console.log('✅ [ADMIN INVITE] Invite created successfully:', {
            email: normalizedEmail,
            expiresAt: expiresAt.toISOString()
        });

        res.json({
            success: true,
            data: {
                inviteToken: inviteToken,
                expiresAt: expiresAt.toISOString(),
                inviteLink: inviteLink
            }
        });

    } catch (error) {
        console.error('❌ [ADMIN INVITE] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during invite creation',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * POST /api/admin/accept-invite
 * Accept invite and set password for new admin
 * Public endpoint (no authentication required)
 * Request Body: { token: string, password: string, confirmPassword: string }
 * Returns: { success: true, data: { admin: {...}, token: "...", refreshToken: "..." } }
 */
router.post('/accept-invite', async (req, res) => {
    try {
        const { token, password, confirmPassword } = req.body;

        console.log('📧 [ACCEPT INVITE] Request received:', {
            tokenLength: token ? token.length : 0,
            hasPassword: !!password,
            timestamp: new Date().toISOString()
        });

        // Validate required fields
        if (!token || !token.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Invite token is required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        if (!password || !password.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Password is required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        if (!confirmPassword || !confirmPassword.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Password confirmation is required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        // Validate password match
        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Passwords do not match',
                errorCode: 'PASSWORD_MISMATCH'
            });
        }

        // Enhanced password validation (min 12 characters with complexity)
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
            return res.status(400).json({
                success: false,
                message: passwordValidation.error,
                errorCode: 'PASSWORD_VALIDATION_FAILED'
            });
        }

        if (!JWT_SECRET) {
            console.error('❌ [ACCEPT INVITE] JWT_SECRET not configured');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error: JWT_SECRET not set',
                errorCode: 'SERVER_CONFIG_ERROR'
            });
        }

        // Find admin by invite token
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: { inviteToken: token.trim() }
        });

        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;

        if (!adminResult.success || !admin) {
            console.log('❌ [ACCEPT INVITE] Admin not found for token');
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired invite token',
                errorCode: 'INVALID_INVITE_TOKEN'
            });
        }

        console.log('✅ [ACCEPT INVITE] Admin found:', {
            id: admin._id || admin.id,
            email: admin.email,
            inviteExpiresAt: admin.inviteExpiresAt
        });

        // Email domain validation: Only @peakmode.se emails allowed
        if (!admin.email || !admin.email.endsWith('@peakmode.se')) {
            console.log('❌ [ACCEPT INVITE] Invalid email domain:', admin.email);
            return res.status(400).json({
                success: false,
                message: 'Invalid email domain. Only @peakmode.se emails are allowed.',
                errorCode: 'INVALID_EMAIL_DOMAIN'
            });
        }

        // Check max admin limit before accepting invite
        const allAdminsResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: {}
        });

        const allAdminsData = allAdminsResult && allAdminsResult.success ? allAdminsResult.data : null;
        const allAdmins = Array.isArray(allAdminsData) ? allAdminsData : (allAdminsData ? [allAdminsData] : []);

        // Count active and pending admins (exclude this pending invite)
        const activeAdmins = allAdmins.filter(a => 
            (a.status === 'active' || a.status === 'pending') && 
            (a._id?.toString() !== (admin._id || admin.id)?.toString())
        );

        if (activeAdmins.length >= 2) {
            console.log('❌ [ACCEPT INVITE] Max admin limit reached');
            return res.status(400).json({
                success: false,
                message: 'Maximum admin limit reached (2 admins)',
                errorCode: 'MAX_ADMINS_REACHED'
            });
        }

        // Check if token is expired
        if (!admin.inviteExpiresAt) {
            console.log('❌ [ACCEPT INVITE] No expiry date found');
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired invite token',
                errorCode: 'INVALID_INVITE_TOKEN'
            });
        }

        const expiresAt = new Date(admin.inviteExpiresAt);
        const now = new Date();

        if (expiresAt <= now) {
            console.log('❌ [ACCEPT INVITE] Token expired:', {
                expiresAt: expiresAt.toISOString(),
                now: now.toISOString()
            });
            return res.status(400).json({
                success: false,
                message: 'Invite token has expired. Please request a new invite.',
                errorCode: 'INVITE_TOKEN_EXPIRED'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update admin: set password, clear invite fields, set status to active
        const adminId = admin._id || admin.id;
        const updateFilter = ObjectId.isValid(adminId)
            ? { _id: new ObjectId(adminId) }
            : { inviteToken: token.trim() };

        // Generate access token (15 minutes)
        const accessTokenPayload = {
            adminId: adminId,
            email: admin.email,
            role: admin.role || 'admin'
        };
        const accessToken = jwt.sign(accessTokenPayload, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN
        });

        // Generate refresh token (7 days)
        const refreshTokenPayload = {
            adminId: adminId,
            email: admin.email,
            role: admin.role || 'admin',
            type: 'refresh'
        };
        const refreshToken = jwt.sign(refreshTokenPayload, JWT_SECRET, {
            expiresIn: JWT_REFRESH_EXPIRES_IN
        });

        // Store refresh token in database
        const refreshTokens = [{
            token: refreshToken,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
            revoked: false,
            revokedAt: null
        }];

        // Update admin record
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--update',
            data: {
                filter: updateFilter,
                update: {
                    password: hashedPassword,
                    status: 'active',
                    inviteToken: null,
                    inviteExpiresAt: null,
                    refreshTokens: refreshTokens,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            console.error('❌ [ACCEPT INVITE] Failed to update admin:', updateResult);
            return res.status(500).json({
                success: false,
                message: 'Failed to accept invite',
                errorCode: 'UPDATE_FAILED'
            });
        }

        // Send "Admin Account Activated" email to the activated admin and to the super admin who invited
        const activatedAt = new Date();
        const activatedAtFormatted = activatedAt.toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short'
        });
        const activationData = {
            admin_name: admin.name || admin.email,
            admin_email: admin.email,
            activated_at: activatedAtFormatted,
            year: activatedAt.getFullYear()
        };
        try {
            await emailService.sendAdminActivatedEmail(admin.email, activationData);
            if (admin.invitedByEmail && admin.invitedByEmail !== admin.email) {
                await emailService.sendAdminActivatedEmail(admin.invitedByEmail, activationData);
            }
        } catch (emailErr) {
            console.error('❌ [ACCEPT INVITE] Activation email send error (account still activated):', emailErr.message);
        }

        // Log invite accepted
        await logAdminActivity({
            adminId: adminId,
            adminEmail: admin.email,
            action: 'invite_accepted',
            details: { role: admin.role || 'admin' },
            ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown',
            userAgent: req.get('user-agent') || 'unknown',
            success: true
        });

        console.log('✅ [ACCEPT INVITE] Invite accepted successfully:', {
            email: admin.email,
            role: admin.role
        });

        // Set refresh token in httpOnly cookie (sameSite: 'none' in prod for cross-origin)
        const isProduction = process.env.NODE_ENV === 'production';
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/api/admin/auth'
        });

        // Return success response (access token only, refresh token in cookie)
        res.json({
            success: true,
            data: {
                admin: {
                    id: adminId,
                    name: admin.name,
                    email: admin.email,
                    role: admin.role || 'admin',
                    status: 'active'
                },
                token: accessToken
                // refreshToken is in httpOnly cookie, not in response
            }
        });

    } catch (error) {
        console.error('❌ [ACCEPT INVITE] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during invite acceptance',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * POST /api/admin/auth/refresh
 * Refresh access token using refresh token
 * Public endpoint (no authentication required, but requires refresh token)
 * Reads refresh token from httpOnly cookie (fallback to body for backward compatibility)
 * Returns: { success: true, data: { token: "..." } }
 * Sets new refresh token in httpOnly cookie
 */
router.post('/refresh', async (req, res) => {
    try {
        // Read refresh token from cookie (preferred) or body (backward compatibility)
        const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

        console.log('🔄 [REFRESH TOKEN] Request received');

        if (!refreshToken || !refreshToken.trim()) {
            // No session (e.g. first load, or cookie not sent cross-origin). Use 401 so frontend shows login.
            return res.status(401).json({
                success: false,
                message: 'No refresh token. Please log in.',
                errorCode: 'NO_REFRESH_TOKEN'
            });
        }

        if (!JWT_SECRET) {
            console.error('❌ [REFRESH TOKEN] JWT_SECRET not configured');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error: JWT_SECRET not set',
                errorCode: 'SERVER_CONFIG_ERROR'
            });
        }

        // Verify refresh token
        let decoded;
        try {
            decoded = jwt.verify(refreshToken.trim(), JWT_SECRET);
        } catch (jwtError) {
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    message: 'Refresh token expired. Please login again.',
                    errorCode: 'REFRESH_TOKEN_EXPIRED'
                });
            } else if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid refresh token',
                    errorCode: 'INVALID_REFRESH_TOKEN'
                });
            } else {
                throw jwtError;
            }
        }

        // Verify it's a refresh token (not an access token)
        if (decoded.type !== 'refresh') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token type. Refresh token required.',
                errorCode: 'INVALID_TOKEN_TYPE'
            });
        }

        // Find admin
        const adminId = decoded.adminId;
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

        if (!adminResult.success || !admin) {
            return res.status(401).json({
                success: false,
                message: 'Admin account not found',
                errorCode: 'ADMIN_NOT_FOUND'
            });
        }

        // Check if admin is active
        if (admin.status && admin.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Admin account is not active',
                errorCode: 'ADMIN_DISABLED'
            });
        }

        // Check if refresh token exists in database and is not revoked
        const refreshTokens = admin.refreshTokens || [];
        const tokenRecord = refreshTokens.find(t => t.token === refreshToken.trim());

        if (!tokenRecord) {
            return res.status(401).json({
                success: false,
                message: 'Refresh token not found or has been revoked',
                errorCode: 'REFRESH_TOKEN_REVOKED'
            });
        }

        if (tokenRecord.revoked) {
            return res.status(401).json({
                success: false,
                message: 'Refresh token has been revoked',
                errorCode: 'REFRESH_TOKEN_REVOKED'
            });
        }

        // Check if token is expired (database expiry check)
        if (tokenRecord.expiresAt && new Date(tokenRecord.expiresAt) <= new Date()) {
            return res.status(401).json({
                success: false,
                message: 'Refresh token expired',
                errorCode: 'REFRESH_TOKEN_EXPIRED'
            });
        }

        // Generate new access token (15 minutes)
        const accessTokenPayload = {
            adminId: adminId,
            email: admin.email || decoded.email,
            role: admin.role || decoded.role || 'admin'
        };
        const newAccessToken = jwt.sign(accessTokenPayload, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN
        });

        // Generate new refresh token (token rotation for security)
        const newRefreshTokenPayload = {
            adminId: adminId,
            email: admin.email || decoded.email,
            role: admin.role || decoded.role || 'admin',
            type: 'refresh'
        };
        const newRefreshToken = jwt.sign(newRefreshTokenPayload, JWT_SECRET, {
            expiresIn: JWT_REFRESH_EXPIRES_IN
        });

        // Revoke old refresh token and add new one
        const updatedRefreshTokens = refreshTokens.map(t => {
            if (t.token === refreshToken.trim()) {
                return {
                    ...t,
                    revoked: true,
                    revokedAt: new Date().toISOString()
                };
            }
            return t;
        });

        // Add new refresh token
        updatedRefreshTokens.push({
            token: newRefreshToken,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
            revoked: false,
            revokedAt: null
        });

        // Update admin with new refresh tokens
        const updateFilter = ObjectId.isValid(adminId)
            ? { _id: new ObjectId(adminId) }
            : { _id: adminId };

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--update',
            data: {
                filter: updateFilter,
                update: {
                    refreshTokens: updatedRefreshTokens,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        console.log('✅ [REFRESH TOKEN] Tokens refreshed successfully:', {
            adminId: adminId,
            email: admin.email
        });

        // Set new refresh token in httpOnly cookie (sameSite: 'none' in prod for cross-origin)
        const isProduction = process.env.NODE_ENV === 'production';
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/api/admin/auth'
        });

        // Return new access token (refresh token in cookie)
        res.json({
            success: true,
            data: {
                token: newAccessToken
                // refreshToken is in httpOnly cookie, not in response
            }
        });

    } catch (error) {
        console.error('❌ [REFRESH TOKEN] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during token refresh',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * POST /api/admin/auth/forgot-password
 * Request password reset
 * Public endpoint (no authentication required)
 * Request Body: { email: string }
 * Returns: { success: true, message: "Password reset email sent" }
 */
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const normalizedEmail = String(email || '').toLowerCase().trim();

        console.log('🔐 [FORGOT PASSWORD] Request received:', {
            email: normalizedEmail,
            timestamp: new Date().toISOString()
        });

        if (!normalizedEmail) {
            return res.status(400).json({
                success: false,
                message: 'Email is required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        // Email domain validation: Only @peakmode.se emails allowed
        if (!normalizedEmail.endsWith('@peakmode.se')) {
            // Return generic message to prevent email enumeration
            return res.json({
                success: true,
                message: 'If an account exists with this email, a password reset link has been sent.'
            });
        }

        // Find admin by email
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: { email: normalizedEmail }
        });

        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;

        // Return success even if admin not found (prevent email enumeration)
        if (!adminResult.success || !admin) {
            console.log('⚠️ [FORGOT PASSWORD] Admin not found (returning generic success)');
            return res.json({
                success: true,
                message: 'If an account exists with this email, a password reset link has been sent.'
            });
        }

        // Check if admin is active
        if (admin.status && admin.status !== 'active') {
            return res.json({
                success: true,
                message: 'If an account exists with this email, a password reset link has been sent.'
            });
        }

        // Generate secure reset token (32 bytes = 64 hex characters)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

        // Update admin with reset token
        const adminId = admin._id || admin.id;
        const updateFilter = ObjectId.isValid(adminId)
            ? { _id: new ObjectId(adminId) }
            : { email: normalizedEmail };

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--update',
            data: {
                filter: updateFilter,
                update: {
                    resetPasswordToken: resetToken,
                    resetPasswordExpires: resetExpires.toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });

        // Generate reset link (admin panel URL) – same base as accept-invite.
        // Token must be URL-encoded so &, =, + etc. don't break the link or get cut off in email clients.
        const resetLink = `${getAdminAppBaseUrl()}/reset-password?token=${encodeURIComponent(resetToken)}`.trim();
        const year = new Date().getFullYear();
        const adminName = (admin.name || admin.displayName || '').trim() || normalizedEmail;

        // Send "Set Password (Admin)" email via SendGrid
        try {
            await emailService.sendSetPasswordAdminEmail(normalizedEmail, {
                reset_link: resetLink,
                admin_email: normalizedEmail,
                admin_name: adminName,
                expiry_hours: 1,
                year
            });
        } catch (emailErr) {
            console.error('❌ [FORGOT PASSWORD] Email send error:', emailErr.message);
            // Still return generic success to avoid enumeration
        }

        // Log password reset request
        await logAdminActivity({
            adminId: adminId,
            adminEmail: normalizedEmail,
            action: 'password_reset_requested',
            details: { resetTokenGenerated: true },
            ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown',
            userAgent: req.get('user-agent') || 'unknown',
            success: true
        });

        console.log('✅ [FORGOT PASSWORD] Reset token generated and email sent:', {
            email: normalizedEmail,
            expiresAt: resetExpires.toISOString()
        });
        // Verification: open this URL in a browser to confirm reset page loads (reset_link is single full URL, token URL-encoded)
        console.log('[FORGOT PASSWORD] reset_link sent in email:', resetLink);

        res.json({
            success: true,
            message: 'If an account exists with this email, a password reset link has been sent.'
        });

    } catch (error) {
        console.error('❌ [FORGOT PASSWORD] Error:', error);
        // Return generic success even on error (prevent information leakage)
        res.json({
            success: true,
            message: 'If an account exists with this email, a password reset link has been sent.'
        });
    }
});

/**
 * POST /api/admin/auth/reset-password
 * Reset password using reset token
 * Public endpoint (no authentication required)
 * Request Body: { token: string, newPassword: string, confirmPassword: string }
 * Returns: { success: true, message: "Password reset successful" }
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword, confirmPassword } = req.body;

        console.log('🔐 [RESET PASSWORD] Request received:', {
            tokenLength: token ? token.length : 0,
            hasPassword: !!newPassword,
            timestamp: new Date().toISOString()
        });

        // Validate required fields
        if (!token || !token.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Reset token is required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        if (!newPassword || !newPassword.trim()) {
            return res.status(400).json({
                success: false,
                message: 'New password is required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        if (!confirmPassword || !confirmPassword.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Password confirmation is required',
                errorCode: 'VALIDATION_ERROR'
            });
        }

        // Validate password match
        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Passwords do not match',
                errorCode: 'PASSWORD_MISMATCH'
            });
        }

        // Enhanced password validation (min 12 characters with complexity)
        const passwordValidation = validatePassword(newPassword);
        if (!passwordValidation.valid) {
            return res.status(400).json({
                success: false,
                message: passwordValidation.error,
                errorCode: 'PASSWORD_VALIDATION_FAILED'
            });
        }

        // Find admin by reset token
        const adminResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--read',
            data: { resetPasswordToken: token.trim() }
        });

        const adminData = adminResult && adminResult.success ? adminResult.data : null;
        const admin = Array.isArray(adminData) ? adminData[0] : adminData;

        if (!adminResult.success || !admin) {
            console.log('❌ [RESET PASSWORD] Admin not found for token');
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token',
                errorCode: 'INVALID_RESET_TOKEN'
            });
        }

        // Check if token is expired
        if (!admin.resetPasswordExpires) {
            console.log('❌ [RESET PASSWORD] No expiry date found');
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token',
                errorCode: 'INVALID_RESET_TOKEN'
            });
        }

        const expiresAt = new Date(admin.resetPasswordExpires);
        const now = new Date();

        if (expiresAt <= now) {
            console.log('❌ [RESET PASSWORD] Token expired:', {
                expiresAt: expiresAt.toISOString(),
                now: now.toISOString()
            });
            return res.status(400).json({
                success: false,
                message: 'Reset token has expired. Please request a new password reset.',
                errorCode: 'RESET_TOKEN_EXPIRED'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update admin: set new password, clear reset token
        const adminId = admin._id || admin.id;
        const updateFilter = ObjectId.isValid(adminId)
            ? { _id: new ObjectId(adminId) }
            : { resetPasswordToken: token.trim() };

        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--update',
            data: {
                filter: updateFilter,
                update: {
                    password: hashedPassword,
                    resetPasswordToken: null,
                    resetPasswordExpires: null,
                    failedLoginAttempts: 0, // Reset failed attempts
                    lockedUntil: null, // Clear any lock
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            console.error('❌ [RESET PASSWORD] Failed to update admin:', updateResult);
            return res.status(500).json({
                success: false,
                message: 'Failed to reset password',
                errorCode: 'UPDATE_FAILED'
            });
        }

        // Send "Password Set Successfully (admin)" email via SendGrid
        const loginUrl = `${getAdminAppBaseUrl()}/login`;
        const adminName = (admin.name || admin.displayName || '').trim() || admin.email;
        const year = new Date().getFullYear();
        try {
            await emailService.sendPasswordSetSuccessfullyAdminEmail(admin.email, {
                admin_email: admin.email,
                admin_name: adminName,
                login_url: loginUrl,
                year
            });
        } catch (emailErr) {
            console.error('❌ [RESET PASSWORD] Success email send error:', emailErr.message);
        }

        // Log password reset
        await logAdminActivity({
            adminId: adminId,
            adminEmail: admin.email,
            action: 'password_reset',
            details: { resetViaToken: true },
            ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown',
            userAgent: req.get('user-agent') || 'unknown',
            success: true
        });

        console.log('✅ [RESET PASSWORD] Password reset successfully:', {
            email: admin.email
        });

        res.json({
            success: true,
            message: 'Password reset successful. You can now login with your new password.'
        });

    } catch (error) {
        console.error('❌ [RESET PASSWORD] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during password reset',
            errorCode: 'INTERNAL_SERVER_ERROR'
        });
    }
});

module.exports = router;

