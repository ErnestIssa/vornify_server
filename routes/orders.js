const express = require('express');
const router = express.Router();
const VortexDB = require('../vornifydb/vornifydb');

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
        
        // Prepare order with tracking fields
        const order = {
            ...orderData,
            orderId,
            status: orderData.status || 'processing',
            paymentStatus: orderData.paymentStatus || 'pending',
            timeline: [
                {
                    status: 'Order Placed',
                    date: new Date().toISOString(),
                    description: 'Order received and payment confirmed'
                }
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            orderDate: new Date().toISOString()
        };
        
        // Create the order in database
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--create',
            data: order
        });
        
        if (result.success) {
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

module.exports = router;

