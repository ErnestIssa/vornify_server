/**
 * Backend Error Utility
 * Provides consistent error responses that work with frontend error handling
 * All errors are structured to be user-friendly and translatable
 */

/**
 * Standard error response structure
 * @param {string} message - User-friendly error message
 * @param {string} code - Error code for frontend error handling
 * @param {number} statusCode - HTTP status code
 * @param {string} details - Technical details (only in development)
 * @returns {object} Formatted error response
 */
function createErrorResponse(message, code, statusCode = 500, details = null) {
    const response = {
        success: false,
        error: message,
        errorCode: code,
        status: statusCode
    };

    // Only include technical details in development
    if (details && process.env.NODE_ENV === 'development') {
        response.details = details;
    }

    return response;
}

/**
 * Error code mappings for frontend error handling
 * These codes match what the frontend errorUtils.ts expects
 */
const ERROR_CODES = {
    // Network errors
    NETWORK_ERROR: 'NETWORK_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',
    CONNECTION_REFUSED: 'CONNECTION_REFUSED',
    
    // Validation errors
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',
    MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
    
    // Authentication errors
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    INVALID_TOKEN: 'INVALID_TOKEN',
    
    // Payment errors
    PAYMENT_FAILED: 'PAYMENT_FAILED',
    PAYMENT_DECLINED: 'PAYMENT_DECLINED',
    INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
    CARD_DECLINED: 'CARD_DECLINED',
    
    // Order errors
    ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
    ORDER_CREATION_FAILED: 'ORDER_CREATION_FAILED',
    INVALID_ORDER: 'INVALID_ORDER',
    
    // Shipping errors
    SHIPPING_UNAVAILABLE: 'SHIPPING_UNAVAILABLE',
    INVALID_ADDRESS: 'INVALID_ADDRESS',
    SHIPPING_ERROR: 'SHIPPING_ERROR',
    
    // Database errors
    DATABASE_ERROR: 'DATABASE_ERROR',
    DATABASE_CONNECTION_FAILED: 'DATABASE_CONNECTION_FAILED',
    
    // Email errors
    EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',
    EMAIL_SERVICE_ERROR: 'EMAIL_SERVICE_ERROR',
    
    // Generic errors
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    BAD_REQUEST: 'BAD_REQUEST'
};

/**
 * User-friendly error messages
 * These messages are designed to be shown directly to users
 */
const ERROR_MESSAGES = {
    // Network errors
    [ERROR_CODES.NETWORK_ERROR]: 'Unable to connect to the server. Please check your internet connection and try again.',
    [ERROR_CODES.TIMEOUT_ERROR]: 'The request took too long. Please try again.',
    [ERROR_CODES.CONNECTION_REFUSED]: 'Unable to reach the server. Please try again later.',
    
    // Validation errors
    [ERROR_CODES.VALIDATION_ERROR]: 'Please check your input and try again.',
    [ERROR_CODES.INVALID_INPUT]: 'Invalid information provided. Please check and try again.',
    [ERROR_CODES.MISSING_REQUIRED_FIELD]: 'Please fill in all required fields.',
    
    // Authentication errors
    [ERROR_CODES.UNAUTHORIZED]: 'You need to be logged in to perform this action.',
    [ERROR_CODES.FORBIDDEN]: 'You do not have permission to perform this action.',
    [ERROR_CODES.INVALID_TOKEN]: 'Your session has expired. Please log in again.',
    
    // Payment errors
    [ERROR_CODES.PAYMENT_FAILED]: 'Payment could not be processed. Please try again or use a different payment method.',
    [ERROR_CODES.PAYMENT_DECLINED]: 'Your payment was declined. Please check your payment details or try a different card.',
    [ERROR_CODES.INSUFFICIENT_FUNDS]: 'Insufficient funds. Please use a different payment method.',
    [ERROR_CODES.CARD_DECLINED]: 'Your card was declined. Please check your card details or try a different card.',
    
    // Order errors
    [ERROR_CODES.ORDER_NOT_FOUND]: 'Order not found. Please check your order number and try again.',
    [ERROR_CODES.ORDER_CREATION_FAILED]: 'Unable to create your order. Please try again or contact support.',
    [ERROR_CODES.INVALID_ORDER]: 'Invalid order information. Please try again.',
    
    // Shipping errors
    [ERROR_CODES.SHIPPING_UNAVAILABLE]: 'Shipping is not available to this address. Please check your address or contact support.',
    [ERROR_CODES.INVALID_ADDRESS]: 'Invalid shipping address. Please check and update your address.',
    [ERROR_CODES.SHIPPING_ERROR]: 'Unable to calculate shipping. Please try again or contact support.',
    
    // Database errors
    [ERROR_CODES.DATABASE_ERROR]: 'A database error occurred. Please try again later.',
    [ERROR_CODES.DATABASE_CONNECTION_FAILED]: 'Unable to connect to the database. Please try again later.',
    
    // Email errors
    [ERROR_CODES.EMAIL_SEND_FAILED]: 'Unable to send email. Please try again later.',
    [ERROR_CODES.EMAIL_SERVICE_ERROR]: 'Email service is temporarily unavailable. Please try again later.',
    
    // Generic errors
    [ERROR_CODES.INTERNAL_SERVER_ERROR]: 'Something went wrong. Please try again later.',
    [ERROR_CODES.NOT_FOUND]: 'The requested resource was not found.',
    [ERROR_CODES.BAD_REQUEST]: 'Invalid request. Please check your input and try again.'
};

/**
 * Convert technical error to user-friendly error response
 * @param {Error} error - Error object
 * @param {string} context - Context where error occurred (e.g., 'checkout', 'payment', 'shipping')
 * @returns {object} Formatted error response
 */
function formatErrorForResponse(error, context = 'general') {
    // Check for specific error types
    if (error.name === 'ValidationError') {
        return createErrorResponse(
            ERROR_MESSAGES[ERROR_CODES.VALIDATION_ERROR],
            ERROR_CODES.VALIDATION_ERROR,
            400,
            error.message
        );
    }

    if (error.name === 'UnauthorizedError' || error.status === 401) {
        return createErrorResponse(
            ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED],
            ERROR_CODES.UNAUTHORIZED,
            401,
            error.message
        );
    }

    if (error.name === 'CastError' || error.name === 'ObjectIdError') {
        return createErrorResponse(
            ERROR_MESSAGES[ERROR_CODES.INVALID_INPUT],
            ERROR_CODES.INVALID_INPUT,
            400,
            error.message
        );
    }

    // Database connection errors
    if (error.name === 'MongoError' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return createErrorResponse(
            ERROR_MESSAGES[ERROR_CODES.DATABASE_CONNECTION_FAILED],
            ERROR_CODES.DATABASE_CONNECTION_FAILED,
            503,
            error.message
        );
    }

    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        return createErrorResponse(
            ERROR_MESSAGES[ERROR_CODES.NETWORK_ERROR],
            ERROR_CODES.NETWORK_ERROR,
            503,
            error.message
        );
    }

    // Payment errors (Stripe)
    if (error.type === 'StripeCardError' || error.type === 'card_error') {
        const code = error.code === 'card_declined' 
            ? ERROR_CODES.CARD_DECLINED 
            : ERROR_CODES.PAYMENT_DECLINED;
        return createErrorResponse(
            ERROR_MESSAGES[code],
            code,
            402,
            error.message
        );
    }

    if (error.type === 'StripeInvalidRequestError') {
        return createErrorResponse(
            ERROR_MESSAGES[ERROR_CODES.PAYMENT_FAILED],
            ERROR_CODES.PAYMENT_FAILED,
            400,
            error.message
        );
    }

    // Default error
    const statusCode = error.statusCode || error.status || 500;
    return createErrorResponse(
        ERROR_MESSAGES[ERROR_CODES.INTERNAL_SERVER_ERROR],
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        statusCode,
        error.message
    );
}

/**
 * Create validation error response
 * @param {string} field - Field name
 * @param {string} message - Validation message
 * @returns {object} Error response
 */
function createValidationError(field, message) {
    return createErrorResponse(
        `${field}: ${message}`,
        ERROR_CODES.VALIDATION_ERROR,
        400,
        `Validation failed for field: ${field}`
    );
}

/**
 * Create not found error response
 * @param {string} resource - Resource name (e.g., 'Order', 'Product')
 * @returns {object} Error response
 */
function createNotFoundError(resource = 'Resource') {
    return createErrorResponse(
        `${resource} not found`,
        ERROR_CODES.NOT_FOUND,
        404,
        `${resource} was not found in the database`
    );
}

/**
 * Create unauthorized error response
 * @param {string} message - Optional custom message
 * @returns {object} Error response
 */
function createUnauthorizedError(message = null) {
    return createErrorResponse(
        message || ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED],
        ERROR_CODES.UNAUTHORIZED,
        401
    );
}

/**
 * Create payment error response
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @returns {object} Error response
 */
function createPaymentError(message, code = ERROR_CODES.PAYMENT_FAILED) {
    return createErrorResponse(
        message || ERROR_MESSAGES[code],
        code,
        402
    );
}

module.exports = {
    createErrorResponse,
    formatErrorForResponse,
    createValidationError,
    createNotFoundError,
    createUnauthorizedError,
    createPaymentError,
    ERROR_CODES,
    ERROR_MESSAGES
};

