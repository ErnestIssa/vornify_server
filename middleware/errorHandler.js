/**
 * Enhanced Error Handler Middleware
 * Provides consistent error responses across the application
 */

const errorHandler = (err, req, res, next) => {
    console.error('Error Handler:', {
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    // Don't send response if headers already sent
    if (res.headersSent) {
        return next(err);
    }

    // Handle specific error types
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Validation Error',
            details: err.message
        });
    }

    if (err.name === 'UnauthorizedError' || err.status === 401) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized'
        });
    }

    if (err.name === 'CastError' || err.name === 'ObjectIdError') {
        return res.status(400).json({
            success: false,
            error: 'Invalid ID format'
        });
    }

    // Database connection errors
    if (err.name === 'MongoError' || err.code === 'ECONNREFUSED') {
        return res.status(503).json({
            success: false,
            error: 'Database connection failed',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }

    // Default error response
    const statusCode = err.statusCode || err.status || 500;
    
    res.status(statusCode).json({
        success: false,
        error: err.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

module.exports = errorHandler;
