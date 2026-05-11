function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(err) {
    const msg = (err?.message || '').toLowerCase();
    return (
        msg.includes('timeout') ||
        msg.includes('topology is closed') ||
        msg.includes('not connected') ||
        msg.includes('connection') && msg.includes('closed') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout')
    );
}

/**
 * Retry wrapper (exponential backoff + jitter). Only retries when predicate returns true.
 */
async function withRetry(fn, opts = {}) {
    const retries = Number.isFinite(opts.retries) ? opts.retries : 2;
    const baseDelayMs = Number.isFinite(opts.baseDelayMs) ? opts.baseDelayMs : 250;
    const maxDelayMs = Number.isFinite(opts.maxDelayMs) ? opts.maxDelayMs : 1500;
    const shouldRetry = typeof opts.shouldRetry === 'function'
        ? opts.shouldRetry
        : (err) => isTransientError(err);

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            return await fn(attempt);
        } catch (err) {
            if (attempt >= retries || !shouldRetry(err)) throw err;
            const jitter = 0.75 + Math.random() * 0.5;
            const delay = Math.min(maxDelayMs, Math.round(baseDelayMs * Math.pow(2, attempt) * jitter));
            await sleep(delay);
            attempt += 1;
        }
    }
}

module.exports = { withRetry };

