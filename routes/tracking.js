const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

// Helper function to generate tracking number
function generateTrackingNumber(carrierCode) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `${carrierCode}${timestamp}${random}`;
}

// Helper function to validate tracking number format
function validateTrackingNumber(trackingNumber) {
    if (!trackingNumber || typeof trackingNumber !== 'string') {
        throw new Error('Tracking number is required');
    }
    
    if (trackingNumber.length < 8 || trackingNumber.length > 50) {
        throw new Error('Invalid tracking number format');
    }
    
    return true;
}

// Helper function to get carrier from tracking number
function getCarrierFromTrackingNumber(trackingNumber) {
    const upperTracking = trackingNumber.toUpperCase();
    
    if (upperTracking.startsWith('POSTNORD') || upperTracking.startsWith('PN')) {
        return 'POSTNORD';
    } else if (upperTracking.startsWith('DHL')) {
        return 'DHL';
    } else if (upperTracking.startsWith('UPS')) {
        return 'UPS';
    } else if (upperTracking.startsWith('FEDEX') || upperTracking.startsWith('FX')) {
        return 'FEDEX';
    }
    
    return 'UNKNOWN';
}

// Helper function to call carrier tracking API
async function getCarrierTrackingInfo(trackingNumber, carrier) {
    try {
        // This would integrate with actual carrier APIs
        // For now, return mock tracking data
        
        const mockEvents = [
            {
                status: 'In Transit',
                location: 'Stockholm, Sweden',
                description: 'Package is in transit to destination',
                timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2 hours ago
            },
            {
                status: 'Picked Up',
                location: 'Peak Mode Warehouse, Stockholm',
                description: 'Package has been picked up from sender',
                timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() // 4 hours ago
            },
            {
                status: 'Label Created',
                location: 'Peak Mode Warehouse, Stockholm',
                description: 'Shipping label has been created',
                timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() // 6 hours ago
            }
        ];
        
        return {
            trackingNumber,
            carrier,
            status: 'In Transit',
            estimatedDelivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
            events: mockEvents,
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error(`Carrier tracking API error for ${carrier}:`, error);
        throw new Error(`Failed to get tracking information from ${carrier}`);
    }
}

// GET /api/tracking/track/:trackingNumber - Track by tracking number
router.get('/track/:trackingNumber', async (req, res) => {
    try {
        const { trackingNumber } = req.params;
        
        // Validate tracking number
        validateTrackingNumber(trackingNumber);
        
        // Get carrier from tracking number
        const carrier = getCarrierFromTrackingNumber(trackingNumber);
        
        // Get tracking info from carrier API
        const trackingInfo = await getCarrierTrackingInfo(trackingNumber, carrier);
        
        // Store tracking info in database for caching
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'tracking_events',
            command: '--upsert',
            data: {
                filter: { trackingNumber },
                update: {
                    ...trackingInfo,
                    lastChecked: new Date().toISOString()
                }
            }
        });
        
        res.json({
            success: true,
            data: trackingInfo
        });
        
    } catch (error) {
        console.error('Track package error:', error);
        res.status(400).json({
            success: false,
            error: error.message || 'Failed to track package'
        });
    }
});

// GET /api/tracking/orders/:orderId - Get order tracking info
router.get('/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        // Get order from database
        const orderResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
        });
        
        if (!orderResult.success || !orderResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        const order = orderResult.data;
        
        // Check if order has tracking information
        if (!order.trackingNumber) {
            return res.json({
                success: true,
                data: {
                    orderId,
                    status: 'No tracking available',
                    message: 'Tracking information will be available once the package is shipped',
                    trackingNumber: null,
                    carrier: null,
                    events: []
                }
            });
        }
        
        // Get tracking info
        const trackingInfo = await getCarrierTrackingInfo(order.trackingNumber, order.carrier);
        
        res.json({
            success: true,
            data: {
                orderId,
                ...trackingInfo,
                order: {
                    orderId: order.orderId,
                    status: order.status,
                    customer: order.customer,
                    items: order.items,
                    shippingAddress: order.shippingAddress
                }
            }
        });
        
    } catch (error) {
        console.error('Get order tracking error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get order tracking information'
        });
    }
});

// POST /api/tracking/entries - Create tracking entry (for order processing)
router.post('/entries', async (req, res) => {
    try {
        const { orderId, carrier, shippingMethodId, shippingCost } = req.body;
        
        if (!orderId || !carrier) {
            return res.status(400).json({
                success: false,
                error: 'Order ID and carrier are required'
            });
        }
        
        // Generate tracking number
        const trackingNumber = generateTrackingNumber(carrier);
        
        // Create tracking entry
        const trackingEntry = {
            orderId,
            trackingNumber,
            carrier,
            shippingMethodId: shippingMethodId || null,
            shippingCost: shippingCost || 0,
            status: 'Label Created',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            events: [
                {
                    status: 'Label Created',
                    location: 'Peak Mode Warehouse, Stockholm',
                    description: 'Shipping label has been created',
                    timestamp: new Date().toISOString()
                }
            ]
        };
        
        // Save tracking entry
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'tracking_events',
            command: '--create',
            data: trackingEntry
        });
        
        if (result.success) {
            // Update order with tracking information
            await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--update',
                data: {
                    filter: { orderId },
                    update: {
                        trackingNumber,
                        carrier,
                        shippingMethodId,
                        shippingCost,
                        updatedAt: new Date().toISOString()
                    }
                }
            });
            
            res.json({
                success: true,
                message: 'Tracking entry created successfully',
                data: {
                    orderId,
                    trackingNumber,
                    carrier,
                    trackingUrl: `${process.env.FRONTEND_URL || 'https://peakmode.co'}/track-order?trackingNumber=${trackingNumber}`
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to create tracking entry'
            });
        }
        
    } catch (error) {
        console.error('Create tracking entry error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create tracking entry'
        });
    }
});

// PUT /api/tracking/status - Update tracking status (webhook endpoint)
router.put('/status', async (req, res) => {
    try {
        const { trackingNumber, status, location, description, timestamp } = req.body;
        
        if (!trackingNumber || !status) {
            return res.status(400).json({
                success: false,
                error: 'Tracking number and status are required'
            });
        }
        
        // Validate tracking number
        validateTrackingNumber(trackingNumber);
        
        // Get existing tracking entry
        const existingResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'tracking_events',
            command: '--read',
            data: { trackingNumber }
        });
        
        if (!existingResult.success || !existingResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Tracking entry not found'
            });
        }
        
        const trackingEntry = existingResult.data;
        
        // Create new event
        const newEvent = {
            status,
            location: location || 'Unknown',
            description: description || `Status updated to ${status}`,
            timestamp: timestamp || new Date().toISOString()
        };
        
        // Update tracking entry
        const updatedEntry = {
            ...trackingEntry,
            status,
            lastUpdated: new Date().toISOString(),
            events: [...(trackingEntry.events || []), newEvent]
        };
        
        // Save updated tracking entry
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'tracking_events',
            command: '--upsert',
            data: {
                filter: { trackingNumber },
                update: updatedEntry
            }
        });
        
        if (updateResult.success) {
            // Update order status if needed
            if (trackingEntry.orderId) {
                let orderStatus = trackingEntry.status;
                
                // Map tracking status to order status
                switch (status.toLowerCase()) {
                    case 'delivered':
                        orderStatus = 'delivered';
                        break;
                    case 'out for delivery':
                        orderStatus = 'shipped';
                        break;
                    case 'in transit':
                        orderStatus = 'shipped';
                        break;
                    case 'exception':
                    case 'delivery exception':
                        orderStatus = 'processing';
                        break;
                }
                
                // Update order status
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'orders',
                    command: '--update',
                    data: {
                        filter: { orderId: trackingEntry.orderId },
                        update: {
                            status: orderStatus,
                            updatedAt: new Date().toISOString()
                        }
                    }
                });
            }
            
            res.json({
                success: true,
                message: 'Tracking status updated successfully',
                data: {
                    trackingNumber,
                    status,
                    event: newEvent
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to update tracking status'
            });
        }
        
    } catch (error) {
        console.error('Update tracking status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update tracking status'
        });
    }
});

// GET /api/tracking/history/:trackingNumber - Get tracking history
router.get('/history/:trackingNumber', async (req, res) => {
    try {
        const { trackingNumber } = req.params;
        
        // Validate tracking number
        validateTrackingNumber(trackingNumber);
        
        // Get tracking history from database
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'tracking_events',
            command: '--read',
            data: { trackingNumber }
        });
        
        if (!result.success || !result.data) {
            return res.status(404).json({
                success: false,
                error: 'Tracking information not found'
            });
        }
        
        res.json({
            success: true,
            data: result.data
        });
        
    } catch (error) {
        console.error('Get tracking history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get tracking history'
        });
    }
});

module.exports = router;
