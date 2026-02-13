const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const dbRoutes = require('./routes/db');
const paymentRoutes = require('./routes/payment');
const storageRoutes = require('./routes/storage');
const emailRoutes = require('./routes/emailRoutes');
const uploadRoutes = require('./routes/upload');
const cloudinaryUploadRoutes = require('./routes/uploadRoutes');
const ordersRoutes = require('./routes/orders');
const emailTestRoutes = require('./routes/emailTest');
const newsletterRoutes = require('./routes/newsletter');
const subscriberRoutes = require('./routes/subscribers');
const waitlistRoutes = require('./routes/waitlist');
const authRoutes = require('./routes/auth');
const emailStatsRoutes = require('./routes/emailStats');
const emailVerificationRoutes = require('./routes/emailVerification');
const emailDiagnosticsRoutes = require('./routes/emailDiagnostics');
const abandonedCartRoutes = require('./routes/abandonedCart');
const paymentFailureRoutes = require('./routes/paymentFailure');
const supportRoutes = require('./routes/support');
const cartRoutes = require('./routes/cart');
const checkoutRoutes = require('./routes/checkout');
const productRoutes = require('./routes/products');
const shippingRoutes = require('./routes/shipping');
const trackingRoutes = require('./routes/tracking');
const customerRoutes = require('./routes/customers');
const reviewRoutes = require('./routes/reviews');
const currencyRoutes = require('./routes/currency');
const adminRoutes = require('./routes/admin');
const adminAuthRoutes = require('./routes/adminAuth');
const adminContentRoutes = require('./routes/adminContent');
const metaFeedRoutes = require('./routes/metaFeed');
const errorHandler = require('./middleware/errorHandler');
const abandonedCartService = require('./services/abandonedCartService');
const abandonedCheckoutService = require('./services/abandonedCheckoutService');
const paymentFailureService = require('./services/paymentFailureService');
require('dotenv').config();

// Cloudinary configuration check (temporary sanity check)
const cloudinary = require('./config/cloudinary');
console.log('Cloudinary configured:', cloudinary.config().cloud_name);

const app = express();
const port = process.env.PORT || 10000;

// Track timers so we can stop them on graceful shutdown (important for Render deploys)
const activeTimeouts = [];
const activeIntervals = [];
function trackTimeout(handle) {
    activeTimeouts.push(handle);
    return handle;
}
function trackInterval(handle) {
    activeIntervals.push(handle);
    return handle;
}

let server = null;

async function gracefulShutdown(signal) {
    try {
        console.log(`🛑 [SHUTDOWN] Received ${signal}. Closing server and background jobs...`);

        // Stop scheduled jobs first (prevents new work during shutdown)
        for (const t of activeTimeouts) clearTimeout(t);
        for (const i of activeIntervals) clearInterval(i);

        // Stop accepting new connections
        if (server) {
            await new Promise(resolve => server.close(resolve));
            console.log('✅ [SHUTDOWN] HTTP server closed');
        }

        // Close MongoDB pool (singleton)
        try {
            const getDBInstance = require('./vornifydb/dbInstance');
            const dbInstance = getDBInstance();
            if (dbInstance && typeof dbInstance.close === 'function') {
                await dbInstance.close();
                console.log('✅ [SHUTDOWN] MongoDB client closed');
            }
        } catch (dbCloseErr) {
            console.warn('⚠️ [SHUTDOWN] Failed to close MongoDB client:', dbCloseErr.message);
        }

        process.exit(0);
    } catch (err) {
        console.error('❌ [SHUTDOWN] Error during shutdown:', err);
        process.exit(1);
    }
}

// Render sends SIGTERM on deploy; handle it so old instances exit fast.
process.on('SIGTERM', () => {
    // Force exit if something hangs
    setTimeout(() => process.exit(1), 10000).unref();
    gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
    setTimeout(() => process.exit(1), 10000).unref();
    gracefulShutdown('SIGINT');
});

// Cookie parser (required for httpOnly cookies)
app.use(cookieParser());

// Security Headers Middleware (Defense in Depth)
app.use((req, res, next) => {
    // Content Security Policy - Prevents XSS
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;"
    );
    
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Prevent MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Privacy protection
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Force HTTPS in production
    if (process.env.NODE_ENV === 'production') {
        res.setHeader(
            'Strict-Transport-Security',
            'max-age=31536000; includeSubDomains; preload'
        );
    }
    
    // Prevent XSS (legacy browsers)
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    next();
});

// CORS configuration for production
app.use(cors({
    origin: '*', // Allow all origins (general routes)
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true,
    maxAge: 86400 // 24 hours
}));

// CORS configuration for admin routes (restricted to admin domain)
const adminCors = cors({
    origin: process.env.ADMIN_FRONTEND_URL || 'https://admin.peakmode.se',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true, // Required for httpOnly cookies
    maxAge: 86400
});

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

// Meta Commerce Manager product feed (public CSV)
// Accessible at: /meta-feed.csv
app.use('/', metaFeedRoutes);

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
app.use('/api/uploads', cloudinaryUploadRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/email-test', emailTestRoutes); // Email testing endpoints
app.use('/api/newsletter', newsletterRoutes); // Legacy newsletter endpoints (now uses new 'subscribers' collection)
app.use('/api/subscribers', subscriberRoutes); // New unified subscriber system
app.use('/api/waitlist', waitlistRoutes); // Waitlist system
app.use('/api/auth', authRoutes);
app.use('/api/email', emailStatsRoutes); // Email stats and logs
app.use('/api/email/verify', emailVerificationRoutes); // Email verification and testing
app.use('/api/email', emailDiagnosticsRoutes); // Email diagnostics
app.use('/api/abandoned-cart', abandonedCartRoutes); // Abandoned cart processing
app.use('/api/payment-failure', paymentFailureRoutes); // Payment failure email processing
app.use('/api/support', supportRoutes); // Support/contact messages
app.use('/api/cart', cartRoutes); // Cart management
app.use('/api/checkout', checkoutRoutes); // Checkout email capture
app.use('/api/products', productRoutes); // Product management
app.use('/api/shipping', shippingRoutes); // Shipping quotes and methods
app.use('/api/tracking', trackingRoutes); // Package tracking
app.use('/api/customers', customerRoutes); // Customer management and analytics
app.use('/api/reviews', reviewRoutes); // Reviews management and moderation
app.use('/api', currencyRoutes); // Currency conversion and settings
app.use('/api/admin/auth', adminCors, adminAuthRoutes); // Admin authentication (login, verify, logout)
app.use('/api/admin', adminCors, adminContentRoutes); // Admin content management (public read, protected write)
app.use('/api/admin', adminCors, adminRoutes); // Admin utilities (cleanup, maintenance)

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
    server = app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
        
        // Start abandoned cart processing (runs every 10 minutes)
        if (process.env.ENABLE_ABANDONED_CART !== 'false') {
            console.log('🛒 [ABANDONED CART] Service enabled - checking every 10 minutes');
            
            // Run immediately on startup (after 1 minute delay to let server stabilize)
            trackTimeout(setTimeout(() => {
                abandonedCartService.processAbandonedCarts().catch(err => {
                    console.error('❌ [ABANDONED CART] Initial processing error:', err);
                });
            }, 60000)); // 1 minute delay
            
            // Then run every 5 minutes (to catch carts abandoned 10 minutes ago)
            trackInterval(setInterval(() => {
                abandonedCartService.processAbandonedCarts().catch(err => {
                    console.error('❌ [ABANDONED CART] Scheduled processing error:', err);
                });
            }, 5 * 60 * 1000)); // 5 minutes (check twice per 10-minute window)
        } else {
            console.log('🛒 [ABANDONED CART] Service disabled (ENABLE_ABANDONED_CART=false)');
        }
        
        // Process pending payment failure emails (runs every minute)
        if (process.env.ENABLE_PAYMENT_FAILURE_EMAIL !== 'false') {
            console.log('💳 [PAYMENT FAILURE] Service enabled - checking every 1 minute');
            console.log('💳 [PAYMENT FAILURE] Email delay: 3 minutes after payment failure');
            
            // Run immediately on startup (after 1 minute delay to let server stabilize)
            trackTimeout(setTimeout(() => {
                paymentFailureService.processPendingPaymentFailures().catch(err => {
                    console.error('❌ [PAYMENT FAILURE] Initial processing error:', err);
                });
            }, 60000)); // 1 minute delay
            
            // Then run every 1 minute (to catch 3-minute windows accurately)
            trackInterval(setInterval(() => {
                paymentFailureService.processPendingPaymentFailures().catch(err => {
                    console.error('❌ [PAYMENT FAILURE] Scheduled processing error:', err);
                });
            }, 60 * 1000)); // 1 minute
        } else {
            console.log('💳 [PAYMENT FAILURE] Service disabled (ENABLE_PAYMENT_FAILURE_EMAIL=false)');
        }

        // Start abandoned checkout processing (runs every 5 minutes to catch 10-minute windows)
        if (process.env.ENABLE_ABANDONED_CHECKOUT !== 'false') {
            console.log('🛒 [ABANDONED CHECKOUT] Service enabled - checking every 5 minutes');
            console.log('🛒 [ABANDONED CHECKOUT] First email: 10 minutes after abandonment');
            console.log('🛒 [ABANDONED CHECKOUT] Second email: 20 minutes after abandonment (10 minutes after first)');
            
            // Run immediately on startup (after 2 minute delay to let server stabilize)
            trackTimeout(setTimeout(() => {
                abandonedCheckoutService.processAbandonedCheckouts().catch(err => {
                    console.error('❌ [ABANDONED CHECKOUT] Initial processing error:', err);
                });
            }, 120000)); // 2 minute delay
            
            // Then run every 5 minutes (to catch 10-minute windows accurately)
            trackInterval(setInterval(() => {
                abandonedCheckoutService.processAbandonedCheckouts().catch(err => {
                    console.error('❌ [ABANDONED CHECKOUT] Scheduled processing error:', err);
                });
            }, 5 * 60 * 1000)); // 5 minutes (checks twice per 10-minute window)
        } else {
            console.log('🛒 [ABANDONED CHECKOUT] Service disabled (ENABLE_ABANDONED_CHECKOUT=false)');
        }

        // Start discount reminder processing (runs once per day)
        if (process.env.ENABLE_DISCOUNT_REMINDER !== 'false') {
            const discountReminderService = require('./services/discountReminderService');
            console.log('📧 [DISCOUNT REMINDER] Service enabled - checking once per day');
            console.log('📧 [DISCOUNT REMINDER] Sends reminder 7 days after code creation (if unused)');
            
            // Run immediately on startup (after 3 minute delay to let server stabilize)
            trackTimeout(setTimeout(() => {
                discountReminderService.processDiscountReminders().catch(err => {
                    console.error('❌ [DISCOUNT REMINDER] Initial processing error:', err);
                });
            }, 180000)); // 3 minute delay
            
            // Then run once per day (24 hours)
            trackInterval(setInterval(() => {
                discountReminderService.processDiscountReminders().catch(err => {
                    console.error('❌ [DISCOUNT REMINDER] Scheduled processing error:', err);
                });
            }, 24 * 60 * 60 * 1000)); // 24 hours (once per day)
        } else {
            console.log('📧 [DISCOUNT REMINDER] Service disabled (ENABLE_DISCOUNT_REMINDER=false)');
        }
        
        // DISABLED: Weekly product views reset was destroying trending system
        // The weekly reset hard-reset viewsLast7Days to 0 every Monday, which made
        // the "Top Viewed" section meaningless right after reset.
        // 
        // PROPER FIX REQUIRED: Store view timestamps and compute viewsLast7Days
        // dynamically by counting only views within last 7 days (true rolling window).
        // 
        // For now, the reset is disabled to prevent data destruction.
        console.log('📊 [WEEKLY VIEWS RESET] Service DISABLED - weekly reset was destroying trending data');
        console.log('📊 [WEEKLY VIEWS RESET] PROPER FIX NEEDED: Implement true 7-day rolling window with timestamps');
    });
}

module.exports = app; // For testing purposes 