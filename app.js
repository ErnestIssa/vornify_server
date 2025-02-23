const express = require('express');
const cors = require('cors');
const path = require('path');
const dbRoutes = require('./routes/db');
const paymentRoutes = require('./routes/payment');
const storageRoutes = require('./routes/storage');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3010;

// CORS configuration for production
app.use(cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true,
    maxAge: 86400 // 24 hours
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files

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

// Documentation routes
app.get('/storage/docs', (req, res) => {
    res.sendFile(__dirname + '/vornifydb/storage/doc_storage.html');
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        status: false,
        error: 'Something went wrong!',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

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