const { redactObject } = require('./redact');

function log(level, message, ctx) {
    const entry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...(ctx ? redactObject(ctx) : {})
    };
    const line = JSON.stringify(entry);
    // Render captures stdout/stderr; keep levels mapped.
    if (level === 'error' || level === 'critical') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

const logger = {
    // Never emit debug JSON lines in production (avoids noise / accidental detail leaks).
    debug: (msg, ctx) => {
        if (process.env.NODE_ENV === 'production') return;
        log('debug', msg, ctx);
    },
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    critical: (msg, ctx) => log('critical', msg, ctx)
};

module.exports = { logger };
