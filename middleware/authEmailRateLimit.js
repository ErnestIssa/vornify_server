const rateLimit = require('express-rate-limit');

function emailFromBody(req) {
  const email = req.body?.email;
  if (email && typeof email === 'string') return email.trim().toLowerCase();
  return req.ip;
}

const authEmailRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailFromBody,
  message: { success: false, error: 'Too many requests. Please try again later.' },
});

module.exports = { authEmailRateLimit };
