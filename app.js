const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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
const emailVerificationRoutes = require('./routes/emailVerification');
const supportRoutes = require('./routes/support');
const cartRoutes = require('./routes/cart');
const productRoutes = require('./routes/products');
const shippingRoutes = require('./routes/shipping');
const trackingRoutes = require('./routes/tracking');
const customerRoutes = require('./routes/customers');
const reviewRoutes = require('./routes/reviews');
const currencyRoutes = require('./routes/currency');
const errorHandler = require('./middleware/errorHandler');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// CORS configuration for production
app.use(cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true,
    maxAge: 86400 // 24 hours
}));

// Increase payload size limit for video uploads (set to 200MB)
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// CRITICAL: Apple Pay domain verification file route MUST be before static middleware
// This ensures the route is matched before Express tries to serve static files
// Apple Pay domain verification file
// CRITICAL: This file must be accessible at BOTH:
// - https://peakmode.se/.well-known/apple-developer-merchantid-domain-association
// - https://www.peakmode.se/.well-known/apple-developer-merchantid-domain-association
// Stripe requires this exact path with no redirects and Content-Type: text/plain
// Both domains point to the same server, so this single route serves both
app.get('/.well-known/apple-developer-merchantid-domain-association', (req, res) => {
    console.log('🔍 [APPLE PAY] Route hit: /.well-known/apple-developer-merchantid-domain-association');
    console.log('🔍 [APPLE PAY] Request from:', req.headers.host);
    console.log('🔍 [APPLE PAY] Request URL:', req.url);
    console.log('🔍 [APPLE PAY] Request method:', req.method);
    console.log('🔍 [APPLE PAY] Request path:', req.path);
    
    try {
        // Try to read from .well-known folder first
        const filePath = path.join(__dirname, '.well-known', 'apple-developer-merchantid-domain-association');
        console.log('🔍 [APPLE PAY] Checking file at:', filePath);
        console.log('🔍 [APPLE PAY] __dirname:', __dirname);
        
        if (fs.existsSync(filePath)) {
            // File exists - serve it
            const fileContent = fs.readFileSync(filePath, 'utf8');
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
            res.send(fileContent);
            console.log('✅ [APPLE PAY] Domain verification file served from .well-known folder');
            console.log('✅ [APPLE PAY] File content length:', fileContent.length);
            return; // Important: return to prevent further processing
        } else if (process.env.APPLE_PAY_DOMAIN_VERIFICATION) {
            // Fallback: serve from environment variable if file doesn't exist
            const envContent = process.env.APPLE_PAY_DOMAIN_VERIFICATION.trim();
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.send(envContent);
            console.log('✅ [APPLE PAY] Domain verification file served from environment variable');
            console.log('✅ [APPLE PAY] Content length:', envContent.length);
            return; // Important: return to prevent further processing
        } else {
            // File not found and no environment variable
            console.error('❌ [APPLE PAY] Domain verification file not found');
            console.error('❌ [APPLE PAY] Expected location:', filePath);
            console.error('❌ [APPLE PAY] File exists:', fs.existsSync(filePath));
            console.error('❌ [APPLE PAY] Env var exists:', !!process.env.APPLE_PAY_DOMAIN_VERIFICATION);
            console.error('❌ [APPLE PAY] Please download the file from Stripe Dashboard and place it at:', filePath);
            console.error('❌ [APPLE PAY] OR set APPLE_PAY_DOMAIN_VERIFICATION environment variable');
            res.status(404).setHeader('Content-Type', 'text/plain').send('Apple Pay domain verification file not found. Please configure the file at .well-known/apple-developer-merchantid-domain-association or set APPLE_PAY_DOMAIN_VERIFICATION environment variable');
            return; // Important: return to prevent further processing
        }
    } catch (error) {
        console.error('❌ [APPLE PAY] Error serving domain verification file:', error);
        console.error('❌ [APPLE PAY] Error stack:', error.stack);
        res.status(500).setHeader('Content-Type', 'text/plain').send('Error serving Apple Pay domain verification file');
        return; // Important: return to prevent further processing
    }
});

// Request timeout middleware for order creation
app.use('/api/orders/create', (req, res, next) => {
    // Set a 25 second timeout for order creation
    req.setTimeout(25000, () => {
        if (!res.headersSent) {
            console.error('⏱️ [TIMEOUT] Order creation request timed out after 25 seconds');
            res.status(504).json({
                success: false,
                error: 'Request timeout - order creation took too long',
                timeout: true
            });
        }
    });
    next();
});

// Middleware
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files (includes robots.txt if present)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve uploaded images

// Robots.txt route (if not in public folder, serve default)
app.get('/robots.txt', (req, res) => {
    const robotsPath = path.join(__dirname, 'public', 'robots.txt');
    if (fs.existsSync(robotsPath)) {
        // Serve from public folder if exists
        res.setHeader('Content-Type', 'text/plain');
        res.sendFile(robotsPath);
    } else {
        // Default robots.txt allowing all crawlers
        res.setHeader('Content-Type', 'text/plain');
        res.send('User-agent: *\nAllow: /\n');
    }
});

// Test endpoint to verify Apple Pay route is accessible
app.get('/api/apple-pay/test-route', (req, res) => {
    res.json({
        success: true,
        message: 'Apple Pay route test endpoint is working',
        route: '/.well-known/apple-developer-merchantid-domain-association',
        note: 'This endpoint confirms the server is running. The actual verification file route should be tested directly.'
    });
});

// Apple Pay domain verification check endpoint
app.get('/api/apple-pay/verify', (req, res) => {
    try {
        const filePath = path.join(__dirname, '.well-known', 'apple-developer-merchantid-domain-association');
        const fileExists = fs.existsSync(filePath);
        const envVarExists = !!process.env.APPLE_PAY_DOMAIN_VERIFICATION;
        
        let fileContent = null;
        let fileSource = null;
        
        if (fileExists) {
            fileContent = fs.readFileSync(filePath, 'utf8').trim();
            fileSource = 'file';
        } else if (envVarExists) {
            fileContent = process.env.APPLE_PAY_DOMAIN_VERIFICATION.trim();
            fileSource = 'environment_variable';
        }
        
        res.json({
            success: fileExists || envVarExists,
            fileExists,
            envVarExists,
            fileSource,
            fileContent: fileContent ? fileContent.substring(0, 50) + '...' : null, // Show first 50 chars
            fileLength: fileContent ? fileContent.length : 0,
            expectedUrls: [
                'https://peakmode.se/.well-known/apple-developer-merchantid-domain-association',
                'https://www.peakmode.se/.well-known/apple-developer-merchantid-domain-association'
            ],
            note: 'Both domains (peakmode.se and www.peakmode.se) must be registered separately in Stripe Dashboard. The same file works for both.',
            message: fileExists || envVarExists 
                ? 'Apple Pay verification file is configured. Ensure BOTH peakmode.se and www.peakmode.se are registered in Stripe Dashboard.' 
                : 'Apple Pay verification file not found. Please add the file or environment variable.'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
    });
});

// API documentation endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Vornify Server API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            health: '/health',
            api: '/api'
        }
    });
});

// Routes
app.use('/api/vornifydb', dbRoutes);
app.use('/api/vornifypay', paymentRoutes); // Legacy payment endpoint
app.use('/api/payments', paymentRoutes); // New Stripe payment endpoints
app.use('/api/storage', storageRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/email-test', emailTestRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/email', emailStatsRoutes); // Email stats and logs
app.use('/api/email/verify', emailVerificationRoutes); // Email verification and testing
app.use('/api/support', supportRoutes); // Support/contact messages
app.use('/api/cart', cartRoutes); // Cart management
app.use('/api/products', productRoutes); // Product management
app.use('/api/shipping', shippingRoutes); // Shipping quotes and methods
app.use('/api/tracking', trackingRoutes); // Package tracking
app.use('/api/customers', customerRoutes); // Customer management and analytics
app.use('/api/reviews', reviewRoutes); // Reviews management and moderation
app.use('/api', currencyRoutes); // Currency conversion and settings

// Documentation routes
app.get('/storage/docs', (req, res) => {
    res.json({
        service: 'Storage API',
        endpoints: {
            upload: 'POST /api/storage/upload',
            download: 'GET /api/storage/download/:id',
            delete: 'DELETE /api/storage/:id'
        }
    });
});

// Error handling middleware
app.use(errorHandler);

// Handle 404 - but exclude Apple Pay verification route (it has its own handler)
app.use((req, res) => {
    // Don't handle 404 for Apple Pay verification route - it has its own handler above
    if (req.path === '/.well-known/apple-developer-merchantid-domain-association') {
        return; // Let the Apple Pay route handle it
    }
    
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