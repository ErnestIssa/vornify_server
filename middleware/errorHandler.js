/**
 * Enhanced Error Handler Middleware
 * Provides consistent error responses across the application
 * All errors are formatted to work with frontend error handling system
 */

const { formatErrorForResponse } = require('../utils/errorUtils');

const errorHandler = (err, req, res, next) => {
    // Determine context from request path
    const context = req.path.includes('/payment') ? 'payment' :
                   req.path.includes('/shipping') ? 'shipping' :
                   req.path.includes('/order') ? 'order' :
                   req.path.includes('/checkout') ? 'checkout' : 'general';

    console.error('Error Handler:', {
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        context: context,
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    // Don't send response if headers already sent
    if (res.headersSent) {
        return next(err);
    }

    // Format error for response (user-friendly with error codes)
    const errorResponse = formatErrorForResponse(err, context);
    
    res.status(errorResponse.status).json(errorResponse);
};

module.exports = errorHandler;
