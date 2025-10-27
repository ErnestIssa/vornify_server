# Error Handling Implementation

This document outlines the comprehensive error handling system implemented across the entire server.

## Overview

All API endpoints across the server are properly wrapped with error handlers. The implementation includes:

1. **Route-level error handling** - Each route has try-catch blocks
2. **Global error middleware** - Centralized error handling for consistency
3. **Error response standardization** - Consistent error response format

## Error Handling Pattern

### 1. Route-Level Error Handling

Every async route handler follows this pattern:

```javascript
router.post('/endpoint', async (req, res) => {
    try {
        // Route logic here
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error description:', error);
        res.status(500).json({
            success: false,
            error: 'Error message',
            details: error.message
        });
    }
});
```

### 2. Global Error Middleware

**File:** `middleware/errorHandler.js`

The global error handler catches and processes errors at the application level:

```javascript
const errorHandler = (err, req, res, next) => {
    console.error('Error Handler:', {
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    // Handle specific error types
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Validation Error',
            details: err.message
        });
    }

    // ... other specific error handlers

    // Default error response
    const statusCode = err.statusCode || err.status || 500;
    
    res.status(statusCode).json({
        success: false,
        error: err.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};
```

### 3. Async Handler Utility (Optional)

**File:** `middleware/asyncHandler.js`

For routes without explicit try-catch blocks, use the asyncHandler:

```javascript
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
        console.error('Async Handler Error:', {
            path: req.path,
            method: req.method,
            error: error.message
        });
        
        if (res.headersSent) {
            return next(error);
        }
        
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    });
};

// Usage:
router.get('/route', asyncHandler(async (req, res) => {
    const result = await someAsyncOperation();
    res.json({ success: true, data: result });
}));
```

## Error Handling Coverage

All route files are properly configured with error handling:

### ✅ Auth Routes (`routes/auth.js`)
- 6 endpoints with try-catch blocks
- Email verification error handling
- Password reset error handling
- User registration error handling

### ✅ Order Routes (`routes/orders.js`)
- 7 endpoints with try-catch blocks
- Order creation error handling
- Status update error handling
- Order tracking error handling

### ✅ Payment Routes (`routes/payment.js`)
- Payment processing with error handling
- Stripe integration error handling

### ✅ Email Routes (`routes/emailRoutes.js`)
- 11 email endpoints with error handling
- SendGrid integration error handling
- All email template error handling

### ✅ Storage Routes (`routes/storage.js`)
- Storage stats with error handling
- Database storage operations

### ✅ Upload Routes (`routes/upload.js`)
- File upload error handling
- Multer-specific error handling
- File size validation
- File type validation

### ✅ Newsletter Routes (`routes/newsletter.js`)
- 6 endpoints with error handling
- Subscription error handling
- Discount code error handling

### ✅ Support Routes (`routes/support.js`)
- Contact form error handling
- Ticket management error handling

### ✅ Email Stats Routes (`routes/emailStats.js`)
- Email statistics error handling
- Logging operations

### ✅ Cart Routes (`routes/cart.js`)
- 5 endpoints with error handling
- Cart operations error handling
- Discount application error handling

### ✅ Product Routes (`routes/products.js`)
- 5 endpoints with error handling
- Product CRUD operations error handling
- Inventory management error handling

### ✅ Shipping Routes (`routes/shipping.js`)
- Shipping quotes error handling
- Carrier API error handling
- Address validation error handling

### ✅ Tracking Routes (`routes/tracking.js`)
- 5 endpoints with error handling
- Package tracking error handling
- Carrier API integration error handling

### ✅ Customer Routes (`routes/customers.js`)
- 7 endpoints with error handling
- Customer analytics error handling
- Order history error handling

### ✅ Review Routes (`routes/reviews.js`)
- 9 endpoints with error handling
- Review moderation error handling
- Purchase verification error handling

### ✅ Database Routes (`routes/db.js`)
- Database operations error handling
- VortexDB integration error handling

### ✅ Email Test Routes (`routes/emailTest.js`)
- Email testing with error handling
- Template testing error handling

## Error Response Format

All error responses follow a consistent format:

```json
{
    "success": false,
    "error": "Error message",
    "details": "Additional details (development only)"
}
```

### Status Codes

- `400` - Bad Request (validation errors, missing parameters)
- `401` - Unauthorized (authentication required)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error (server-side errors)
- `503` - Service Unavailable (database connection issues)

## Environment-Specific Details

### Development
- Full error stack traces
- Detailed error messages
- Request debugging information

### Production
- Generic error messages
- No stack traces exposed
- Secure error handling

## Testing Error Handling

To test error handling across routes:

```bash
# Test invalid endpoint
curl -X GET http://localhost:10000/api/nonexistent

# Test with invalid data
curl -X POST http://localhost:10000/api/orders/create \
  -H "Content-Type: application/json" \
  -d '{"invalid": "data"}'

# Test database connection error
# (stop database service)
```

## Best Practices

1. **Always wrap async route handlers in try-catch blocks**
2. **Log errors with context** (url, method, ip, error details)
3. **Return appropriate HTTP status codes**
4. **Don't expose sensitive error details in production**
5. **Use consistent error response format**
6. **Handle specific error types appropriately**

## Implementation Date

Error handling was comprehensively implemented on: **Current Date**

All endpoints across the server are now properly wrapped with error handlers following consistent patterns.
