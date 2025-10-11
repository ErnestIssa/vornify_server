const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const VortexDB = require('../vornifydb/vornifydb');
const emailService = require('../services/emailService');

const db = new VortexDB();

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

        // Validate required fields
        if (!email || !password || !name) {
            return res.status(400).json({
                success: false,
                error: 'Email, password, and name are required'
            });
        }

        // Check if user already exists
        const existingUser = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email: email.toLowerCase() } }
        });

        if (existingUser.success && existingUser.data) {
            return res.status(400).json({
                success: false,
                error: 'Email already registered'
            });
        }

        // Generate verification token
        const verificationToken = generateToken();
        const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Create user
        const newUser = {
            email: email.toLowerCase(),
            password: hashPassword(password),
            name,
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

        if (!userResult.success || !userResult.data) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired verification token'
            });
        }

        const user = userResult.data;

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
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        // Find user
        const userResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email: email.toLowerCase() } }
        });

        if (!userResult.success || !userResult.data) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const user = userResult.data;

        // Verify password
        const hashedPassword = hashPassword(password);
        if (user.password !== hashedPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Check if email is verified
        if (!user.isVerified) {
            return res.status(403).json({
                success: false,
                error: 'Please verify your email before logging in',
                needsVerification: true
            });
        }

        // Generate auth token
        const authToken = generateAuthToken(user._id || user.email, user.email);

        res.json({
            success: true,
            message: 'Login successful',
            authToken,
            user: {
                email: user.email,
                name: user.name,
                phone: user.phone,
                isVerified: user.isVerified
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/auth/request-password-reset
 * Request password reset
 */
router.post('/request-password-reset', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        // Find user
        const userResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email: email.toLowerCase() } }
        });

        // Always return success even if user not found (security best practice)
        if (!userResult.success || !userResult.data) {
            return res.json({
                success: true,
                message: 'If an account exists with this email, a password reset link has been sent'
            });
        }

        const user = userResult.data;

        // Generate reset token
        const resetToken = generateToken();
        const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Update user with reset token
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--update',
            data: {
                filter: { email: email.toLowerCase() },
                update: {
                    resetToken,
                    resetExpiry: resetExpiry.toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });

        // Send password reset email
        try {
            const resetLink = `${process.env.FRONTEND_URL || req.headers.origin || 'https://peakmode.se'}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
            
            await emailService.sendPasswordResetEmail(
                email,
                resetLink
            );
            
            console.log(`✅ Password reset email sent to ${email}`);
        } catch (emailError) {
            console.error('⚠️ Failed to send password reset email:', emailError);
        }

        res.json({
            success: true,
            message: 'If an account exists with this email, a password reset link has been sent'
        });

    } catch (error) {
        console.error('Password reset request error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, email, newPassword } = req.body;

        if (!token || !email || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Token, email, and new password are required'
            });
        }

        // Validate password strength
        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 8 characters long'
            });
        }

        // Find user with reset token
        const userResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email: email.toLowerCase(), resetToken: token } }
        });

        if (!userResult.success || !userResult.data) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired reset token'
            });
        }

        const user = userResult.data;

        // Check if token is expired
        if (new Date() > new Date(user.resetExpiry)) {
            return res.status(400).json({
                success: false,
                error: 'Reset token has expired'
            });
        }

        // Update password
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--update',
            data: {
                filter: { email: email.toLowerCase() },
                update: {
                    password: hashPassword(newPassword),
                    resetToken: null,
                    resetExpiry: null,
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

        res.json({
            success: true,
            message: 'Password reset successfully'
        });

    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/auth/resend-verification
 * Resend verification email
 */
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        // Find user
        const userResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--read',
            data: { filter: { email: email.toLowerCase() } }
        });

        if (!userResult.success || !userResult.data) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const user = userResult.data;

        if (user.isVerified) {
            return res.status(400).json({
                success: false,
                error: 'Email is already verified'
            });
        }

        // Generate new verification token
        const verificationToken = generateToken();
        const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Update user with new token
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'users',
            command: '--update',
            data: {
                filter: { email: email.toLowerCase() },
                update: {
                    verificationToken,
                    verificationExpiry: verificationExpiry.toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }
        });

        // Send verification email
        const verificationLink = `${process.env.FRONTEND_URL || req.headers.origin || 'https://peakmode.se'}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
        
        await emailService.sendEmailVerificationEmail(
            email,
            user.name,
            verificationLink
        );

        res.json({
            success: true,
            message: 'Verification email sent'
        });

    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

module.exports = router;

