const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('../services/emailService');
const hubIdentity = require('../services/hub/hubIdentityService');
const { normalizeEmail, authFail, authOk, CODES } = require('../lib/authResponse');
const { buildPasswordResetLink } = require('../lib/authMailLinks');
const {
    isAccountLocked,
    buildFailedLoginUpdate,
    buildSuccessfulLoginUpdate,
} = require('../lib/authSecurity');
const { pickUserFromDbRead, hasUserFromDbRead } = require('../lib/userRead');

const db = getDBInstance();

// Helper function to hash passwords (simple hash - you should use bcrypt in production)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Helper function to generate random token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Helper function to generate JWT-like token (simplified - use jsonwebtoken in production)
function generateAuthToken(userId, email) {
    const payload = {
        userId,
        email,
        timestamp: Date.now()
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * POST /api/auth/register
 * Register new user
 */
router.post('/register', async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;
        const displayName =
            (name && String(name).trim()) ||
            String(email || '')
                .split('@')[0]
                .trim() ||
            'Member';

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        // Check if user already exists
        const existingUser = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email: email.toLowerCase() } }
        });

        if (existingUser.success && hasUserFromDbRead(existingUser.data)) {
            return authFail(
                res,
                409,
                CODES.ACCOUNT_EXISTS,
                'You already have a Peak Mode account. Sign in to continue.'
            );
        }

        // Generate verification token
        const verificationToken = generateToken();
        const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Create user
        const newUser = {
            email: email.toLowerCase(),
            password: hashPassword(password),
            name: displayName,
            phone: phone || '',
            isVerified: false,
            verificationToken,
            verificationExpiry: verificationExpiry.toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--create',
            data: newUser
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to create user account'
            });
        }

        await hubIdentity.ensureCustomer({ email, name: displayName });
        await hubIdentity.ensureMember({
            email,
            userId: null,
            customerId: hubIdentity.normalizeEmail(email),
            name: displayName,
        });

        // Send email verification email
        try {
            const verificationLink = `${process.env.FRONTEND_URL || req.headers.origin || 'https://peakmode.se'}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
            
            await emailService.sendEmailVerificationEmail(
                email,
                name,
                verificationLink
            );
            
            console.log(`✅ Verification email sent to ${email}`);
        } catch (emailError) {
            console.error('⚠️ Failed to send verification email:', emailError);
            // Don't fail registration if email fails
        }

        res.status(201).json({
            success: true,
            message: 'Account created successfully. Please check your email to verify your account.',
            user: {
                email: newUser.email,
                name: newUser.name,
                isVerified: false
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/auth/verify-email
 * Verify email with token
 */
router.post('/verify-email', async (req, res) => {
    try {
        const { token, email } = req.body;

        if (!token || !email) {
            return res.status(400).json({
                success: false,
                error: 'Token and email are required'
            });
        }

        // Find user with token
        const userResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email: email.toLowerCase(), verificationToken: token } }
        });

        const user = pickUserFromDbRead(userResult.data);
        if (!userResult.success || !user) {
            return authFail(
                res,
                400,
                CODES.VALIDATION_ERROR,
                'This verification link is no longer valid.'
            );
        }

        if (user.isVerified) {
            return authOk(res, { message: 'Your email is already verified.', alreadyVerified: true });
        }

        // Check if token is expired
        if (new Date() > new Date(user.verificationExpiry)) {
            return res.status(400).json({
                success: false,
                error: 'Verification token has expired'
            });
        }

        // Update user as verified
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--update',
            data: {
                filter: { email: email.toLowerCase() },
                update: {
                    isVerified: true,
                    verificationToken: null,
                    verificationExpiry: null,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to verify email'
            });
        }

        // Send account setup confirmation email
        try {
            const hubUrl = `${process.env.FRONTEND_URL || req.headers.origin || 'https://peakmode.se'}/hub/dashboard`;
            
            await emailService.sendAccountSetupEmail(
                user.email,
                user.name,
                hubUrl
            );
            
            console.log(`✅ Account setup email sent to ${user.email}`);
        } catch (emailError) {
            console.error('⚠️ Failed to send account setup email:', emailError);
            // Don't fail verification if email fails
        }

        res.json({
            success: true,
            message: 'Email verified successfully'
        });

    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/auth/login
 * Login user
 */
router.post('/login', async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = req.body.password;

        if (!email) {
            return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter your email address.');
        }
        if (!password) {
            return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter your password.');
        }

        const userResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email } }
        });

        const genericFail = () =>
            authFail(
                res,
                401,
                CODES.AUTHENTICATION_FAILED,
                "We couldn't sign you in with those details."
            );

        const user = pickUserFromDbRead(userResult.data);
        if (!userResult.success || !user) {
            return genericFail();
        }

        const lockState = isAccountLocked(user);
        if (lockState.reason === 'banned') {
            return authFail(
                res,
                403,
                CODES.ACCOUNT_BANNED,
                'This account is not currently eligible to access Peak Mode Hub.'
            );
        }
        if (lockState.reason === 'suspended') {
            return authFail(
                res,
                403,
                CODES.ACCOUNT_SUSPENDED,
                'Your Peak Mode account currently has limited access.'
            );
        }
        if (lockState.locked && lockState.reason === 'throttle') {
            return authFail(
                res,
                429,
                CODES.RATE_LIMITED,
                'Too many sign-in attempts. Please wait and try again, or reset your password.',
                { needsVerification: false }
            );
        }

        const hashedPassword = hashPassword(password);
        if (user.password !== hashedPassword) {
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'users',
                command: '--update',
                data: {
                    filter: { email },
                    update: buildFailedLoginUpdate(user)
                }
            });
            return genericFail();
        }

        if (!user.isVerified) {
            return authFail(
                res,
                403,
                CODES.EMAIL_VERIFICATION_REQUIRED,
                'Please verify your email before signing in.',
                { needsVerification: true }
            );
        }

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--update',
            data: {
                filter: { email },
                update: buildSuccessfulLoginUpdate(user)
            }
        });

        const authToken = generateAuthToken(user._id || user.email, user.email);
        const hubSession = await hubIdentity.provisionForAuthenticatedUser(user);

        return authOk(res, {
            message: 'Login successful',
            authToken,
            token: authToken,
            user: {
                email: user.email,
                name: user.name,
                phone: user.phone,
                isVerified: user.isVerified
            },
            member: hubSession.member,
            profile: hubSession.profile,
            onboardingComplete: hubSession.onboardingComplete,
        });
    } catch (error) {
        console.error('Login error:', error);
        return authFail(
            res,
            500,
            CODES.INTERNAL_ERROR,
            'Something went wrong while signing you in. Please try again.'
        );
    }
});

/**
 * POST /api/auth/request-password-reset
 * Request password reset
 */
const GENERIC_RESET_SENT =
    "If an account exists for this email, we'll send you a password reset link.";

router.post('/request-password-reset', async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);

        if (!email) {
            return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter a valid email address.');
        }

        const userResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email } }
        });

        const user = pickUserFromDbRead(userResult.data);
        if (!userResult.success || !user) {
            return authOk(res, { message: GENERIC_RESET_SENT });
        }

        const lastSent = user.lastPasswordResetSentAt ? new Date(user.lastPasswordResetSentAt) : null;
        if (lastSent && Date.now() - lastSent.getTime() < 2 * 60 * 1000) {
            return authOk(res, { message: GENERIC_RESET_SENT });
        }

        const resetToken = generateToken();
        const resetExpiry = new Date(Date.now() + 60 * 60 * 1000);

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--update',
            data: {
                filter: { email },
                update: {
                    resetToken,
                    resetExpiry: resetExpiry.toISOString(),
                    lastPasswordResetSentAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });

        try {
            const resetLink = buildPasswordResetLink({
                token: resetToken,
                email,
                fallbackOrigin: req.headers.origin,
            });
            await emailService.sendPasswordResetEmail(email, resetLink);
            console.log(`✅ Password reset email sent to ${email}`);
        } catch (emailError) {
            console.error('⚠️ Failed to send password reset email:', emailError);
        }

        return authOk(res, { message: GENERIC_RESET_SENT });
    } catch (error) {
        console.error('Password reset request error:', error);
        return authFail(
            res,
            500,
            CODES.INTERNAL_ERROR,
            'Something went wrong. Please try again.'
        );
    }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, email, newPassword } = req.body;

        const normalizedEmail = normalizeEmail(email);
        if (!token || !normalizedEmail || !newPassword) {
            return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter a valid reset link and password.');
        }

        if (newPassword.length < 8) {
            return authFail(
                res,
                400,
                CODES.VALIDATION_ERROR,
                'Password must be at least 8 characters long.'
            );
        }

        const userResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email: normalizedEmail, resetToken: token } }
        });

        const user = pickUserFromDbRead(userResult.data);
        if (!userResult.success || !user) {
            return authFail(
                res,
                400,
                CODES.VALIDATION_ERROR,
                'This password reset link is no longer valid.'
            );
        }

        if (new Date() > new Date(user.resetExpiry)) {
            return authFail(
                res,
                400,
                CODES.VALIDATION_ERROR,
                'This password reset link has expired.'
            );
        }

        const sec = user.security || {};
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--update',
            data: {
                filter: { email: normalizedEmail },
                update: {
                    password: hashPassword(newPassword),
                    resetToken: null,
                    resetExpiry: null,
                    security: {
                        ...sec,
                        failedLoginCount: 0,
                        lockedUntil: null,
                        lockReason: null,
                        passwordChangedAt: new Date().toISOString(),
                    },
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (!updateResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to reset password'
            });
        }

        // Send password reset success email
        try {
            await emailService.sendPasswordResetSuccessEmail(
                user.email,
                user.name
            );
            
            console.log(`✅ Password reset success email sent to ${user.email}`);
        } catch (emailError) {
            console.error('⚠️ Failed to send password reset success email:', emailError);
            // Don't fail password reset if email fails
        }

        return authOk(res, { message: 'Your password has been updated.' });
    } catch (error) {
        console.error('Password reset error:', error);
        return authFail(
            res,
            500,
            CODES.INTERNAL_ERROR,
            'Something went wrong. Please try again.'
        );
    }
});

/**
 * POST /api/auth/resend-verification
 * Resend verification email
 */
router.post('/resend-verification', async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const genericSent = 'If this account needs verification, we sent a new link to that inbox.';

        if (!email) {
            return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter a valid email address.');
        }

        const userResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email } }
        });

        const user = pickUserFromDbRead(userResult.data);
        if (!userResult.success || !user) {
            return authOk(res, { message: genericSent });
        }

        if (user.isVerified) {
            return authOk(res, { message: 'Your email is already verified.', alreadyVerified: true });
        }

        const lastSent = user.lastVerificationSentAt ? new Date(user.lastVerificationSentAt) : null;
        if (lastSent && Date.now() - lastSent.getTime() < 2 * 60 * 1000) {
            return authFail(
                res,
                429,
                CODES.RATE_LIMITED,
                'Please wait a moment before requesting another verification email.'
            );
        }

        const verificationToken = generateToken();
        const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--update',
            data: {
                filter: { email },
                update: {
                    verificationToken,
                    verificationExpiry: verificationExpiry.toISOString(),
                    lastVerificationSentAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });

        const verificationLink = `${process.env.FRONTEND_URL || req.headers.origin || 'https://peakmode.se'}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
        await emailService.sendEmailVerificationEmail(email, user.name, verificationLink);

        return authOk(res, { message: genericSent });
    } catch (error) {
        console.error('Resend verification error:', error);
        return authFail(
            res,
            500,
            CODES.INTERNAL_ERROR,
            'Something went wrong. Please try again.'
        );
    }
});

module.exports = router;

