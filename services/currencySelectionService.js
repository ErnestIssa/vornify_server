/**
 * Automatic currency selection for the store based on visitor country.
 * Store base currency is SEK; display currency is SEK, EUR, or USD only.
 *
 * Symbols (do not confuse):
 *   SEK → kr   (Swedish Krona)
 *   EUR → €    (Euro, European Union)
 *   USD → $    (US Dollar)
 *   £ is British Pound – NOT used in this store.
 */

const vatService = require('./vatService');

/** ISO 2-letter codes for EU member states (excluding Sweden, which uses SEK) */
const EU_COUNTRY_CODES = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES'
];

/** Display currencies supported by the store */
const DISPLAY_CURRENCIES = ['SEK', 'EUR', 'USD'];

/** Currency code → symbol. EUR = € (Euro), not £ (Pound). */
const CURRENCY_SYMBOLS = {
    SEK: 'kr',
    EUR: '€',
    USD: '$'
};

/**
 * Get display currency for a country.
 * Sweden → SEK; EU (excluding SE) → EUR; all other → USD.
 * @param {string} countryCode - ISO 2-letter country code
 * @returns {string} 'SEK' | 'EUR' | 'USD'
 */
function getCurrencyForCountry(countryCode) {
    if (!countryCode || typeof countryCode !== 'string') return 'USD';
    const key = countryCode.toUpperCase().trim();
    if (key === 'SE') return 'SEK';
    if (EU_COUNTRY_CODES.includes(key)) return 'EUR';
    return 'USD';
}

/**
 * Get symbol for a currency code.
 * @param {string} currencyCode - 'SEK' | 'EUR' | 'USD'
 * @returns {string} 'kr' | '€' | '$'
 */
function getCurrencySymbol(currencyCode) {
    if (!currencyCode) return '$';
    const key = (currencyCode + '').toUpperCase().trim();
    return CURRENCY_SYMBOLS[key] || '$';
}

/**
 * Resolve display currency for the current request.
 * 1. Query param ?currency= (user override: SEK, EUR, or USD).
 * 2. Otherwise from detected country (CF-IPCountry or ?country=).
 * @param {object} req - Express request
 * @returns {{ currency: string, currencySymbol: string, country: string }}
 */
function getDisplayCurrencyFromRequest(req) {
    const fromQuery = req && req.query && req.query.currency;
    const currencyParam = fromQuery ? String(fromQuery).toUpperCase().trim() : null;
    if (currencyParam && DISPLAY_CURRENCIES.includes(currencyParam)) {
        return {
            currency: currencyParam,
            currencySymbol: getCurrencySymbol(currencyParam),
            country: vatService.getCountryFromRequest(req)
        };
    }
    const country = vatService.getCountryFromRequest(req);
    const currency = getCurrencyForCountry(country);
    return {
        currency,
        currencySymbol: getCurrencySymbol(currency),
        country
    };
}

module.exports = {
    getCurrencyForCountry,
    getCurrencySymbol,
    getDisplayCurrencyFromRequest,
    DISPLAY_CURRENCIES,
    CURRENCY_SYMBOLS,
    STORE_BASE_CURRENCY: 'SEK'
};
