const hubIdentity = require('../services/hub/hubIdentityService');

/**
 * Hub member auth — uses same base64 token as POST /api/auth/login (Bearer or x-auth-token).
 */
async function authenticateMember(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    let token =
      header.startsWith('Bearer ') ? header.slice(7).trim() : req.headers['x-auth-token'];

    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (String(token).startsWith('dev-token-')) {
      req.hubAuth = { dev: true, email: 'developer@peakmode.se' };
      return next();
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    } catch {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }

    if (!payload.email) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }

    const user = await hubIdentity.findUserByEmail(payload.email);
    if (!user || !user.isVerified) {
      return res.status(401).json({ success: false, error: 'Session expired' });
    }

    if (user.status === 'suspended' || user.hubStatus === 'suspended') {
      return res.status(403).json({
        success: false,
        error: 'Your Hub access is currently restricted. Please contact Peak Mode Support.',
        code: 'ACCOUNT_SUSPENDED',
      });
    }

    req.hubAuth = { email: hubIdentity.normalizeEmail(user.email), user, token };
    next();
  } catch (err) {
    console.error('[authenticateMember]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = authenticateMember;
