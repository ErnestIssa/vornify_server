const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const getDBInstance = require('../vornifydb/dbInstance');
const hubAccountEmail = require('../services/hub/hubAccountEmailService');
const hubAuthLoginEvents = require('../services/hub/hubAuthLoginEvents');
const hubVerificationEmail = require('../services/hub/hubVerificationEmail');
const hubIdentity = require('../services/hub/hubIdentityService');
const { normalizeEmail, authFail, authOk, CODES } = require('../lib/authResponse');
const { buildPasswordResetLink } = require('../lib/authMailLinks');
const { isAccountLocked, buildFailedLoginUpdate } = require('../lib/authSecurity');
const { authEmailRateLimit } = require('../middleware/authEmailRateLimit');
const { hubMailOptions } = require('../lib/hubMailContext');
const { normalizeLang } = require('../lib/resolveHubEmailLanguage');

const db = getDBInstance();

// Helper function to hash passwords (simple hash - you should use bcrypt in production)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Helper function to generate random token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashKey(part) {
    return crypto.createHash('sha256').update(String(part)).digest('hex').slice(0, 16);
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
        const { email, password, name, phone, language: registerLanguage } = req.body;
        const preferredLanguage = normalizeLang(registerLanguage) || 'en';
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

        const normalizedRegisterEmail = normalizeEmail(email);
        if (await hubIdentity.findUserByEmail(normalizedRegisterEmail)) {
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
            passwordUserSet: true,
            name: displayName,
            phone: phone || '',
            isVerified: false,
            verificationToken,
            verificationExpiry: verificationExpiry.toISOString(),
            language: preferredLanguage,
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

        const mailOpts = hubMailOptions(req, { ...newUser, email: normalizedRegisterEmail });
        const [welcomeResult, verifyDelivery] = await Promise.all([
            hubAccountEmail.sendAccountWelcomeEmail(normalizedRegisterEmail, displayName, mailOpts),
            hubVerificationEmail.sendVerificationEmail({
                email: normalizedRegisterEmail,
                user: { ...newUser, verificationToken, verificationExpiry: verificationExpiry.toISOString() },
                fallbackOrigin: req.headers.origin,
                forceNewToken: false,
                language: preferredLanguage,
                acceptLanguage: req.headers['accept-language'],
            }),
        ]);

        if (!verifyDelivery.sent) {
            console.error('[register] Verification email not sent:', verifyDelivery.reason, verifyDelivery.error);
        }
        if (!welcomeResult.success) {
            console.error('[register] Welcome email not sent:', welcomeResult.error);
        }

        res.status(201).json({
            success: true,
            message: 'Account created successfully. Please check your email to verify your account.',
            verificationEmailSent: Boolean(verifyDelivery.sent && verifyDelivery.providerAccepted !== false),
            verificationEmailStatus: verifyDelivery.status || null,
            welcomeEmailSent: Boolean(welcomeResult.success || welcomeResult.providerAccepted),
            welcomeEmailStatus: welcomeResult.status || null,
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
        const user = await hubIdentity.findUserByEmailAndFields(email, {
            verificationToken: token,
        });

        if (!user) {
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

        const { getStorefrontOrigin } = require('../lib/authMailLinks');
        const hubUrl = `${getStorefrontOrigin(req.headers.origin)}/peak-mode-hub`;
        await hubAccountEmail.sendHubWelcomePostVerifyEmail(user.email, user.name, hubUrl, hubMailOptions(req, user));

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

        const genericFail = () =>
            authFail(
                res,
                401,
                CODES.AUTHENTICATION_FAILED,
                "We couldn't sign you in with those details."
            );

        const user = await hubIdentity.findUserByEmail(email);
        if (!user) {
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
            await hubAuthLoginEvents.afterLoginBlocked(user, req);
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
            const failed = buildFailedLoginUpdate(user);
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'users',
                command: '--update',
                data: {
                    filter: { email },
                    update: failed.update
                }
            });
            if (failed.justLocked) {
                await hubAuthLoginEvents.afterLoginBlocked({ ...user, security: failed.update.security }, req);
            }
            return genericFail();
        }

        if (!user.isVerified) {
            const delivery = await hubVerificationEmail.sendVerificationEmail({
                email,
                user,
                fallbackOrigin: req.headers.origin,
            });
            return authFail(
                res,
                403,
                CODES.EMAIL_VERIFICATION_REQUIRED,
                'Please verify your email before signing in.',
                {
                    needsVerification: true,
                    verificationEmailSent: Boolean(delivery.sent),
                }
            );
        }

        await hubAuthLoginEvents.afterSuccessfulHubLogin(user, req);

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

router.post('/request-password-reset', authEmailRateLimit, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);

        if (!email) {
            return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter a valid email address.');
        }

        const user = await hubIdentity.findUserByEmail(email);
        if (!user) {
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

        const resetLink = buildPasswordResetLink({
            token: resetToken,
            email,
            fallbackOrigin: req.headers.origin,
        });
        await hubAccountEmail.sendPasswordResetEmail(email, resetLink, hubMailOptions(req, user));

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

        const user = await hubIdentity.findUserByEmailAndFields(normalizedEmail, {
            resetToken: token,
        });

        if (!user) {
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
                    passwordUserSet: true,
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

        const resetEventId = user.resetToken ? hashKey(user.resetToken) : hashKey(normalizedEmail);
        await hubAccountEmail.sendPasswordResetSuccessEmail(user.email, user.name, {
            ...hubMailOptions(req, user),
            correlationId: resetEventId,
        });

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
router.post('/resend-verification', authEmailRateLimit, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const genericSent = 'If this account needs verification, we sent a new link to that inbox.';

        if (!email) {
            return authFail(res, 400, CODES.VALIDATION_ERROR, 'Enter a valid email address.');
        }

        const user = await hubIdentity.findUserByEmail(email);
        if (!user) {
            return authOk(res, { message: genericSent });
        }

        if (user.isVerified) {
            return authOk(res, { message: 'Your email is already verified.', alreadyVerified: true });
        }

        const delivery = await hubVerificationEmail.sendVerificationEmail({
            email,
            user,
            fallbackOrigin: req.headers.origin,
            forceNewToken: true,
        });

        if (delivery.reason === 'rate_limited') {
            return authFail(
                res,
                429,
                CODES.RATE_LIMITED,
                'Please wait a moment before requesting another verification email.'
            );
        }

        if (!delivery.sent && delivery.reason !== 'no_account') {
            console.error('[resend-verification] Send failed:', delivery.reason, delivery.error);
            return authFail(
                res,
                503,
                CODES.SERVICE_UNAVAILABLE,
                'We could not send the verification email right now. Try again in a moment.'
            );
        }

        return authOk(res, {
            message: genericSent,
            verificationEmailSent: Boolean(delivery.sent),
        });
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

