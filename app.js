const express = require('express');
const cors = require('cors');
const path = require('path');
const dbRoutes = require('./routes/db');
const paymentRoutes = require('./routes/payment');
const storageRoutes = require('./routes/storage');
const emailRoutes = require('./routes/emailRoutes');
const uploadRoutes = require('./routes/upload');
const ordersRoutes = require('./routes/orders');
const emailTestRoutes = require('./routes/emailTest');
const newsletterRoutes = require('./routes/newsletter');
const authRoutes = require('./routes/auth');
const emailStatsRoutes = require('./routes/emailStats');
const supportRoutes = require('./routes/support');
const cartRoutes = require('./routes/cart');
const productRoutes = require('./routes/products');
const shippingRoutes = require('./routes/shipping');
const trackingRoutes = require('./routes/tracking');
const customerRoutes = require('./routes/customers');
const reviewRoutes = require('./routes/reviews');
const errorHandler = require('./middleware/errorHandler');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// CORS configuration for production
app.use(cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true,
    maxAge: 86400 // 24 hours
}));

// Increase payload size limit for video uploads (set to 200MB)
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Middleware
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve uploaded images

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', environment: process.env.NODE_ENV });
});

// API documentation endpoint
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/vornifypay/doc_pay.html');
});

// Routes
app.use('/api/vornifydb', dbRoutes);
app.use('/api/vornifypay', paymentRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/email-test', emailTestRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/email', emailStatsRoutes); // Email stats and logs
app.use('/api/support', supportRoutes); // Support/contact messages
app.use('/api/cart', cartRoutes); // Cart management
app.use('/api/products', productRoutes); // Product management
app.use('/api/shipping', shippingRoutes); // Shipping quotes and methods
app.use('/api/tracking', trackingRoutes); // Package tracking
app.use('/api/customers', customerRoutes); // Customer management and analytics
app.use('/api/reviews', reviewRoutes); // Reviews management and moderation

// Documentation routes
app.get('/storage/docs', (req, res) => {
    res.sendFile(__dirname + '/vornifydb/storage/doc_storage.html');
});

// Error handling middleware
app.use(errorHandler);

// Handle 404
app.use((req, res) => {
    res.status(404).json({
        status: false,
        error: 'Not Found',
        endpoint: req.originalUrl
    });
});

// Start server
if (process.env.NODE_ENV !== 'test') {
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
}

module.exports = app; // For testing purposes 