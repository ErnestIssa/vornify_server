const getDBInstance = require('../vornifydb/dbInstance');
const fetch = require('node-fetch');
const { parseString } = require('xml2js');
const { promisify } = require('util');
require('dotenv').config();

const parseXML = promisify(parseString);
const db = getDBInstance();

// Base currency (EUR)
const BASE_CURRENCY = 'EUR';

// Supported EU currencies with symbols
const SUPPORTED_CURRENCIES = {
    EUR: { symbol: '€', name: 'Euro', rate: 1.0 },
    SEK: { symbol: 'kr', name: 'Swedish Krona', rate: 11.2345 },
    DKK: { symbol: 'kr', name: 'Danish Krone', rate: 7.4567 },
    PLN: { symbol: 'zł', name: 'Polish Zloty', rate: 4.3456 },
    CZK: { symbol: 'Kč', name: 'Czech Koruna', rate: 24.5678 },
    HUF: { symbol: 'Ft', name: 'Hungarian Forint', rate: 390.1234 },
    BGN: { symbol: 'лв', name: 'Bulgarian Lev', rate: 1.9567 },
    RON: { symbol: 'lei', name: 'Romanian Leu', rate: 4.9876 }
};

// Cache duration: 24 hours
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Get exchange rate from database or return default
 */
async function getExchangeRate(fromCurrency, toCurrency) {
    try {
        // Same currency = 1.0
        if (fromCurrency === toCurrency) {
            return 1.0;
        }

        // If converting from base currency, get rate directly
        if (fromCurrency === BASE_CURRENCY) {
            const rate = await getRateFromDB(toCurrency);
            return rate || SUPPORTED_CURRENCIES[toCurrency]?.rate || 1.0;
        }

        // If converting to base currency, get inverse rate
        if (toCurrency === BASE_CURRENCY) {
            const rate = await getRateFromDB(fromCurrency);
            return rate ? 1 / rate : (1 / (SUPPORTED_CURRENCIES[fromCurrency]?.rate || 1.0));
        }

        // Converting between two non-base currencies
        // Convert from -> base -> to
        const fromRate = await getRateFromDB(fromCurrency);
        const toRate = await getRateFromDB(toCurrency);
        
        if (fromRate && toRate) {
            return toRate / fromRate;
        }

        // Fallback to default rates
        const fromDefault = SUPPORTED_CURRENCIES[fromCurrency]?.rate || 1.0;
        const toDefault = SUPPORTED_CURRENCIES[toCurrency]?.rate || 1.0;
        return toDefault / fromDefault;

    } catch (error) {
        console.error('Error getting exchange rate:', error);
        // Fallback to default rates
        const fromDefault = SUPPORTED_CURRENCIES[fromCurrency]?.rate || 1.0;
        const toDefault = SUPPORTED_CURRENCIES[toCurrency]?.rate || 1.0;
        return toDefault / fromDefault;
    }
}

/**
 * Get exchange rate from database
 * Uses last stored rate even if expired (fallback behavior)
 */
async function getRateFromDB(currency) {
    try {
        if (currency === BASE_CURRENCY) {
            return 1.0;
        }

        const result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'exchange_rates',
            command: '--read',
            data: { currency, baseCurrency: BASE_CURRENCY }
        });

        if (result.success && result.data) {
            const rateData = Array.isArray(result.data) ? result.data[0] : result.data;
            
            if (rateData.rate) {
                const rate = parseFloat(rateData.rate);
                if (!isNaN(rate)) {
                    // Check if rate is still valid (not expired)
                    const lastUpdated = new Date(rateData.lastUpdated || rateData.updatedAt || 0);
                    const age = Date.now() - lastUpdated.getTime();
                    
                    if (age < CACHE_DURATION_MS) {
                        // Rate is fresh
                        return rate;
                    } else {
                        // Rate is expired but use it as fallback
                        console.warn(`⚠️ Rate for ${currency} is expired (${Math.round(age / (60 * 60 * 1000))}h old), using as fallback`);
                        return rate;
                    }
                }
            }
        }

        // Return default rate if not in DB
        console.warn(`⚠️ Rate for ${currency} not found in DB, using default rate`);
        return SUPPORTED_CURRENCIES[currency]?.rate || null;

    } catch (error) {
        console.error(`Error fetching rate for ${currency}:`, error);
        // Fallback to default rate
        return SUPPORTED_CURRENCIES[currency]?.rate || null;
    }
}

/**
 * Convert amount from one currency to another
 */
async function convertCurrency(amount, fromCurrency, toCurrency) {
    try {
        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum < 0) {
            throw new Error('Invalid amount');
        }

        if (!SUPPORTED_CURRENCIES[fromCurrency]) {
            console.warn(`Unsupported source currency: ${fromCurrency}, defaulting to ${BASE_CURRENCY}`);
            fromCurrency = BASE_CURRENCY;
        }

        if (!SUPPORTED_CURRENCIES[toCurrency]) {
            console.warn(`Unsupported target currency: ${toCurrency}, defaulting to ${BASE_CURRENCY}`);
            toCurrency = BASE_CURRENCY;
        }

        const rate = await getExchangeRate(fromCurrency, toCurrency);
        const convertedAmount = amountNum * rate;

        return {
            success: true,
            amount: amountNum,
            from: fromCurrency,
            to: toCurrency,
            convertedAmount: Math.round(convertedAmount * 100) / 100, // Round to 2 decimals
            rate: Math.round(rate * 10000) / 10000, // Round to 4 decimals
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('Currency conversion error:', error);
        // Fallback: return original amount in base currency
        return {
            success: false,
            amount: parseFloat(amount) || 0,
            from: fromCurrency,
            to: toCurrency || BASE_CURRENCY,
            convertedAmount: parseFloat(amount) || 0,
            rate: 1.0,
            timestamp: new Date().toISOString(),
            error: 'Conversion failed, using base currency'
        };
    }
}

/**
 * Get all supported currencies with current rates
 */
async function getSupportedCurrencies() {
    try {
        const currencies = [];
        const now = new Date().toISOString();

        for (const [code, info] of Object.entries(SUPPORTED_CURRENCIES)) {
            const rate = await getRateFromDB(code);
            currencies.push({
                code,
                symbol: info.symbol,
                name: info.name,
                rate: rate || info.rate
            });
        }

        return {
            success: true,
            currencies,
            baseCurrency: BASE_CURRENCY,
            lastUpdated: now
        };

    } catch (error) {
        console.error('Error getting supported currencies:', error);
        // Return default currencies
        return {
            success: true,
            currencies: Object.entries(SUPPORTED_CURRENCIES).map(([code, info]) => ({
                code,
                symbol: info.symbol,
                name: info.name,
                rate: info.rate
            })),
            baseCurrency: BASE_CURRENCY,
            lastUpdated: new Date().toISOString()
        };
    }
}

/**
 * Fetch exchange rates from ECB (European Central Bank)
 * ECB provides free daily rates, no API key needed
 */
async function fetchECBRates() {
    try {
        const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
        
        console.log('📡 Fetching exchange rates from ECB...');
        const response = await fetch(ECB_URL);
        
        if (!response.ok) {
            throw new Error(`ECB API returned status ${response.status}`);
        }
        
        const xmlData = await response.text();
        const parsed = await parseXML(xmlData);
        
        // Parse ECB XML structure
        const cube = parsed['gesmes:Envelope']?.Cube?.[0]?.Cube?.[0]?.Cube || [];
        const rates = {};
        
        // ECB rates are against EUR (base currency)
        rates['EUR'] = 1.0; // EUR is always 1.0
        
        cube.forEach(cubeItem => {
            const currency = cubeItem.$.currency;
            const rate = parseFloat(cubeItem.$.rate);
            if (currency && !isNaN(rate)) {
                rates[currency] = rate;
            }
        });
        
        console.log(`✅ Fetched ${Object.keys(rates).length} exchange rates from ECB`);
        return rates;

    } catch (error) {
        console.error('❌ Error fetching ECB rates:', error);
        throw error;
    }
}

/**
 * Update exchange rates (to be called by scheduled job or admin)
 * Fetches from ECB and stores in database
 */
async function updateExchangeRates() {
    try {
        let ecbRates = {};
        let fetchSuccess = false;
        
        // Try to fetch from ECB
        try {
            ecbRates = await fetchECBRates();
            fetchSuccess = true;
        } catch (ecbError) {
            console.warn('⚠️ Failed to fetch from ECB, using last stored rates or defaults:', ecbError.message);
        }
        
        const ratesToUpdate = [];
        const now = new Date().toISOString();

        for (const [currency, info] of Object.entries(SUPPORTED_CURRENCIES)) {
            if (currency === BASE_CURRENCY) {
                // EUR is always 1.0
                continue;
            }

            // Get rate from ECB if available, otherwise use default
            let rate = info.rate; // Default fallback
            if (fetchSuccess && ecbRates[currency]) {
                rate = ecbRates[currency];
            } else {
                console.warn(`⚠️ Rate for ${currency} not found in ECB data, using default: ${rate}`);
            }

            // Check if rate exists in database
            const existing = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'exchange_rates',
                command: '--read',
                data: { currency, baseCurrency: BASE_CURRENCY }
            });

            const rateData = {
                currency,
                baseCurrency: BASE_CURRENCY,
                rate: rate,
                lastUpdated: now,
                updatedAt: now,
                source: fetchSuccess ? 'ECB' : 'default'
            };

            if (existing.success && existing.data) {
                // Update existing rate
                const existingData = Array.isArray(existing.data) ? existing.data[0] : existing.data;
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'exchange_rates',
                    command: '--update',
                    data: {
                        filter: { currency, baseCurrency: BASE_CURRENCY },
                        update: rateData
                    }
                });
            } else {
                // Create new rate
                await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'exchange_rates',
                    command: '--create',
                    data: rateData
                });
            }

            ratesToUpdate.push({ currency, rate, source: rateData.source });
        }

        console.log(`✅ Updated ${ratesToUpdate.length} exchange rates`);
        return {
            success: true,
            updated: ratesToUpdate.length,
            rates: ratesToUpdate,
            timestamp: now,
            source: fetchSuccess ? 'ECB' : 'default',
            fetchedFromECB: fetchSuccess
        };

    } catch (error) {
        console.error('Error updating exchange rates:', error);
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Get multi-currency prices for a product
 */
async function getMultiCurrencyPrices(basePrice, baseCurrency = BASE_CURRENCY) {
    try {
        const prices = {};
        const priceNum = parseFloat(basePrice) || 0;

        for (const currency of Object.keys(SUPPORTED_CURRENCIES)) {
            if (currency === baseCurrency) {
                prices[currency] = priceNum;
            } else {
                const rate = await getExchangeRate(baseCurrency, currency);
                prices[currency] = Math.round(priceNum * rate * 100) / 100;
            }
        }

        return prices;

    } catch (error) {
        console.error('Error getting multi-currency prices:', error);
        // Return base price for all currencies as fallback
        const prices = {};
        const priceNum = parseFloat(basePrice) || 0;
        for (const currency of Object.keys(SUPPORTED_CURRENCIES)) {
            prices[currency] = priceNum;
        }
        return prices;
    }
}

module.exports = {
    convertCurrency,
    getSupportedCurrencies,
    updateExchangeRates,
    getMultiCurrencyPrices,
    getExchangeRate,
    BASE_CURRENCY,
    SUPPORTED_CURRENCIES
};

