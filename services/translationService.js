/**
 * Translation Service
 * Handles multi-language content translation for products and other content
 * Supports: English (en) and Swedish (sv)
 */

const SUPPORTED_LANGUAGES = ['en', 'sv'];
const DEFAULT_LANGUAGE = 'en';

/**
 * Get language from request (query param, header, or default)
 * @param {object} req - Express request object
 * @returns {string} Language code (en or sv)
 */
function getLanguageFromRequest(req) {
    // Priority: query param > header > default
    const queryLang = req.query?.language?.toLowerCase();
    const headerLang = req.headers['accept-language']?.split(',')[0]?.split('-')[0]?.toLowerCase();
    
    const lang = queryLang || headerLang || DEFAULT_LANGUAGE;
    
    // Validate and return supported language or default
    return SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
}

/**
 * Get translated field value
 * Supports multiple formats:
 * 1. Nested object: { description: { en: "...", sv: "..." } }
 * 2. Flat with suffix: { description: "...", description_sv: "..." }
 * 3. String (fallback to English): { description: "..." }
 * 
 * @param {object} obj - Object containing the field
 * @param {string} fieldName - Name of the field to translate
 * @param {string} language - Target language (en or sv)
 * @returns {string} Translated value or original if translation not found
 */
function getTranslatedField(obj, fieldName, language = DEFAULT_LANGUAGE) {
    if (!obj || typeof obj !== 'object') {
        return '';
    }
    
    // Format 1: Nested object (preferred)
    if (obj[fieldName] && typeof obj[fieldName] === 'object' && !Array.isArray(obj[fieldName])) {
        const translations = obj[fieldName];
        // Return requested language, fallback to English, then to any available
        return translations[language] || translations[DEFAULT_LANGUAGE] || translations[Object.keys(translations)[0]] || '';
    }
    
    // Format 2: Flat with suffix (e.g., description_sv)
    if (language !== DEFAULT_LANGUAGE) {
        const translatedField = `${fieldName}_${language}`;
        if (obj[translatedField] !== undefined) {
            return obj[translatedField];
        }
    }
    
    // Format 3: Direct field (defaults to English)
    return obj[fieldName] || '';
}

/**
 * Translate a product object
 * Translates user-facing fields while preserving brand identity fields
 * 
 * @param {object} product - Product object from database
 * @param {string} language - Target language (en or sv)
 * @returns {object} Product with translated fields
 */
function translateProduct(product, language = DEFAULT_LANGUAGE) {
    if (!product || typeof product !== 'object') {
        return product;
    }
    
    // Create a copy to avoid mutating original
    const translated = { ...product };
    
    // Fields to translate (user-facing content)
    const translatableFields = [
        'description',
        'category',
        'features',
        'care_instructions',
        'careInstructions',
        'size_guide',
        'sizeGuide',
        'shipping_info',
        'shippingInfo',
        'return_policy',
        'returnPolicy',
        'warranty_info',
        'warrantyInfo'
    ];
    
    // Translate each field
    translatableFields.forEach(field => {
        if (translated[field] !== undefined) {
            // Handle arrays (like features)
            if (Array.isArray(translated[field])) {
                translated[field] = translated[field].map((item, index) => {
                    if (typeof item === 'object' && item !== null) {
                        // If array item is an object, translate its text fields
                        const translatedItem = { ...item };
                        if (translatedItem.text) {
                            translatedItem.text = getTranslatedField(translatedItem, 'text', language);
                        }
                        if (translatedItem.name) {
                            translatedItem.name = getTranslatedField(translatedItem, 'name', language);
                        }
                        return translatedItem;
                    }
                    // If array item is a string, check for nested translations
                    return getTranslatedField({ [field]: item }, field, language) || item;
                });
            } else {
                // Handle objects (like size_guide)
                if (typeof translated[field] === 'object' && translated[field] !== null && !Array.isArray(translated[field])) {
                    const translatedObj = {};
                    Object.keys(translated[field]).forEach(key => {
                        if (key === 'title' || key === 'instructions' || key === 'description' || key === 'text') {
                            translatedObj[key] = getTranslatedField(translated[field], key, language);
                        } else {
                            translatedObj[key] = translated[field][key];
                        }
                    });
                    translated[field] = translatedObj;
                } else {
                    // Handle simple strings
                    translated[field] = getTranslatedField(translated, field, language);
                }
            }
        }
    });
    
    // Fields that should NEVER be translated (brand identity)
    // These remain unchanged: name, brand, sku, id, images, price, etc.
    
    return translated;
}

/**
 * Translate category name
 * @param {object} category - Category object
 * @param {string} language - Target language
 * @returns {string} Translated category name
 */
function translateCategory(category, language = DEFAULT_LANGUAGE) {
    if (typeof category === 'string') {
        return category; // Simple string, no translation available
    }
    
    if (category && typeof category === 'object') {
        return getTranslatedField(category, 'name', language) || category.name || category;
    }
    
    return category;
}

/**
 * Get translation for common UI labels
 * @param {string} key - Translation key
 * @param {string} language - Target language
 * @returns {string} Translated label
 */
const UI_LABELS = {
    en: {
        'add_to_cart': 'Add to Cart',
        'buy_now': 'Buy Now',
        'out_of_stock': 'Out of Stock',
        'in_stock': 'In Stock',
        'size': 'Size',
        'color': 'Color',
        'quantity': 'Quantity',
        'price': 'Price',
        'total': 'Total',
        'subtotal': 'Subtotal',
        'shipping': 'Shipping',
        'tax': 'Tax',
        'checkout': 'Checkout',
        'continue_shopping': 'Continue Shopping',
        'proceed_to_checkout': 'Proceed to Checkout'
    },
    sv: {
        'add_to_cart': 'Lägg i varukorg',
        'buy_now': 'Köp nu',
        'out_of_stock': 'Slut i lager',
        'in_stock': 'I lager',
        'size': 'Storlek',
        'color': 'Färg',
        'quantity': 'Antal',
        'price': 'Pris',
        'total': 'Totalt',
        'subtotal': 'Delsumma',
        'shipping': 'Frakt',
        'tax': 'Moms',
        'checkout': 'Kassa',
        'continue_shopping': 'Fortsätt handla',
        'proceed_to_checkout': 'Gå till kassan'
    }
};

function getUILabel(key, language = DEFAULT_LANGUAGE) {
    const lang = SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
    return UI_LABELS[lang]?.[key] || UI_LABELS[DEFAULT_LANGUAGE]?.[key] || key;
}

module.exports = {
    SUPPORTED_LANGUAGES,
    DEFAULT_LANGUAGE,
    getLanguageFromRequest,
    getTranslatedField,
    translateProduct,
    translateCategory,
    getUILabel
};

