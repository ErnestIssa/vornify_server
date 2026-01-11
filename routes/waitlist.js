const express = require('express');
const emailService = require('../services/emailService');
const getDBInstance = require('../vornifydb/dbInstance');

const router = express.Router();
const db = getDBInstance();

// Configuration: Generate early access codes for first X signups
const EARLY_ACCESS_CODE_LIMIT = parseInt(process.env.EARLY_ACCESS_CODE_LIMIT) || 1000;
const EARLY_ACCESS_CODE_PREFIX = process.env.EARLY_ACCESS_CODE_PREFIX || 'EARLY';

/**
 * Generate unique early access code
 * Format: EARLY2025-001, EARLY2025-002, etc.
 */
function generateEarlyAccessCode(sequenceNumber) {
    const year = new Date().getFullYear();
    const paddedNumber = sequenceNumber.toString().padStart(3, '0');
    return `${EARLY_ACCESS_CODE_PREFIX}${year}-${paddedNumber}`;
}

/**
 * Validate email format
 */
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * POST /api/waitlist
 * Add user to waitlist
 */
router.post('/', async (req, res) => {
    try {
        console.log('📋 [WAITLIST] Add to waitlist endpoint called');
        console.log('📋 [WAITLIST] Request body:', JSON.stringify(req.body, null, 2));
        
        const { email, name, categories } = req.body;

        // Validate email
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        // Validate email format
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        // Normalize email
        const normalizedEmail = email.trim().toLowerCase();
        const joinedAt = new Date().toISOString();

        // Check if email already exists in waitlist
        console.log('🔍 [WAITLIST] Checking if email exists:', normalizedEmail);
        const existingResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'waitlist',
            command: '--read',
            data: { email: normalizedEmail }
        });

        // Check if we have actual data (not just an empty array)
        const hasActualData = existingResult.success && 
            existingResult.data && 
            (Array.isArray(existingResult.data) ? existingResult.data.length > 0 : true);

        if (hasActualData) {
            console.log('⚠️ [WAITLIST] Email already exists in waitlist:', normalizedEmail);
            return res.status(409).json({
                success: false,
                error: 'Email already exists in waitlist'
            });
        }

        // Get total waitlist count to determine if we should generate early access code
        const countResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'waitlist',
            command: '--read',
            data: {}
        });

        let currentCount = 0;
        if (countResult.success && countResult.data) {
            currentCount = Array.isArray(countResult.data) ? countResult.data.length : (countResult.data ? 1 : 0);
        }

        const sequenceNumber = currentCount + 1;
        let earlyAccessCode = null;

        // Generate early access code if within limit
        if (sequenceNumber <= EARLY_ACCESS_CODE_LIMIT) {
            earlyAccessCode = generateEarlyAccessCode(sequenceNumber);
            console.log(`✅ [WAITLIST] Generating early access code for signup #${sequenceNumber}: ${earlyAccessCode}`);
        } else {
            console.log(`📊 [WAITLIST] Signup #${sequenceNumber} is beyond early access limit (${EARLY_ACCESS_CODE_LIMIT}), no code generated`);
        }

        // Prepare waitlist entry
        const waitlistEntry = {
            email: normalizedEmail,
            name: name ? name.trim() : undefined,
            categories: Array.isArray(categories) && categories.length > 0 ? categories : undefined,
            joinedAt: joinedAt,
            earlyAccessCode: earlyAccessCode,
            status: 'pending'
        };

        // Create waitlist entry
        console.log('💾 [WAITLIST] Creating waitlist entry:', normalizedEmail);
        const createResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'waitlist',
            command: '--create',
            data: waitlistEntry
        });

        if (!createResult.success) {
            console.error('❌ [WAITLIST] Failed to create waitlist entry:', createResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to add to waitlist',
                details: createResult.error
            });
        }

        console.log('✅ [WAITLIST] Successfully added to waitlist:', normalizedEmail);

        // Send confirmation email
        try {
            const emailResult = await emailService.sendWaitlistConfirmationEmail(
                normalizedEmail,
                name || 'Valued Customer',
                earlyAccessCode
            );

            if (emailResult.success) {
                console.log('✅ [WAITLIST] Confirmation email sent successfully:', normalizedEmail);
                
                // Update status to 'emailed' if email sent successfully
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'waitlist',
                    command: '--update',
                    data: {
                        filter: { email: normalizedEmail },
                        update: { status: 'emailed' }
                    }
                });
                
                waitlistEntry.status = 'emailed';
            } else {
                console.error('⚠️ [WAITLIST] Failed to send confirmation email:', emailResult.error);
                // Don't fail the request if email fails
            }
        } catch (emailError) {
            console.error('❌ [WAITLIST] Email error:', emailError);
            // Don't fail the request if email fails
        }

        // Return success response
        res.status(200).json({
            success: true,
            message: 'Successfully added to waitlist',
            data: waitlistEntry
        });

    } catch (error) {
        console.error('❌ [WAITLIST] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add to waitlist',
            details: error.message
        });
    }
});

/**
 * GET /api/waitlist/stats
 * Get waitlist statistics
 */
router.get('/stats', async (req, res) => {
    try {
        console.log('📊 [WAITLIST] Stats endpoint called');

        // Get all waitlist entries
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'waitlist',
            command: '--read',
            data: {}
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve waitlist stats'
            });
        }

        const entries = Array.isArray(result.data) ? result.data : (result.data ? [result.data] : []);
        
        // Calculate statistics
        const totalSignups = entries.length;
        
        // Calculate recent signups (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentSignups = entries.filter(entry => {
            if (!entry.joinedAt) return false;
            const joinedDate = new Date(entry.joinedAt);
            return joinedDate >= sevenDaysAgo;
        }).length;

        // Calculate by category
        const byCategory = {};
        entries.forEach(entry => {
            if (entry.categories && Array.isArray(entry.categories)) {
                entry.categories.forEach(category => {
                    byCategory[category] = (byCategory[category] || 0) + 1;
                });
            }
        });

        const stats = {
            totalSignups,
            recentSignups,
            byCategory
        };

        console.log('✅ [WAITLIST] Stats retrieved:', stats);

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('❌ [WAITLIST] Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve waitlist stats',
            details: error.message
        });
    }
});

/**
 * POST /api/waitlist/:email/notify
 * Admin endpoint: Send private early access notification to a waitlist member
 */
router.post('/:email/notify', async (req, res) => {
    try {
        const { email } = req.params;
        console.log('📧 [WAITLIST NOTIFY] Admin notification endpoint called for:', email);

        // Normalize email
        const normalizedEmail = email.trim().toLowerCase();

        // Find waitlist entry
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'waitlist',
            command: '--read',
            data: { email: normalizedEmail }
        });

        // Check if we have actual data
        const hasActualData = result.success && 
            result.data && 
            (Array.isArray(result.data) ? result.data.length > 0 : true);

        if (!hasActualData) {
            return res.status(404).json({
                success: false,
                error: 'Email not found in waitlist'
            });
        }

        // Extract waitlist entry
        const dataArray = Array.isArray(result.data) ? result.data : [result.data];
        const waitlistEntry = dataArray[0];

        // Send private early access notification email
        const emailResult = await emailService.sendPrivateEarlyAccessNotificationEmail(
            normalizedEmail,
            waitlistEntry.name || 'Valued Customer',
            waitlistEntry.earlyAccessCode || null
        );

        if (!emailResult.success) {
            console.error('❌ [WAITLIST NOTIFY] Failed to send notification email:', emailResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to send notification email',
                details: emailResult.error
            });
        }

        // Update status to indicate notification was sent
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'waitlist',
            command: '--update',
            data: {
                filter: { email: normalizedEmail },
                update: { 
                    status: 'notified',
                    notifiedAt: new Date().toISOString()
                }
            }
        });

        console.log('✅ [WAITLIST NOTIFY] Private notification sent successfully:', normalizedEmail);

        res.json({
            success: true,
            message: 'Private early access notification sent successfully',
            data: {
                email: normalizedEmail,
                name: waitlistEntry.name,
                earlyAccessCode: waitlistEntry.earlyAccessCode,
                status: 'notified'
            }
        });

    } catch (error) {
        console.error('❌ [WAITLIST NOTIFY] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send notification',
            details: error.message
        });
    }
});

module.exports = router;

