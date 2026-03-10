/**
 * VAT (MOMS) service – EU country-based rates.
 * Used for display (IP country) and final charge (shipping country).
 * Source: Fortnox / moms-satser.md
 */

const DEFAULT_COUNTRY = 'SE';

/** Country code (ISO 2) → VAT rate (e.g. 0.25 for 25%) */
const COUNTRY_VAT_RATES = {
    LU: 0.17,   // MP13_KUND 17% Luxembourg
    MT: 0.18,   // MP14_KUND 18% Malta
    CY: 0.19,   // MP4_KUND  19% Cyprus
    DE: 0.19,   // MP4_KUND  19% Germany
    AT: 0.20,   // MP6_KUND  20% Austria
    BG: 0.20,   // MP6_KUND  20% Bulgaria
    FR: 0.20,   // MP6_KUND  20% France
    NL: 0.21,   // MP5_KUND  21% Netherlands
    ES: 0.21,   // MP5_KUND  21% Spain
    RO: 0.21,   // MP5_KUND  21% Romania
    LT: 0.21,   // MP5_KUND  21% Lithuania
    LV: 0.21,   // MP5_KUND  21% Latvia
    CZ: 0.21,   // MP5_KUND  21% Czech Republic
    BE: 0.21,   // MP5_KUND  21% Belgium
    IT: 0.22,   // MP7_KUND  22% Italy
    SI: 0.22,   // MP7_KUND  22% Slovenia
    SK: 0.23,   // MP8_KUND  23% Slovakia
    PT: 0.23,   // MP8_KUND  23% Portugal
    PL: 0.23,   // MP8_KUND  23% Poland
    IE: 0.23,   // MP8_KUND  23% Ireland
    GR: 0.24,   // MP9_KUND  24% Greece
    EE: 0.24,   // MP9_KUND  24% Estonia
    HR: 0.25,   // MP10_KUND 25% Croatia
    DK: 0.25,   // MP10_KUND 25% Denmark
    SE: 0.25,   // MP10_KUND 25% Sweden
    FI: 0.255,  // MP11_KUND 25.5% Finland
    HU: 0.27    // MP12_KUND 27% Hungary
};

/**
 * Get VAT rate for a country code.
 * @param {string} countryCode - ISO 2-letter country code (e.g. 'SE', 'DE')
 * @returns {number} VAT rate (e.g. 0.25 for 25%). Default 0.25 (Sweden) if unknown.
 */
function getVatRate(countryCode) {
    if (!countryCode || typeof countryCode !== 'string') return 0.25;
    const key = countryCode.toUpperCase().trim();
    return typeof COUNTRY_VAT_RATES[key] === 'number' ? COUNTRY_VAT_RATES[key] : 0.25;
}

/**
 * Get country code for the current request (for VAT and display).
 * 1. Cloudflare header CF-IPCountry (when traffic goes through Cloudflare).
 * 2. Query param ?country= (e.g. checkout preview by shipping country).
 * 3. Default DEFAULT_COUNTRY (Sweden).
 * @param {object} req - Express request
 * @returns {string} ISO 2-letter country code
 */
function getCountryFromRequest(req) {
    if (!req) return DEFAULT_COUNTRY;
    const fromQuery = (req.query && req.query.country) ? String(req.query.country).toUpperCase().trim() : null;
    if (fromQuery && fromQuery.length === 2) return fromQuery;
    const fromHeader = (req.headers && req.headers['cf-ipcountry']) ? String(req.headers['cf-ipcountry']).toUpperCase().trim() : null;
    if (fromHeader && fromHeader.length === 2 && fromHeader !== 'XX') return fromHeader;
    return DEFAULT_COUNTRY;
}

/**
 * Get VAT rate for the current request (IP or query country).
 * @param {object} req - Express request
 * @returns {{ country: string, vatRate: number }}
 */
function getCountryAndVatFromRequest(req) {
    const country = getCountryFromRequest(req);
    return { country, vatRate: getVatRate(country) };
}

module.exports = {
    getVatRate,
    getCountryFromRequest,
    getCountryAndVatFromRequest,
    DEFAULT_COUNTRY,
    COUNTRY_VAT_RATES
};
