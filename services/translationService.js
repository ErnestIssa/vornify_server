/**
 * Translation Service
 * Handles multi-language content translation for products and other content
 * Supports: English (en) and Swedish (sv)
 */

const SUPPORTED_LANGUAGES = ['en', 'sv'];
const DEFAULT_LANGUAGE = 'en';

/**
 * Strip "[SV]" prefixes from translation strings
 * This is a safety measure to clean up any broken translations in the database
 * @param {string|array} value - String or array to clean
 * @returns {string|array} Cleaned value without "[SV]" prefixes
 */
function stripSVPrefix(value) {
    if (typeof value === 'string') {
        return value.replace(/^\[SV\]\s*/g, '').trim();
    }
    if (Array.isArray(value)) {
        return value.map(item => {
            if (typeof item === 'string') {
                return item.replace(/^\[SV\]\s*/g, '').trim();
            }
            if (typeof item === 'object' && item !== null) {
                const cleaned = { ...item };
                if (cleaned.text) {
                    cleaned.text = cleaned.text.replace(/^\[SV\]\s*/g, '').trim();
                }
                if (cleaned.name) {
                    cleaned.name = cleaned.name.replace(/^\[SV\]\s*/g, '').trim();
                }
                return cleaned;
            }
            return item;
        });
    }
    return value;
}

/**
 * Get language from request (query param, header, or default)
 * @param {object} req - Express request object
 * @returns {string} Language code (en or sv)
 */
function getLanguageFromRequest(req) {
    const queryLang = req.query?.language?.toLowerCase();
    const headerLang = req.headers['accept-language']?.split(',')[0]?.split('-')[0]?.toLowerCase();
    const lang = queryLang || headerLang || DEFAULT_LANGUAGE;
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
    
    if (obj[fieldName] && typeof obj[fieldName] === 'object' && !Array.isArray(obj[fieldName])) {
        const translations = obj[fieldName];
        const result = translations[language] || translations[DEFAULT_LANGUAGE] || translations[Object.keys(translations)[0]] || '';
        return stripSVPrefix(result);
    }
    
    if (language !== DEFAULT_LANGUAGE) {
        const translatedField = `${fieldName}_${language}`;
        if (obj[translatedField] !== undefined && obj[translatedField] !== null) {
            return stripSVPrefix(obj[translatedField]);
        }
    }
    
    return obj[fieldName] || '';
}

/**
 * Translate an array of strings
 * Handles arrays where each item can be:
 * - A simple string
 * - An object with translations: { en: "...", sv: "..." }
 * - An array of strings with translations stored separately (flat suffix format)
 * 
 * @param {array} arrayField - Array field to translate
 * @param {string} fieldName - Name of the field (for flat suffix lookup)
 * @param {object} originalProduct - Original product object (for flat suffix lookup)
 * @param {string} language - Target language
 * @returns {array} Translated array
 */
function translateArray(arrayField, fieldName, originalProduct, language) {
    if (!Array.isArray(arrayField)) {
        return arrayField;
    }
    
    if (language !== DEFAULT_LANGUAGE && originalProduct) {
        const translatedArrayField = `${fieldName}_${language}`;
        if (originalProduct[translatedArrayField] !== undefined) {
            if (Array.isArray(originalProduct[translatedArrayField])) {
                return stripSVPrefix(originalProduct[translatedArrayField]);
            }
            if (typeof originalProduct[translatedArrayField] === 'string') {
                return stripSVPrefix([originalProduct[translatedArrayField]]);
            }
        }
    }
    
    if (originalProduct && originalProduct[fieldName] && 
        typeof originalProduct[fieldName] === 'object' && 
        !Array.isArray(originalProduct[fieldName]) &&
        originalProduct[fieldName][language]) {
        if (Array.isArray(originalProduct[fieldName][language])) {
            return stripSVPrefix(originalProduct[fieldName][language]);
        }
    }
    
    return arrayField.map((item) => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const translatedItem = { ...item };
            ['text', 'name', 'description', 'title', 'label', 'value'].forEach(key => {
                if (translatedItem[key] !== undefined) {
                    translatedItem[key] = getTranslatedField(translatedItem, key, language);
                }
            });
            return translatedItem;
        }
        return item;
    });
}

/**
 * Translate a nested object (like sizeMeasurements)
 * Recursively translates string values while preserving structure
 * 
 * @param {object} obj - Object to translate
 * @param {string} language - Target language
 * @returns {object} Translated object
 */
function translateNestedObject(obj, language) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return obj;
    }
    const translated = {};
    Object.keys(obj).forEach(key => {
        const value = obj[key];
        if (typeof value === 'string') {
            translated[key] = getTranslatedField(obj, key, language);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            translated[key] = translateNestedObject(value, language);
        } else if (Array.isArray(value)) {
            translated[key] = translateArray(value, key, obj, language);
        } else {
            translated[key] = value;
        }
    });
    return translated;
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
    
    if (language === DEFAULT_LANGUAGE) {
        const hasSwedishTranslations = Object.keys(product).some(key => 
            key.endsWith('_sv') || (typeof product[key] === 'object' && product[key] !== null && product[key]?.sv !== undefined)
        );
        if (!hasSwedishTranslations) {
            return product;
        }
    }
    
    const translated = { ...product };
    const translatableFields = [
        'description', 'shortDescription', 'sizeFitDescription', 'sizeMeasurements',
        'fitGuide', 'sizeRecommendations', 'materials', 'materialComposition',
        'careInstructions', 'care_instructions', 'sustainabilityInfo', 'shippingInfo',
        'shipping_info', 'shippingCosts', 'deliveryTime', 'returnPolicy',
        'return_policy', 'warrantyInfo', 'warranty_info', 'features',
        'category', 'size_guide', 'sizeGuide'
    ];
    
    let translationCount = 0;
    translatableFields.forEach(field => {
        const fieldValue = translated[field] !== undefined ? translated[field] : product[field];
        if (fieldValue !== undefined) {
            if (Array.isArray(fieldValue)) {
                const translatedArray = translateArray(fieldValue, field, product, language);
                translated[field] = translatedArray;
                const svField = `${field}_${language}`;
                const usedSwedishField = language !== DEFAULT_LANGUAGE && product[svField] && 
                                       JSON.stringify(translatedArray) !== JSON.stringify(fieldValue);
                if (language !== DEFAULT_LANGUAGE && (usedSwedishField || JSON.stringify(translatedArray) !== JSON.stringify(fieldValue))) {
                    translationCount++;
                } else if (language !== DEFAULT_LANGUAGE && product[svField]) {
                    translated[field] = Array.isArray(product[svField]) ? product[svField] : [product[svField]];
                    translationCount++;
                }
            } else if (typeof fieldValue === 'string' && (field === 'materials' || field === 'careInstructions')) {
                const translatedValue = getTranslatedField(product, field, language);
                translated[field] = translatedValue;
                if (language !== DEFAULT_LANGUAGE && translatedValue !== fieldValue && translatedValue !== '') {
                    translationCount++;
                }
            } else if (typeof fieldValue === 'object' && fieldValue !== null && !Array.isArray(fieldValue)) {
                if (fieldValue[language] !== undefined) {
                    translated[field] = fieldValue[language];
                    translationCount++;
                } else if (fieldValue[DEFAULT_LANGUAGE] !== undefined) {
                    translated[field] = fieldValue[DEFAULT_LANGUAGE];
                } else {
                    translated[field] = translateNestedObject(fieldValue, language);
                }
            } else if (typeof fieldValue === 'string') {
                const translatedValue = getTranslatedField(product, field, language);
                translated[field] = translatedValue;
                if (language !== DEFAULT_LANGUAGE && translatedValue !== fieldValue && translatedValue !== '') {
                    translationCount++;
                } else if (language !== DEFAULT_LANGUAGE && translatedValue === fieldValue) {
                    const svField = `${field}_sv`;
                    const nestedSv = product[field]?.sv;
                    if (product[svField] || nestedSv) {
                        if (product[svField]) {
                            translated[field] = product[svField];
                            translationCount++;
                        } else if (nestedSv) {
                            translated[field] = nestedSv;
                            translationCount++;
                        }
                    }
                }
            }
        }
    });
    
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

