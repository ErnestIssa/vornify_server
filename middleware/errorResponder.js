const { AppError } = require('../core/errors/AppError');
const { ErrorCodes } = require('../core/errors/codes');
const { logger } = require('../core/logging/logger');

function normalizeError(err) {
    if (err instanceof AppError) return err;
    const msg = err?.message || 'Unhandled error';
    return new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: msg,
        httpStatus: 500,
        severity: 'error',
        userMessage: 'Something went wrong. Please try again later.',
        cause: err
    });
}

function errorResponder(err, req, res, _next) {
    const appErr = normalizeError(err);
    const requestId = req.requestId || req.headers['x-request-id'] || null;

    logger[appErr.severity === 'critical' ? 'critical' : appErr.severity === 'warn' ? 'warn' : 'error'](
        'request_failed',
        {
            requestId,
            code: appErr.code,
            httpStatus: appErr.httpStatus,
            path: req.originalUrl,
            method: req.method,
            message: appErr.message,
            details: appErr.details
        }
    );

    res.status(appErr.httpStatus).json({
        success: false,
        code: appErr.code,
        error: appErr.message,
        userMessage: appErr.userMessage,
        requestId,
        details: process.env.NODE_ENV === 'development' ? appErr.details : undefined
    });
}

module.exports = { errorResponder, normalizeError };

