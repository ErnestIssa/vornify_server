const express = require('express');
const getDBInstance = require('../vornifydb/dbInstance');
const authenticateAdmin = require('../middleware/authenticateAdmin');

const router = express.Router();
const db = getDBInstance();

/**
 * GET /api/admin/content
 * Public endpoint to read admin-configured content (hero, newsletter, about)
 * NO authentication required - for client frontend to display content
 * Returns: { hero: {...}, newsletter: {...}, about: {...} }
 */
router.get('/content', async (req, res) => {
    try {
        // Fetch content from database
        const contentResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admin_content',
            command: '--read',
            data: { filter: { type: 'site_content' } }
        });

        let content = null;
        if (contentResult.success && contentResult.data) {
            // Handle both single object and array responses
            content = Array.isArray(contentResult.data) 
                ? contentResult.data[0] 
                : contentResult.data;
        }

        // Default content structure if none exists
        const defaultContent = {
            hero: {
                title: 'Welcome to Peak Mode',
                subtitle: 'No Limits. Just Peaks.',
                image: '',
                ctaText: 'Shop Now',
                ctaLink: '/products'
            },
            newsletter: {
                title: 'Stay Updated',
                description: 'Subscribe to our newsletter for the latest updates and exclusive offers.',
                placeholder: 'Enter your email'
            },
            about: {
                title: 'About Peak Mode',
                description: 'Peak Mode is dedicated to helping you reach your peak performance.',
                image: ''
            }
        };

        // Merge default with stored content
        const responseContent = content 
            ? {
                hero: { ...defaultContent.hero, ...(content.hero || {}) },
                newsletter: { ...defaultContent.newsletter, ...(content.newsletter || {}) },
                about: { ...defaultContent.about, ...(content.about || {}) }
            }
            : defaultContent;

        res.json({
            success: true,
            ...responseContent
        });

    } catch (error) {
        console.error('❌ [ADMIN CONTENT] Error fetching content:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch content'
        });
    }
});

/**
 * PUT /api/admin/content
 * Protected endpoint to update admin-configured content
 * REQUIRES authentication (admin only)
 * Accepts: { section: "hero"|"newsletter"|"about", data: {...} }
 * OR: { hero: {...}, newsletter: {...}, about: {...} } (update all)
 */
router.put('/content', authenticateAdmin, async (req, res) => {
    try {
        const { section, data, hero, newsletter, about } = req.body;

        // Check if updating single section or all sections
        if (section && data) {
            // Update single section
            if (!['hero', 'newsletter', 'about'].includes(section)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid section. Must be: hero, newsletter, or about'
                });
            }

            // Get existing content
            const existingResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'admin_content',
                command: '--read',
                data: { filter: { type: 'site_content' } }
            });

            let existingContent = null;
            if (existingResult.success && existingResult.data) {
                existingContent = Array.isArray(existingResult.data) 
                    ? existingResult.data[0] 
                    : existingResult.data;
            }

            // Prepare update data
            const updateData = {
                type: 'site_content',
                [section]: data,
                updatedAt: new Date().toISOString(),
                updatedBy: req.admin.username
            };

            if (existingContent) {
                // Update existing content
                const updateResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'admin_content',
                    command: '--update',
                    data: {
                        filter: { type: 'site_content' },
                        update: {
                            $set: {
                                [section]: data,
                                updatedAt: updateData.updatedAt,
                                updatedBy: updateData.updatedBy
                            }
                        }
                    }
                });

                if (updateResult.success) {
                    res.json({
                        success: true,
                        message: `${section} content updated successfully`,
                        section,
                        data
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: 'Failed to update content'
                    });
                }
            } else {
                // Create new content document
                const newContent = {
                    type: 'site_content',
                    hero: section === 'hero' ? data : {},
                    newsletter: section === 'newsletter' ? data : {},
                    about: section === 'about' ? data : {},
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    updatedBy: req.admin.username
                };

                const createResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'admin_content',
                    command: '--create',
                    data: newContent
                });

                if (createResult.success) {
                    res.json({
                        success: true,
                        message: `${section} content created successfully`,
                        section,
                        data
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: 'Failed to create content'
                    });
                }
            }

        } else if (hero || newsletter || about) {
            // Update all sections at once
            const updateFields = {};
            if (hero) updateFields.hero = hero;
            if (newsletter) updateFields.newsletter = newsletter;
            if (about) updateFields.about = about;

            // Get existing content
            const existingResult = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'admin_content',
                command: '--read',
                data: { filter: { type: 'site_content' } }
            });

            let existingContent = null;
            if (existingResult.success && existingResult.data) {
                existingContent = Array.isArray(existingResult.data) 
                    ? existingResult.data[0] 
                    : existingResult.data;
            }

            if (existingContent) {
                // Update existing content
                const updateResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'admin_content',
                    command: '--update',
                    data: {
                        filter: { type: 'site_content' },
                        update: {
                            $set: {
                                ...updateFields,
                                updatedAt: new Date().toISOString(),
                                updatedBy: req.admin.username
                            }
                        }
                    }
                });

                if (updateResult.success) {
                    res.json({
                        success: true,
                        message: 'Content updated successfully',
                        ...updateFields
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: 'Failed to update content'
                    });
                }
            } else {
                // Create new content document
                const newContent = {
                    type: 'site_content',
                    hero: hero || {},
                    newsletter: newsletter || {},
                    about: about || {},
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    updatedBy: req.admin.username
                };

                const createResult = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'admin_content',
                    command: '--create',
                    data: newContent
                });

                if (createResult.success) {
                    res.json({
                        success: true,
                        message: 'Content created successfully',
                        hero: newContent.hero,
                        newsletter: newContent.newsletter,
                        about: newContent.about
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: 'Failed to create content'
                    });
                }
            }

        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid request. Provide either { section, data } or { hero, newsletter, about }'
            });
        }

    } catch (error) {
        console.error('❌ [ADMIN CONTENT] Error updating content:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update content'
        });
    }
});

module.exports = router;

