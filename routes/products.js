const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

// GET /api/products/:id - Get product by ID with complete inventory data
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id }
        });
        
        if (result.success && result.data) {
            // Process inventory data to ensure proper structure
            const product = result.data;
            
            // Ensure inventory structure is complete
            if (product.inventory) {
                // Process colors
                if (product.inventory.colors && Array.isArray(product.inventory.colors)) {
                    product.inventory.colors = product.inventory.colors.map((color, index) => ({
                        id: color.id || `color_${Date.now()}_${index}`,
                        name: color.name || 'Unnamed Color',
                        hex: color.hex || '#000000',
                        available: color.available !== undefined ? color.available : true,
                        sortOrder: color.sortOrder !== undefined ? color.sortOrder : index
                    }));
                }
                
                // Process sizes
                if (product.inventory.sizes && Array.isArray(product.inventory.sizes)) {
                    product.inventory.sizes = product.inventory.sizes.map((size, index) => ({
                        id: size.id || `size_${Date.now()}_${index}`,
                        name: size.name || 'Unnamed Size',
                        description: size.description || '',
                        available: size.available !== undefined ? size.available : true,
                        sortOrder: size.sortOrder !== undefined ? size.sortOrder : index
                    }));
                }
                
                // Process variants
                if (product.inventory.variants && Array.isArray(product.inventory.variants)) {
                    product.inventory.variants = product.inventory.variants.map((variant, index) => ({
                        id: variant.id || `variant_${Date.now()}_${index}`,
                        colorId: variant.colorId,
                        sizeId: variant.sizeId,
                        sku: variant.sku || '',
                        price: variant.price || product.price,
                        stock: variant.stock || 0,
                        available: variant.available !== undefined ? variant.available : true,
                        images: variant.images || [],
                        sortOrder: variant.sortOrder !== undefined ? variant.sortOrder : index
                    }));
                }
            }
            
            res.json({
                success: true,
                data: product
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
    } catch (error) {
        console.error('Get product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve product'
        });
    }
});

// GET /api/products - Get all products
router.get('/', async (req, res) => {
    try {
        const { category, featured, limit } = req.query;
        
        let query = {};
        
        // Add category filter if provided
        if (category) {
            query.category = category;
        }
        
        // Add featured filter if provided
        if (featured === 'true') {
            query.featured = true;
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: query
        });
        
        if (result.success) {
            let products = result.data || [];
            
            // Apply limit if provided
            if (limit && parseInt(limit) > 0) {
                products = products.slice(0, parseInt(limit));
            }
            
            // Process inventory data for each product
            products = products.map(product => {
                if (product.inventory) {
                    // Process colors
                    if (product.inventory.colors && Array.isArray(product.inventory.colors)) {
                        product.inventory.colors = product.inventory.colors.map((color, index) => ({
                            id: color.id || `color_${Date.now()}_${index}`,
                            name: color.name || 'Unnamed Color',
                            hex: color.hex || '#000000',
                            available: color.available !== undefined ? color.available : true,
                            sortOrder: color.sortOrder !== undefined ? color.sortOrder : index
                        }));
                    }
                    
                    // Process sizes
                    if (product.inventory.sizes && Array.isArray(product.inventory.sizes)) {
                        product.inventory.sizes = product.inventory.sizes.map((size, index) => ({
                            id: size.id || `size_${Date.now()}_${index}`,
                            name: size.name || 'Unnamed Size',
                            description: size.description || '',
                            available: size.available !== undefined ? size.available : true,
                            sortOrder: size.sortOrder !== undefined ? size.sortOrder : index
                        }));
                    }
                    
                    // Process variants
                    if (product.inventory.variants && Array.isArray(product.inventory.variants)) {
                        product.inventory.variants = product.inventory.variants.map((variant, index) => ({
                            id: variant.id || `variant_${Date.now()}_${index}`,
                            colorId: variant.colorId,
                            sizeId: variant.sizeId,
                            sku: variant.sku || '',
                            price: variant.price || product.price,
                            stock: variant.stock || 0,
                            available: variant.available !== undefined ? variant.available : true,
                            images: variant.images || [],
                            sortOrder: variant.sortOrder !== undefined ? variant.sortOrder : index
                        }));
                    }
                }
                return product;
            });
            
            res.json({
                success: true,
                data: products,
                count: products.length
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve products'
            });
        }
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve products'
        });
    }
});

// POST /api/products - Create new product (admin)
router.post('/', async (req, res) => {
    try {
        const productData = req.body;
        
        // Validate required fields
        const requiredFields = ['name', 'price', 'description'];
        const missingFields = requiredFields.filter(field => !productData[field]);
        
        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`
            });
        }
        
        // Generate product ID if not provided
        if (!productData.id) {
            productData.id = 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
        
        // Set default values
        productData.createdAt = new Date().toISOString();
        productData.updatedAt = new Date().toISOString();
        productData.active = productData.active !== undefined ? productData.active : true;
        productData.featured = productData.featured !== undefined ? productData.featured : false;
        
        // Process inventory data if provided
        if (productData.inventory) {
            productData.inventory = db.processInventoryData(productData);
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--create',
            data: productData
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Product created successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create product'
        });
    }
});

// PUT /api/products/:id - Update product (admin)
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        
        // Add updated timestamp
        updateData.updatedAt = new Date().toISOString();
        
        // Process inventory data if provided
        if (updateData.inventory) {
            updateData.inventory = db.processInventoryData(updateData);
        }
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--update',
            data: {
                filter: { id },
                update: updateData
            }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Product updated successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update product'
        });
    }
});

// DELETE /api/products/:id - Delete product (admin)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--delete',
            data: { id }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Product deleted successfully'
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete product'
        });
    }
});

// GET /api/products/:id/variants - Get product variants
router.get('/:id/variants', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id }
        });
        
        if (result.success && result.data) {
            const product = result.data;
            const variants = product.inventory?.variants || [];
            
            res.json({
                success: true,
                data: variants
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
    } catch (error) {
        console.error('Get product variants error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve product variants'
        });
    }
});

module.exports = router;
