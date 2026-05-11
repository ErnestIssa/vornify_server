class AppError extends Error {
    /**
     * @param {object} opts
     * @param {string} opts.code Stable error code for clients/logs.
     * @param {string} opts.message Internal/dev message.
     * @param {number} [opts.httpStatus=500]
     * @param {'debug'|'info'|'warn'|'error'|'critical'} [opts.severity='error']
     * @param {boolean} [opts.isRetryable=false]
     * @param {string} [opts.userMessage] Safe user-facing message.
     * @param {object} [opts.details] Extra structured context (non-sensitive).
     * @param {Error} [opts.cause]
     */
    constructor(opts) {
        const msg = opts && typeof opts.message === 'string' ? opts.message : 'AppError';
        super(msg);
        this.name = 'AppError';
        this.code = opts?.code || 'INTERNAL_ERROR';
        this.httpStatus = Number.isFinite(opts?.httpStatus) ? opts.httpStatus : 500;
        this.severity = opts?.severity || 'error';
        this.isRetryable = opts?.isRetryable === true;
        this.userMessage = opts?.userMessage || 'Something went wrong. Please try again.';
        this.details = opts?.details || undefined;
        if (opts?.cause) this.cause = opts.cause;
    }
}

module.exports = { AppError };
