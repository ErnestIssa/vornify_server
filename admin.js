const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Initialize AdminJS and its adapters
let AdminJS, AdminJSMongoose;

const initializeAdminJS = async () => {
    if (!AdminJS) {
        AdminJS = (await import('adminjs')).default;
        AdminJSMongoose = (await import('@adminjs/mongoose')).default;
        AdminJS.registerAdapter(AdminJSMongoose);
    }
    return { AdminJS, AdminJSMongoose };
};

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://dev:MWV3Fp1ybznhRQXT@cluster0.dwv6j.mongodb.net/';

// Connect to MongoDB
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// Define schemas for your collections
const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    description: String,
    category: String,
    inventory: {
        colors: [{
            id: String,
            name: String,
            hex: String,
            available: Boolean,
            sortOrder: Number
        }],
        sizes: [{
            id: String,
            name: String,
            description: String,
            available: Boolean,
            sortOrder: Number
        }],
        variants: [{
            id: String,
            colorId: String,
            sizeId: String,
            sku: String,
            quantity: Number,
            price: Number,
            available: Boolean
        }],
        totalQuantity: Number,
        trackPerVariant: Boolean,
        lastUpdated: Date
    },
    images: [String],
    isPrivate: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
    orderNumber: { type: String, required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    products: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        variantId: String,
        quantity: Number,
        price: Number
    }],
    totalAmount: { type: Number, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
        default: 'pending'
    },
    shippingAddress: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String
    },
    paymentMethod: String,
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending'
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const CustomerSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: String,
    address: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String
    },
    dateOfBirth: Date,
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const ReviewSchema = new mongoose.Schema({
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: String,
    comment: String,
    isVerified: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const AdminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, default: 'admin' },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

// Create models
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);
const Customer = mongoose.model('Customer', CustomerSchema);
const Review = mongoose.model('Review', ReviewSchema);
const Admin = mongoose.model('Admin', AdminSchema);

// AdminJS configuration
const createAdminJS = async () => {
    const { AdminJS } = await initializeAdminJS();
    return new AdminJS({
    resources: [
        {
            resource: Product,
            options: {
                listProperties: ['name', 'price', 'category', 'inventory.totalQuantity', 'isPrivate', 'createdAt'],
                editProperties: ['name', 'price', 'description', 'category', 'inventory', 'images', 'isPrivate'],
                filterProperties: ['name', 'category', 'isPrivate', 'createdAt'],
                showProperties: ['name', 'price', 'description', 'category', 'inventory', 'images', 'isPrivate', 'createdAt', 'updatedAt'],
                parent: {
                    name: 'Products',
                    icon: 'Product'
                }
            }
        },
        {
            resource: Order,
            options: {
                listProperties: ['orderNumber', 'customerId', 'totalAmount', 'status', 'paymentStatus', 'createdAt'],
                editProperties: ['status', 'paymentStatus', 'shippingAddress'],
                filterProperties: ['status', 'paymentStatus', 'createdAt'],
                showProperties: ['orderNumber', 'customerId', 'products', 'totalAmount', 'status', 'shippingAddress', 'paymentMethod', 'paymentStatus', 'createdAt', 'updatedAt'],
                parent: {
                    name: 'Orders',
                    icon: 'Order'
                }
            }
        },
        {
            resource: Customer,
            options: {
                listProperties: ['firstName', 'lastName', 'email', 'phone', 'isActive', 'createdAt'],
                editProperties: ['firstName', 'lastName', 'email', 'phone', 'address', 'dateOfBirth', 'isActive'],
                filterProperties: ['email', 'isActive', 'createdAt'],
                showProperties: ['firstName', 'lastName', 'email', 'phone', 'address', 'dateOfBirth', 'isActive', 'createdAt', 'updatedAt'],
                parent: {
                    name: 'Customers',
                    icon: 'User'
                }
            }
        },
        {
            resource: Review,
            options: {
                listProperties: ['productId', 'customerId', 'rating', 'title', 'isVerified', 'isApproved', 'createdAt'],
                editProperties: ['rating', 'title', 'comment', 'isVerified', 'isApproved'],
                filterProperties: ['rating', 'isVerified', 'isApproved', 'createdAt'],
                showProperties: ['productId', 'customerId', 'rating', 'title', 'comment', 'isVerified', 'isApproved', 'createdAt', 'updatedAt'],
                parent: {
                    name: 'Reviews',
                    icon: 'Star'
                }
            }
        }
    ],
    rootPath: '/adminjs',
    branding: {
        companyName: 'Peak Mode Admin',
        logo: false,
        softwareBrothers: false
    },
    dashboard: {
        component: AdminJS.bundle('./dashboard-component.jsx')
    }
    });
};

// Authentication function
const authenticate = async (email, password) => {
    try {
        const admin = await Admin.findOne({ email, isActive: true });
        if (!admin) {
            return false;
        }
        
        const isValidPassword = await bcrypt.compare(password, admin.password);
        return isValidPassword ? admin : false;
    } catch (error) {
        console.error('Authentication error:', error);
        return false;
    }
};

// Create AdminJS router with authentication
const createAdminRouter = async () => {
    const AdminJSExpress = (await import('@adminjs/express')).default;
    const adminJs = await createAdminJS();
    
    const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
        adminJs,
        {
            authenticate,
            cookieName: 'adminjs',
            cookiePassword: process.env.ADMINJS_COOKIE_PASSWORD || 'adminjs-secret-key-change-in-production'
        },
        null,
        {
            resave: true,
            saveUninitialized: true,
            secret: process.env.ADMINJS_SESSION_SECRET || 'adminjs-session-secret-change-in-production'
        }
    );
    
    return { adminJs, adminRouter };
};

module.exports = { createAdminJS, createAdminRouter, Product, Order, Customer, Review, Admin };
