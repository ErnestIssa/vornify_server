const crypto = require('crypto');

function requestIdMiddleware(req, res, next) {
    const incoming = req.headers['x-request-id'];
    const rid = (typeof incoming === 'string' && incoming.trim() !== '')
        ? incoming.trim().slice(0, 128)
        : crypto.randomUUID();

    req.requestId = rid;
    res.setHeader('X-Request-Id', rid);
    next();
}

module.exports = { requestIdMiddleware };

