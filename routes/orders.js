const express = require('express');
const router = express.Router();
const VortexDB = require('../vornifydb/vornifydb');
const emailService = require('../services/emailService');

const db = new VortexDB();

// Helper function to generate unique Order ID
async function generateUniqueOrderId() {
    let orderId;
    let exists = true;
    
    while (exists) {
        const randomNum = Math.floor(100000 + Math.random() * 900000);
        orderId = 'PM' + randomNum;
        
        // Check if this ID already exists
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        // VornifyDB returns single object when query is provided, or error if not found
        exists = result.success && result.data;
    }
    
    return orderId;
}

// Helper function to generate timeline descriptions
function generateTimelineDescription(status, provider, trackingNum) {
    switch(status) {
        case 'processing':
            return 'Order is being prepared';
        case 'confirmed':
            return 'Payment confirmed, ready to ship';
        case 'shipped':
            return `Order shipped with ${provider || 'carrier'}${trackingNum ? ' - Tracking: ' + trackingNum : ''}`;
        case 'delivered':
            return 'Order has been delivered';
        case 'cancelled':
            return 'Order has been cancelled';
        default:
            return `Order status updated to ${status}`;
    }
}

// Create order with unique Order ID
router.post('/create', async (req, res) => {
    try {
        const orderData = req.body;
        
        // Generate unique Order ID
        const orderId = await generateUniqueOrderId();
        
        // Prepare order with enhanced customer data structure
        const order = {
            ...orderData,
            orderId,
            status: orderData.status || 'processing',
            paymentStatus: orderData.paymentStatus || 'pending',
            
            // Enhanced customer information structure
            customer: orderData.customer ? {
                email: orderData.customer.email,
                firstName: orderData.customer.firstName || orderData.customer.name?.split(' ')[0] || '',
                lastName: orderData.customer.lastName || orderData.customer.name?.split(' ').slice(1).join(' ') || '',
                address: orderData.customer.address || orderData.shippingAddress?.street || '',
                city: orderData.customer.city || orderData.shippingAddress?.city || '',
                postalCode: orderData.customer.postalCode || orderData.shippingAddress?.postalCode || '',
                country: orderData.customer.country || orderData.shippingAddress?.country || '',
                phone: orderData.customer.phone || orderData.shippingAddress?.phone || ''
            } : {
                email: orderData.customerEmail || '',
                firstName: orderData.customerName?.split(' ')[0] || '',
                lastName: orderData.customerName?.split(' ').slice(1).join(' ') || '',
                address: orderData.shippingAddress?.street || '',
                city: orderData.shippingAddress?.city || '',
                postalCode: orderData.shippingAddress?.postalCode || '',
                country: orderData.shippingAddress?.country || '',
                phone: orderData.shippingAddress?.phone || ''
            },
            
            // Legacy fields for backward compatibility
            customerName: orderData.customerName || orderData.customer?.name || '',
            customerEmail: orderData.customerEmail || orderData.customer?.email || '',
            
            // Ensure cart items include variant information
            items: orderData.items ? orderData.items.map(item => ({
                ...item,
                // Preserve variant information from cart
                sizeId: item.sizeId || null,
                colorId: item.colorId || null,
                variantId: item.variantId || null,
                size: item.size || null,
                color: item.color || null
            })) : [],
            
            // Financial information
            total: orderData.totals?.total || orderData.total || 0,
            shipping: orderData.totals?.shipping || orderData.shippingCost || 0,
            tax: orderData.totals?.tax || orderData.tax || 0,
            subtotal: orderData.totals?.subtotal || orderData.subtotal || 0,
            
            // Order status and details
            paymentMethod: orderData.paymentMethod || 'card',
            shippingMethod: orderData.shippingMethod?.name || orderData.shippingMethod || '',
            
            // Enhanced tracking information
            trackingNumber: orderData.trackingNumber || null,
            trackingUrl: orderData.trackingUrl || null,
            shippingProvider: orderData.shippingProvider || orderData.shippingMethod?.carrier || null,
            estimatedDelivery: orderData.estimatedDelivery || null,
            estimatedDeliveryDate: orderData.estimatedDeliveryDate || orderData.estimatedDelivery || null,
            
            // Include shipping method information
            shippingMethodDetails: orderData.shippingMethod ? {
                id: orderData.shippingMethod.id,
                name: orderData.shippingMethod.name,
                carrier: orderData.shippingMethod.carrier,
                cost: orderData.shippingMethod.cost,
                estimatedDays: orderData.shippingMethod.estimatedDays,
                description: orderData.shippingMethod.description,
                trackingEnabled: orderData.shippingMethod.trackingEnabled,
                carrierCode: orderData.shippingMethod.carrierCode
            } : null,
            shippingCost: orderData.shippingCost || 0,
            
            // Order management
            notes: orderData.notes || '',
            
            // Timestamps
            date: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            orderDate: new Date().toISOString(),
            
            // Timeline
            timeline: [
                {
                    status: 'Order Placed',
                    date: new Date().toISOString(),
                    description: 'Order received and payment confirmed',
                    timestamp: new Date().toISOString()
                }
            ]
        };
        
        // Create the order in database
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--create',
            data: order
        });
        
        if (result.success) {
            // Send order confirmation email
            try {
                await emailService.sendOrderConfirmationEmail(
                    order.customer.email,
                    order.customer.name,
                    order
                );
                console.log(`Order confirmation email sent to ${order.customer.email}`);
            } catch (emailError) {
                console.error('Failed to send order confirmation email:', emailError);
                // Don't fail the order creation if email fails
            }

            res.json({
                success: true,
                orderId,
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Order creation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create order'
        });
    }
});

// Update order status
router.post('/update-status', async (req, res) => {
    try {
        const { orderId, status, shippingProvider, trackingNumber, trackingUrl, estimatedDelivery } = req.body;
        
        if (!orderId || !status) {
            return res.status(400).json({
                success: false,
                error: 'orderId and status are required'
            });
        }
        
        // Find the order first
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!findResult.success || !findResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        const order = findResult.data;
        
        // Prepare timeline entry
        const timelineEntry = {
            status: status.charAt(0).toUpperCase() + status.slice(1),
            date: new Date().toISOString(),
            description: generateTimelineDescription(status, shippingProvider, trackingNumber)
        };
        
        // Prepare update data
        const updateData = {
            status,
            updatedAt: new Date().toISOString(),
            timeline: [...(order.timeline || []), timelineEntry]
        };
        
        // Add shipping fields if provided
        if (shippingProvider) updateData.shippingProvider = shippingProvider;
        if (trackingNumber) updateData.trackingNumber = trackingNumber;
        if (trackingUrl) updateData.trackingUrl = trackingUrl;
        if (estimatedDelivery) updateData.estimatedDelivery = estimatedDelivery;
        
        // Update the order
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: updateData
            }
        });
        
        if (updateResult.success) {
            // Create tracking entry if order is being shipped
            if (status === 'shipped' && !order.trackingNumber && order.shippingMethod) {
                try {
                    const trackingRoutes = require('./tracking');
                    const trackingResult = await db.executeOperation({
                        database_name: 'peakmode',
                        collection_name: 'tracking_events',
                        command: '--create',
                        data: {
                            orderId: order.orderId,
                            trackingNumber: `PM${Math.floor(100000 + Math.random() * 900000)}`,
                            carrier: order.shippingMethod.carrierCode || 'POSTNORD',
                            shippingMethodId: order.shippingMethod.id,
                            shippingCost: order.shippingCost || 0,
                            status: 'Shipped',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            events: [
                                {
                                    status: 'Shipped',
                                    location: 'Peak Mode Warehouse, Stockholm',
                                    description: 'Package has been shipped',
                                    timestamp: new Date().toISOString()
                                }
                            ]
                        }
                    });
                    
                    if (trackingResult.success) {
                        // Update order with tracking number
                        await db.executeOperation({
                            database_name: 'peakmode',
                            collection_name: 'orders',
                            command: '--update',
                            data: {
                                filter: { orderId },
                                update: {
                                    trackingNumber: trackingResult.data.trackingNumber,
                                    carrier: trackingResult.data.carrier,
                                    updatedAt: new Date().toISOString()
                                }
                            }
                        });
                        
                        console.log(`Tracking entry created for order ${orderId}: ${trackingResult.data.trackingNumber}`);
                    }
                } catch (trackingError) {
                    console.error('Failed to create tracking entry:', trackingError);
                    // Don't fail the status update if tracking creation fails
                }
            }
            
            // Send appropriate email based on status
            try {
                const updatedOrder = { ...order, ...updateData };
                
                switch (status) {
                    case 'processing':
                        await emailService.sendOrderProcessingEmail(
                            order.customer.email,
                            updatedOrder
                        );
                        console.log(`Order processing email sent to ${order.customer.email}`);
                        break;
                    case 'shipped':
                        await emailService.sendShippingNotificationEmail(
                            order.customer.email,
                            updatedOrder
                        );
                        console.log(`Shipping notification email sent to ${order.customer.email}`);
                        break;
                    case 'delivered':
                        await emailService.sendDeliveryConfirmationEmail(
                            order.customer.email,
                            updatedOrder
                        );
                        console.log(`Delivery confirmation email sent to ${order.customer.email}`);
                        
                        // Schedule review request email (2-3 days later)
                        setTimeout(async () => {
                            try {
                                await emailService.sendReviewRequestEmail(
                                    order.customer.email,
                                    updatedOrder
                                );
                                console.log(`Review request email sent to ${order.customer.email}`);
                            } catch (reviewError) {
                                console.error('Failed to send review request email:', reviewError);
                            }
                        }, 2 * 24 * 60 * 60 * 1000); // 2 days in milliseconds
                        break;
                }
            } catch (emailError) {
                console.error('Failed to send status update email:', emailError);
                // Don't fail the status update if email fails
            }

            res.json({
                success: true,
                message: 'Order status updated',
                data: updateResult.data
            });
        } else {
            res.status(400).json(updateResult);
        }
    } catch (error) {
        console.error('Order status update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update order status'
        });
    }
});

// Track order by Order ID
router.get('/track/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (result.success && result.data) {
            // VornifyDB returns a single object when query is provided
            res.json({
                success: true,
                data: result.data
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
    } catch (error) {
        console.error('Order tracking error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to track order'
        });
    }
});

// Get all orders (for admin)
router.get('/all', async (req, res) => {
    try {
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: {}
        });
        
        res.json(result);
    } catch (error) {
        console.error('Get all orders error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve orders'
        });
    }
});

// Get orders by customer email
router.get('/customer/:email', async (req, res) => {
    try {
        const { email } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { 'customer.email': email }
        });
        
        res.json(result);
    } catch (error) {
        console.error('Get customer orders error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve customer orders'
        });
    }
});

// PUT /api/orders/:orderId - Update order (admin)
router.put('/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const updateData = req.body;
        
        // Find the order first
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!findResult.success || !findResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        const order = findResult.data;
        
        // Prepare update data with timeline if status changed
        const finalUpdateData = {
            ...updateData,
            updatedAt: new Date().toISOString()
        };
        
        // Add timeline entry if status is being updated
        if (updateData.status && updateData.status !== order.status) {
            const timelineEntry = {
                status: updateData.status.charAt(0).toUpperCase() + updateData.status.slice(1),
                date: new Date().toISOString(),
                description: generateTimelineDescription(updateData.status, updateData.shippingProvider, updateData.trackingNumber)
            };
            
            finalUpdateData.timeline = [...(order.timeline || []), timelineEntry];
        }
        
        // Update the order
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: finalUpdateData
            }
        });
        
        if (updateResult.success) {
            res.json({
                success: true,
                message: 'Order updated successfully',
                order: updateResult.data
            });
        } else {
            res.status(400).json(updateResult);
        }
    } catch (error) {
        console.error('Update order error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update order'
        });
    }
});

// POST /api/orders/:orderId/status - Update order status with email trigger
router.post('/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, trackingNumber, shippingProvider, sendEmail = true } = req.body;
        
        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Status is required'
            });
        }
        
        // Find the order first
        const findResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!findResult.success || !findResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        const order = findResult.data;
        
        // Prepare timeline entry
        const timelineEntry = {
            status: status.charAt(0).toUpperCase() + status.slice(1),
            date: new Date().toISOString(),
            description: generateTimelineDescription(status, shippingProvider, trackingNumber)
        };
        
        // Prepare update data
        const updateData = {
            status,
            updatedAt: new Date().toISOString(),
            timeline: [...(order.timeline || []), timelineEntry]
        };
        
        // Add shipping fields if provided
        if (shippingProvider) updateData.shippingProvider = shippingProvider;
        if (trackingNumber) updateData.trackingNumber = trackingNumber;
        
        // Update the order
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--update',
            data: {
                filter: { orderId },
                update: updateData
            }
        });
        
        if (updateResult.success) {
            let emailSent = false;
            
            // Send email notification if requested
            if (sendEmail) {
                try {
                    const updatedOrder = { ...order, ...updateData };
                    
                    switch (status) {
                        case 'processing':
                            await emailService.sendOrderProcessingEmail(
                                order.customer.email,
                                updatedOrder
                            );
                            emailSent = true;
                            console.log(`Order processing email sent to ${order.customer.email}`);
                            break;
                        case 'shipped':
                            await emailService.sendShippingNotificationEmail(
                                order.customer.email,
                                updatedOrder
                            );
                            emailSent = true;
                            console.log(`Shipping notification email sent to ${order.customer.email}`);
                            break;
                        case 'delivered':
                            await emailService.sendDeliveryConfirmationEmail(
                                order.customer.email,
                                updatedOrder
                            );
                            emailSent = true;
                            console.log(`Delivery confirmation email sent to ${order.customer.email}`);
                            break;
                    }
                } catch (emailError) {
                    console.error('Failed to send status update email:', emailError);
                }
            }
            
            res.json({
                success: true,
                message: 'Order status updated successfully',
                order: updateResult.data,
                emailSent
            });
        } else {
            res.status(400).json(updateResult);
        }
    } catch (error) {
        console.error('Update order status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update order status'
        });
    }
});

// GET /api/orders/:orderId - Get single order by ID (admin)
router.get('/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (result.success && result.data) {
            res.json({
                success: true,
                data: result.data
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve order'
        });
    }
});

// DELETE /api/orders/:orderId - Delete order (admin)
router.delete('/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--delete',
            data: { orderId }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Order deleted successfully'
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete order'
        });
    }
});

module.exports = router;

