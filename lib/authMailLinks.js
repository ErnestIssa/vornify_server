/**
 * Absolute Shop URLs for auth emails (verify, password reset).
 * Uses STOREFRONT_URL | FRONTEND_URL | PUBLIC_STORE_URL — trimmed, no trailing slash.
 */

function trimSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

/** Backend/API hosts must never be used in customer email links (SPA 404). */
function looksLikeNonStorefrontOrigin(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return true;
    if (s.includes('peakmode-admin') || s.includes('admin.peakmode')) return true;
    if (/onrender\.com|render\.com/.test(s) && !/peakmode\.se/.test(s)) return true;
    if (/vornify|peakmode-api|\/api\b|backend\./.test(s)) return true;
    return false;
}

function normalizeOriginBase(raw) {
    let base = trimSlash(String(raw || '').trim());
    if (!base) return '';
    if (!/^https?:\/\//i.test(base)) {
        base = `https://${base.replace(/^\/+/, '')}`;
    }
    return trimSlash(base);
}

function getStorefrontOrigin(fallbackOrigin) {
    const envCandidates = [
        process.env.STOREFRONT_URL,
        process.env.PUBLIC_STORE_URL,
        process.env.SHOP_URL,
        process.env.FRONTEND_URL,
    ];

    for (const candidate of envCandidates) {
        const base = normalizeOriginBase(candidate);
        if (base && !looksLikeNonStorefrontOrigin(base)) {
            return base;
        }
    }

    const fromRequest = normalizeOriginBase(fallbackOrigin);
    if (fromRequest && !looksLikeNonStorefrontOrigin(fromRequest)) {
        return fromRequest;
    }

    return 'https://peakmode.se';
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
