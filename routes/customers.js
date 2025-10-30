const express = require('express');
const router = express.Router();
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();

// Helper function to calculate customer analytics
async function calculateCustomerAnalytics(customerId) {
    try {
        // Get all orders for this customer
        const ordersResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { 'customer.email': customerId }
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

        return {
            ordersCount,
            totalSpent,
            averageOrderValue,
            firstOrderDate,
            lastOrderDate,
            customerType,
            tags,
            recentOrders
        };
    } catch (error) {
        console.error('Error calculating customer analytics:', error);
        return {
            ordersCount: 0,
            totalSpent: 0,
            averageOrderValue: 0,
            firstOrderDate: null,
            lastOrderDate: null,
            customerType: 'new',
            tags: ['new_user'],
            recentOrders: []
        };
    }
}

// Helper function to update customer analytics
async function updateCustomerAnalytics(customerId) {
    try {
        const analytics = await calculateCustomerAnalytics(customerId);
        
        // Update customer record
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--update',
            data: {
                filter: { email: customerId },
                update: {
                    ...analytics,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        return analytics;
    } catch (error) {
        console.error('Error updating customer analytics:', error);
        return null;
    }
}

// GET /api/customers - Get all customers with analytics
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 50, status, customerType, search } = req.query;
        
        let query = {};
        
        // Add filters
        if (status) query.status = status;
        if (customerType) query.customerType = customerType;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--read',
            data: query
        });

        if (result.success) {
            let customers = result.data || [];
            if (!Array.isArray(customers)) {
                customers = [customers];
            }

            // Sort by joinDate (newest first)
            customers.sort((a, b) => new Date(b.joinDate || b.createdAt) - new Date(a.joinDate || a.createdAt));

            // Pagination
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + parseInt(limit);
            const paginatedCustomers = customers.slice(startIndex, endIndex);

            res.json({
                success: true,
                data: paginatedCustomers,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: customers.length,
                    pages: Math.ceil(customers.length / limit)
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve customers'
            });
        }
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve customers'
        });
    }
});

// GET /api/customers/analytics - Get customer analytics dashboard
router.get('/analytics', async (req, res) => {
    try {
        // Get all customers
        const customersResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--read',
            data: {}
        });

        const customers = customersResult.success ? customersResult.data : [];
        const customerArray = Array.isArray(customers) ? customers : (customers ? [customers] : []);

        // Calculate dashboard analytics
        const totalCustomers = customerArray.length;
        const newCustomers = customerArray.filter(c => c.customerType === 'new').length;
        const returningCustomers = customerArray.filter(c => c.customerType === 'returning').length;
        const vipCustomers = customerArray.filter(c => c.customerType === 'vip').length;
        const loyalCustomers = customerArray.filter(c => c.customerType === 'loyal').length;
        const activeCustomers = customerArray.filter(c => c.status === 'active').length;
        const inactiveCustomers = customerArray.filter(c => c.status === 'inactive').length;
        const bannedCustomers = customerArray.filter(c => c.status === 'banned').length;

        // Calculate revenue metrics
        const totalRevenue = customerArray.reduce((sum, customer) => sum + (customer.totalSpent || 0), 0);
        const averageOrderValue = customerArray.length > 0 ? 
            customerArray.reduce((sum, customer) => sum + (customer.averageOrderValue || 0), 0) / customerArray.length : 0;

        // Calculate retention rate
        const customersWithOrders = customerArray.filter(c => (c.ordersCount || 0) > 0);
        const returningCustomersCount = customersWithOrders.filter(c => (c.ordersCount || 0) > 1).length;
        const customerRetentionRate = customersWithOrders.length > 0 ? 
            (returningCustomersCount / customersWithOrders.length) * 100 : 0;

        // Get top spending customers
        const topSpendingCustomers = customerArray
            .filter(c => (c.totalSpent || 0) > 0)
            .sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0))
            .slice(0, 10)
            .map(customer => ({
                id: customer.id,
                name: customer.name,
                email: customer.email,
                totalSpent: customer.totalSpent || 0,
                ordersCount: customer.ordersCount || 0,
                customerType: customer.customerType || 'new'
            }));

        // Get recent customers (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const recentCustomers = customerArray
            .filter(c => new Date(c.joinDate || c.createdAt) >= thirtyDaysAgo)
            .sort((a, b) => new Date(b.joinDate || b.createdAt) - new Date(a.joinDate || a.createdAt))
            .slice(0, 10)
            .map(customer => ({
                id: customer.id,
                name: customer.name,
                email: customer.email,
                joinDate: customer.joinDate || customer.createdAt,
                customerType: customer.customerType || 'new'
            }));

        res.json({
            success: true,
            data: {
                totalCustomers,
                newCustomers,
                returningCustomers,
                vipCustomers,
                loyalCustomers,
                activeCustomers,
                inactiveCustomers,
                bannedCustomers,
                averageOrderValue: Math.round(averageOrderValue * 100) / 100,
                totalRevenue,
                customerRetentionRate: Math.round(customerRetentionRate * 100) / 100,
                topSpendingCustomers,
                recentCustomers
            }
        });
    } catch (error) {
        console.error('Get customer analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve customer analytics'
        });
    }
});

// GET /api/customers/:id - Get single customer by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--read',
            data: { email: id }
        });
        
        if (result.success && result.data) {
            res.json({
                success: true,
                data: result.data
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Customer not found'
            });
        }
    } catch (error) {
        console.error('Get customer error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve customer'
        });
    }
});

// GET /api/customers/:id/orders - Get customer's order history
router.get('/:id/orders', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'orders',
            command: '--read',
            data: { 'customer.email': id }
        });
        
        if (result.success) {
            let orders = result.data || [];
            if (!Array.isArray(orders)) {
                orders = [orders];
            }

            // Sort by date (newest first)
            orders.sort((a, b) => new Date(b.createdAt || b.orderDate) - new Date(a.createdAt || a.orderDate));

            res.json({
                success: true,
                data: orders
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve customer orders'
            });
        }
    } catch (error) {
        console.error('Get customer orders error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve customer orders'
        });
    }
});

// POST /api/customers - Create new customer
router.post('/', async (req, res) => {
    try {
        const customerData = req.body;
        
        // Validate required fields
        if (!customerData.email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        // Check if customer already exists
        const existingResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--read',
            data: { email: customerData.email }
        });

        if (existingResult.success && existingResult.data) {
            return res.status(400).json({
                success: false,
                error: 'Customer with this email already exists'
            });
        }

        // Prepare customer data
        const customer = {
            ...customerData,
            id: customerData.email, // Use email as ID
            status: customerData.status || 'active',
            joinDate: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ordersCount: 0,
            totalSpent: 0,
            averageOrderValue: 0,
            customerType: 'new',
            tags: ['new_user'],
            recentOrders: [],
            communicationLog: [],
            preferences: {
                newsletter: customerData.preferences?.newsletter || false,
                smsNotifications: customerData.preferences?.smsNotifications || false,
                preferredLanguage: customerData.preferences?.preferredLanguage || 'en'
            }
        };

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--create',
            data: customer
        });

        if (result.success) {
            res.json({
                success: true,
                message: 'Customer created successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Create customer error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create customer'
        });
    }
});

// PUT /api/customers/:id - Update customer
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        
        // Add updated timestamp
        updateData.updatedAt = new Date().toISOString();
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--update',
            data: {
                filter: { email: id },
                update: updateData
            }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Customer updated successfully',
                data: result.data
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update customer'
        });
    }
});

// POST /api/customers/:id/communication - Add communication log entry
router.post('/:id/communication', async (req, res) => {
    try {
        const { id } = req.params;
        const { type, subject, content, status = 'sent', adminNotes } = req.body;
        
        if (!type || !subject) {
            return res.status(400).json({
                success: false,
                error: 'Type and subject are required'
            });
        }

        // Get current customer
        const customerResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--read',
            data: { email: id }
        });

        if (!customerResult.success || !customerResult.data) {
            return res.status(404).json({
                success: false,
                error: 'Customer not found'
            });
        }

        const customer = customerResult.data;
        
        // Create communication log entry
        const communicationEntry = {
            id: `comm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            subject,
            content: content || '',
            date: new Date().toISOString(),
            status,
            adminNotes: adminNotes || ''
        };

        // Add to communication log
        const updatedCommunicationLog = [...(customer.communicationLog || []), communicationEntry];

        // Update customer
        const updateResult = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--update',
            data: {
                filter: { email: id },
                update: {
                    communicationLog: updatedCommunicationLog,
                    updatedAt: new Date().toISOString()
                }
            }
        });

        if (updateResult.success) {
            res.json({
                success: true,
                message: 'Communication log entry added successfully',
                data: communicationEntry
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to add communication log entry'
            });
        }
    } catch (error) {
        console.error('Add communication log error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add communication log entry'
        });
    }
});

// POST /api/customers/:id/analytics - Update customer analytics
router.post('/:id/analytics', async (req, res) => {
    try {
        const { id } = req.params;
        
        const analytics = await updateCustomerAnalytics(id);
        
        if (analytics) {
            res.json({
                success: true,
                message: 'Customer analytics updated successfully',
                data: analytics
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to update customer analytics'
            });
        }
    } catch (error) {
        console.error('Update customer analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update customer analytics'
        });
    }
});

// DELETE /api/customers/:id - Delete customer
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'customers',
            command: '--delete',
            data: { email: id }
        });
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Customer deleted successfully'
            });
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Delete customer error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete customer'
        });
    }
});

module.exports = router;
