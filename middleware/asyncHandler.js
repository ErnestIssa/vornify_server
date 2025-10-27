/**
 * Async Handler Middleware
 * Wraps async route handlers to automatically catch errors
 * This ensures all async operations have proper error handling
 */

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
        console.error('Async Handler Error:', {
            path: req.path,
            method: req.method,
            error: error.message,
            stack: error.stack
        });
        
        // Don't send response if headers already sent
        if (res.headersSent) {
            return next(error);
        }
        
        // Send appropriate error response
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    });
};

module.exports = asyncHandler;
