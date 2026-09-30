/**
 * Legacy /api/email/* routes must not be public send proxies in production.
 */
function emailRouteGuard(req, res, next) {
  if (process.env.EMAIL_ROUTES_PUBLIC === 'true') {
    return next();
  }

  const expected = process.env.EMAIL_INTERNAL_API_KEY;
  if (!expected || !String(expected).trim()) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        success: false,
        error: 'Email proxy routes are disabled. Use domain APIs (auth, orders, support).',
      });
    }
    return next();
  }

  const provided =
    req.headers['x-email-internal-key'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

  if (provided && provided === expected) {
    return next();
  }

  return res.status(403).json({ success: false, error: 'Forbidden' });
}

module.exports = emailRouteGuard;
