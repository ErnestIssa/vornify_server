function redactValue(key, value) {
    const k = String(key || '').toLowerCase();
    if (
        k.includes('authorization') ||
        k.includes('cookie') ||
        k.includes('token') ||
        k.includes('secret') ||
        k.includes('password') ||
        k.includes('stripe') && k.includes('key')
    ) {
        return '[REDACTED]';
    }
    return value;
}

function redactObject(obj, depth = 3) {
    if (depth <= 0) return '[REDACTED_DEPTH_LIMIT]';
    if (obj == null) return obj;
    if (Array.isArray(obj)) return obj.slice(0, 20).map((v) => redactObject(v, depth - 1));
    if (typeof obj !== 'object') return obj;

    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = redactValue(k, typeof v === 'object' ? redactObject(v, depth - 1) : v);
    }
    return out;
}

module.exports = { redactObject };
