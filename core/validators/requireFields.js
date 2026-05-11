const { AppError } = require('../errors/AppError');
const { ErrorCodes } = require('../errors/codes');

function requireFields(obj, fields, opts = {}) {
    const missing = [];
    for (const f of fields) {
        const v = obj?.[f];
        if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
            missing.push(f);
        }
    }
    if (missing.length > 0) {
        throw new AppError({
            code: ErrorCodes.VALIDATION_FAILED,
            httpStatus: 400,
            severity: 'warn',
            message: 'Missing required fields',
            userMessage: opts.userMessage || 'Please fill in all required fields and try again.',
            details: { missing }
        });
    }
}

module.exports = { requireFields };

