const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');
const emailService = require('../services/emailService');
const currencyService = require('../services/currencyService');

const db = getDBInstance();

// Helper function to create or update customer record
async function createOrUpdateCustomer(order) {
    try {
        const customerEmail = order.customer.email;
        if (!customerEmail) return;

        // Check if customer exists with timeout
        const existingCustomer = await Promise.race([
            db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--read',
            data: { email: customerEmail }
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Customer lookup timeout')), 10000)
            )
        ]);

        const customerData = {
            id: customerEmail,
            name: order.customer.name || 
                  `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() ||
                  order.customerName ||
                  'Customer',
            email: customerEmail,
            phone: order.customer.phone || order.shippingAddress?.phone || '',
            address: {
                street: order.customer.address || order.shippingAddress?.street || '',
                city: order.customer.city || order.shippingAddress?.city || '',
                postalCode: order.customer.postalCode || order.shippingAddress?.postalCode || '',
                country: order.customer.country || order.shippingAddress?.country || ''
            },
            status: 'active',
            updatedAt: new Date().toISOString(),
            preferences: {
                newsletter: false,
                smsNotifications: false,
                preferredLanguage: 'en'
            }
        };

        if (existingCustomer.success && existingCustomer.data) {
            // Update existing customer with timeout
            await Promise.race([
                db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'customers',
                command: '--update',
                data: {
                    filter: { email: customerEmail },
                    update: customerData
                }
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Customer update timeout')), 10000)
                )
            ]);
        } else {
            // Create new customer with timeout
            customerData.joinDate = new Date().toISOString();
            customerData.createdAt = new Date().toISOString();
            customerData.ordersCount = 0;
            customerData.totalSpent = 0;
            customerData.averageOrderValue = 0;
            customerData.customerType = 'new';
            customerData.tags = ['new_user'];
            customerData.recentOrders = [];
            customerData.communicationLog = [];

            await Promise.race([
                db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'customers',
                command: '--create',
                data: customerData
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Customer creation timeout')), 10000)
                )
            ]);
        }

        // Update customer analytics (non-blocking, runs in background)
        updateCustomerAnalytics(customerEmail);
        
    } catch (error) {
        console.error('Error creating/updating customer:', error);
        throw error;
    }
}

// Helper function to update customer analytics (non-blocking, runs in background)
async function updateCustomerAnalytics(customerEmail) {
    // Run in background without blocking
    setImmediate(async () => {
    try {
            // Add timeout to prevent hanging
            const analyticsPromise = (async () => {
        // Get all orders for this customer
        const ordersResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { 'customer.email': customerEmail }
        });

        const orders = ordersResult.success ? ordersResult.data : [];
        const orderArray = Array.isArray(orders) ? orders : (orders ? [orders] : []);

        // Calculate analytics
        const ordersCount = orderArray.length;
        const totalSpent = orderArray.reduce((sum, order) => {
            return sum + (order.total || order.totals?.total || 0);
        }, 0);
        
        const averageOrderValue = ordersCount > 0 ? totalSpent / ordersCount : 0;
        
        // Get order dates
        const orderDates = orderArray
            .map(order => new Date(order.createdAt || order.orderDate))
            .filter(date => !isNaN(date.getTime()))
            .sort((a, b) => a - b);
        
        const firstOrderDate = orderDates.length > 0 ? orderDates[0] : null;
        const lastOrderDate = orderDates.length > 0 ? orderDates[orderDates.length - 1] : null;

        // Determine customer type
        let customerType = 'new';
        let tags = [];

        if (ordersCount === 0) {
            customerType = 'new';
            tags = ['new_user'];
        } else if (ordersCount === 1) {
            customerType = 'new';
            tags = ['new_user'];
        } else if (ordersCount >= 2 && ordersCount <= 4) {
            customerType = 'returning';
            tags = ['returning'];
        } else if (ordersCount >= 5) {
            customerType = 'loyal';
            tags = ['loyal'];
        }

        if (totalSpent > 5000) {
            customerType = 'vip';
            tags.push('vip', 'high_spender');
        }

        // Get recent orders (last 5)
        const recentOrders = orderArray
            .sort((a, b) => new Date(b.createdAt || b.orderDate) - new Date(a.createdAt || a.orderDate))
            .slice(0, 5)
            .map(order => ({
                id: order.orderId,
                date: order.createdAt || order.orderDate,
                total: order.total || order.totals?.total || 0,
                status: order.status,
                itemsCount: order.items ? order.items.length : 0
            }));

        // Update customer with analytics
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--update',
            data: {
                filter: { email: customerEmail },
                update: {
                    ordersCount,
                    totalSpent,
                    averageOrderValue,
                    firstOrderDate,
                    lastOrderDate,
                    customerType,
                    tags,
                    recentOrders,
                    updatedAt: new Date().toISOString()
                }
            }
        });
            })();

            // Add timeout protection
            await Promise.race([
                analyticsPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Analytics update timeout')), 30000)
                )
            ]);
    } catch (error) {
            console.error('Error updating customer analytics (background):', error.message);
            // Don't throw - this is background processing
    }
    });
}

// Helper function to generate unique Order ID with timeout protection
async function generateUniqueOrderId() {
    const maxRetries = 10; // Prevent infinite loops
    let attempts = 0;
    let orderId;
    let exists = true;
    
    while (exists && attempts < maxRetries) {
        attempts++;
        const randomNum = Math.floor(100000 + Math.random() * 900000);
        orderId = 'PM' + randomNum;
        
        try {
            // Check if this ID already exists with timeout
            const result = await Promise.race([
                db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { orderId }
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Order ID check timeout')), 5000)
                )
            ]);
        
        // VornifyDB returns single object when query is provided, or error if not found
        exists = result.success && result.data;
        } catch (error) {
            console.error(`Error checking order ID ${orderId} (attempt ${attempts}):`, error.message);
            // If timeout or error, assume ID doesn't exist and use it
            exists = false;
        }
    }
    
    if (attempts >= maxRetries) {
        // Fallback: use timestamp-based ID if we can't generate unique one
        orderId = 'PM' + Date.now() + Math.floor(Math.random() * 1000);
        console.warn(`Generated fallback order ID after ${maxRetries} attempts: ${orderId}`);
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
    const startTime = Date.now();
    console.log('📦 [ORDER CREATE] Request received at', new Date().toISOString());
    
    try {
        const orderData = req.body;
        console.log('📦 [ORDER CREATE] Order data received:', {
            customerEmail: orderData.customer?.email || orderData.customerEmail,
            itemsCount: orderData.items?.length || 0,
            total: orderData.total || orderData.totals?.total
        });
        
        // SECURITY: Validate and recalculate shipping cost server-side
        const { getShippingZone, applyZonePricingToOption, getZonePricing } = require('../utils/shippingZones');
        const shippingAddress = orderData.shippingAddress || orderData.customer;
        const shippingMethod = orderData.shippingMethod;
        
        if (shippingAddress && shippingMethod) {
            const country = shippingAddress.country || shippingAddress.countryCode;
            if (country) {
                const zone = getShippingZone(country.toUpperCase());
                if (zone) {
                    const providedShippingCost = orderData.shippingCost || orderData.totals?.shipping || shippingMethod.cost || 0;
                    
                    // Get valid prices for this zone to check if provided price is valid
                    const { getZonePricing } = require('../utils/shippingZones');
                    const zonePricing = getZonePricing(zone);
                    const validPrices = zonePricing ? Object.values(zonePricing) : [];
                    
                    // Check if provided cost matches any valid price for this zone (within 1 SEK tolerance)
                    const isValidPrice = validPrices.some(price => Math.abs(price - providedShippingCost) < 1);
                    
                    if (isValidPrice && providedShippingCost > 0) {
                        // Provided price is valid - trust it (user selected this price)
                        console.log('✅ [SHIPPING] Using provided shipping cost (valid for zone):', {
                            provided: providedShippingCost,
                            zone: zone,
                            methodType: shippingMethod.type || shippingMethod.id
                        });
                        
                        // Ensure shipping cost is set correctly
                        orderData.shippingCost = providedShippingCost;
                        if (orderData.totals) {
                            orderData.totals.shipping = providedShippingCost;
                        }
                        if (orderData.shippingMethod) {
                            orderData.shippingMethod.cost = providedShippingCost;
                        }
                    } else {
                        // Provided price is invalid - recalculate based on method type
                        const validatedMethod = applyZonePricingToOption(shippingMethod, zone);
                        const correctShippingCost = validatedMethod.cost || 0;
                        
                        console.warn('⚠️ [SECURITY] Shipping cost mismatch detected, recalculating:', {
                            orderId: 'pending',
                            provided: providedShippingCost,
                            correct: correctShippingCost,
                            zone: zone,
                            methodType: shippingMethod.type || shippingMethod.id,
                            methodId: shippingMethod.id,
                            methodName: shippingMethod.name,
                            country: country,
                            validPrices: validPrices
                        });
                        
                        // Use server-calculated price (secure, cannot be manipulated)
                        orderData.shippingCost = correctShippingCost;
                        if (orderData.totals) {
                            orderData.totals.shipping = correctShippingCost;
                        }
                        
                        // Update shipping method with correct cost
                        if (orderData.shippingMethod) {
                            orderData.shippingMethod.cost = correctShippingCost;
                        }
                        
                        console.log('✅ [SECURITY] Shipping cost validated and corrected:', {
                            zone: zone,
                            correctCost: correctShippingCost,
                            methodType: shippingMethod.type || shippingMethod.id
                        });
                    }
                }
            }
        }
        
        // Generate unique Order ID with timeout protection
        console.log('📦 [ORDER CREATE] Generating unique order ID...');
        const orderId = await Promise.race([
            generateUniqueOrderId(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Order ID generation timeout')), 10000)
            )
        ]);
        console.log('📦 [ORDER CREATE] Order ID generated:', orderId);
        
        // Prepare order with enhanced customer data structure
        const order = {
            ...orderData,
            orderId,
            status: orderData.status || 'processing',
            paymentStatus: orderData.paymentStatus || 'pending',
            emailSent: false, // Flag to track if confirmation email has been sent
            
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
            
            // Multi-currency support
            currency: orderData.currency || currencyService.BASE_CURRENCY,
            baseTotal: orderData.baseTotal || orderData.totals?.total || orderData.total || 0,
            baseCurrency: orderData.baseCurrency || currencyService.BASE_CURRENCY,
            exchangeRate: orderData.exchangeRate || 1.0,
            rateTimestamp: orderData.rateTimestamp || new Date().toISOString(),
            
            // Language support (for email localization)
            language: orderData.language || 'en', // Default to English if not provided
            
            // Order status and details
            paymentMethod: orderData.paymentMethod || 'card',
            paymentIntentId: orderData.paymentIntentId || null, // Stripe payment intent ID
            stripeCustomerId: orderData.stripeCustomerId || null, // Stripe customer ID
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
        
        // Create the order in database with timeout protection
        console.log('📦 [ORDER CREATE] Saving order to database...');
        const result = await Promise.race([
            db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--create',
            data: order
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Database operation timeout')), 15000)
            )
        ]);
        
        const dbTime = Date.now() - startTime;
        console.log(`📦 [ORDER CREATE] Database operation completed in ${dbTime}ms`);
        
        if (result.success) {
            console.log('📦 [ORDER CREATE] Order created successfully:', orderId);
            
            // Send response immediately - don't wait for background operations
            const responseTime = Date.now() - startTime;
            console.log(`📦 [ORDER CREATE] Sending response in ${responseTime}ms`);
            
            // Note: Email is sent in background, so we don't wait for it here
            res.json({
                success: true,
                message: 'Order created successfully',
                orderId: orderId,
                data: {
                    orderId: orderId,
                    order: order,
                    emailWillBeSent: !order.emailSent && !!order.customer?.email // Indicate if email will be sent
                }
            });
            
            // Run background operations after response is sent (non-blocking)
            setImmediate(async () => {
                try {
                    // Update payment intent with actual order ID if it was created with temporary ID
                    if (order.paymentIntentId) {
                        console.log('📦 [ORDER CREATE] Background: Updating payment intent with actual order ID...');
                        try {
                            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                            const existingIntent = await stripe.paymentIntents.retrieve(order.paymentIntentId);
                            
                            // Check if payment intent has temporary order ID
                            if (existingIntent.metadata?.isTemporary === 'true' || 
                                existingIntent.metadata?.orderId?.startsWith('TEMP-')) {
                                
                                await stripe.paymentIntents.update(order.paymentIntentId, {
                                    metadata: {
                                        ...existingIntent.metadata,
                                        orderId: orderId,
                                        isTemporary: 'false',
                                        updatedAt: new Date().toISOString()
                                    }
                                });
                                
                                console.log(`📦 [ORDER CREATE] Background: Payment intent ${order.paymentIntentId} updated with order ID ${orderId}`);
                            }
                        } catch (paymentIntentError) {
                            console.error('📦 [ORDER CREATE] Background: Failed to update payment intent:', paymentIntentError.message);
                            // Don't fail - this is background processing
                        }
                    }

                    // Create or update customer record (background)
                    console.log('📦 [ORDER CREATE] Background: Creating/updating customer...');
                    try {
                        await Promise.race([
                            createOrUpdateCustomer(order),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Customer update timeout')), 20000)
                            )
                        ]);
                        console.log('📦 [ORDER CREATE] Background: Customer updated successfully');
            } catch (customerError) {
                        console.error('📦 [ORDER CREATE] Background: Failed to create/update customer:', customerError.message);
                        // Don't fail - this is background processing
            }

                    // CRITICAL: DO NOT send order confirmation email here!
                    // Order confirmation emails should ONLY be sent AFTER payment is confirmed
                    // This prevents sending confirmation emails for unpaid orders
                    // Email will be sent in payment webhook handler (handlePaymentIntentSucceeded)
                    console.log('📦 [ORDER CREATE] Background: Order created. Waiting for payment confirmation before sending email.');
                    console.log('📦 [ORDER CREATE] Background: Email will be sent when payment is confirmed via Stripe webhook.');
                    
                    const totalTime = Date.now() - startTime;
                    console.log(`📦 [ORDER CREATE] Background operations completed in ${totalTime}ms total`);
                } catch (bgError) {
                    console.error('📦 [ORDER CREATE] Background: Unexpected error in background operations:', bgError.message);
                }
            });
        } else {
            console.error('📦 [ORDER CREATE] Database operation failed:', result);
            res.status(400).json({
                success: false,
                error: result.error || 'Failed to create order in database',
                ...result
            });
        }
    } catch (error) {
        const errorTime = Date.now() - startTime;
        console.error(`📦 [ORDER CREATE] Error after ${errorTime}ms:`, error.message);
        console.error('📦 [ORDER CREATE] Error stack:', error.stack);
        
        // Ensure response is sent even on error
        if (!res.headersSent) {
        res.status(500).json({
            success: false,
                error: error.message || 'Failed to create order',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
        }
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

// Get all orders (for admin) - Also supports email query parameter
router.get('/all', async (req, res) => {
    try {
        const { email } = req.query;
        
        // If email query parameter is provided, filter by email
        if (email) {
            const result = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'orders',
                command: '--read',
                data: { 'customer.email': email }
            });
            
            if (result.success) {
                // Ensure data is always an array
                let orders = result.data || [];
                if (!Array.isArray(orders)) {
                    orders = orders ? [orders] : [];
                }
                
                // Format response to match frontend expectations
                const formattedOrders = orders.map(order => ({
                    orderId: order.orderId || order._id,
                    email: order.customer?.email || email,
                    items: order.items || [],
                    total: order.total || order.totals?.total || 0,
                    status: order.status || 'unknown',
                    createdAt: order.createdAt || order.orderDate || order.date,
                    shippingAddress: order.shippingAddress,
                    customer: order.customer,
                    paymentStatus: order.paymentStatus,
                    trackingNumber: order.trackingNumber,
                    shippingProvider: order.shippingProvider,
                    estimatedDelivery: order.estimatedDelivery
                }));
                
                return res.json({
                    success: true,
                    data: formattedOrders
                });
            } else {
                return res.json({
                    success: true,
                    data: []
                });
            }
        }
        
        // Get all orders
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: {}
        });
        
        res.json(result);
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve orders'
        });
    }
});

// Get orders by customer email (path parameter - for backward compatibility)
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

