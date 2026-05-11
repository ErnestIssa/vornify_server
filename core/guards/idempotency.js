const crypto = require('crypto');

function getIdempotencyKey(req) {
    const h = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    if (typeof h === 'string' && h.trim() !== '') return h.trim().slice(0, 128);
    return null;
}

function ensureIdempotencyKey(req) {
    const existing = getIdempotencyKey(req);
    const key = existing || crypto.randomUUID();
    req.idempotencyKey = key;
    return key;
}

module.exports = { getIdempotencyKey, ensureIdempotencyKey };

