/**
 * Absolute Shop URLs for auth emails (verify, password reset).
 * Uses STOREFRONT_URL | FRONTEND_URL | PUBLIC_STORE_URL — trimmed, no trailing slash.
 */

function trimSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function getStorefrontOrigin(fallbackOrigin) {
    const fromEnv =
        process.env.STOREFRONT_URL ||
        process.env.FRONTEND_URL ||
        process.env.PUBLIC_STORE_URL ||
        '';
    let base = trimSlash(String(fromEnv).trim());
    if (!base && fallbackOrigin) {
        base = trimSlash(String(fallbackOrigin).trim());
    }
    if (!base) {
        base = 'https://peakmode.se';
    }
    if (!/^https?:\/\//i.test(base)) {
        base = `https://${base.replace(/^\/+/, '')}`;
    }
    return base;
}

/**
 * @param {{ token: string, email: string, fallbackOrigin?: string }} params
 */
function buildPasswordResetLink({ token, email, fallbackOrigin }) {
    const origin = getStorefrontOrigin(fallbackOrigin);
    const safeToken = encodeURIComponent(String(token || '').trim());
    const safeEmail = encodeURIComponent(String(email || '').trim());
    return `${origin}/reset-password?token=${safeToken}&email=${safeEmail}`;
}

function normalizeAuthLink(rawLink, fallbackOrigin) {
    const trimmed = String(rawLink || '').trim();
    if (!trimmed) {
        return getStorefrontOrigin(fallbackOrigin);
    }
    if (!/^https?:\/\//i.test(trimmed)) {
        const origin = getStorefrontOrigin(fallbackOrigin);
        const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
        return `${origin}${path}`;
    }
    return trimmed;
}

module.exports = {
    getStorefrontOrigin,
    buildPasswordResetLink,
    normalizeAuthLink,
};
