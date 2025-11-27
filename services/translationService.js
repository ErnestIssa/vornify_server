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
    // e.g., description: { en: "...", sv: "..." }
    if (obj[fieldName] && typeof obj[fieldName] === 'object' && !Array.isArray(obj[fieldName])) {
        const translations = obj[fieldName];
        // Return requested language, fallback to English, then to any available
        const result = translations[language] || translations[DEFAULT_LANGUAGE] || translations[Object.keys(translations)[0]] || '';
        if (language !== DEFAULT_LANGUAGE && result) {
            console.log(`    📝 getTranslatedField: Found ${fieldName} in nested format (${language})`);
        }
        return result;
    }
    
    // Format 2: Flat with suffix (e.g., description_sv)
    // This is the format we're using - check this FIRST for Swedish
    if (language !== DEFAULT_LANGUAGE) {
        const translatedField = `${fieldName}_${language}`;
        if (obj[translatedField] !== undefined && obj[translatedField] !== null) {
            return obj[translatedField];
        }
    }
    
    // Format 3: Direct field (defaults to English)
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
    
    // Check if there's a translated version of the entire array (flat suffix format)
    // e.g., materials_sv: ["95% Polyester", "5% Elastan"]
    if (language !== DEFAULT_LANGUAGE && originalProduct) {
        const translatedArrayField = `${fieldName}_${language}`;
        if (originalProduct[translatedArrayField] !== undefined && Array.isArray(originalProduct[translatedArrayField])) {
            return originalProduct[translatedArrayField];
        }
    }
    
    // Check if array is stored as nested object with language keys
    // e.g., materials: { en: [...], sv: [...] }
    if (originalProduct && originalProduct[fieldName] && 
        typeof originalProduct[fieldName] === 'object' && 
        !Array.isArray(originalProduct[fieldName]) &&
        originalProduct[fieldName][language]) {
        if (Array.isArray(originalProduct[fieldName][language])) {
            return originalProduct[fieldName][language];
        }
    }
    
    // Translate each item in the array
    return arrayField.map((item, index) => {
        // If item is an object with translations
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const translatedItem = { ...item };
            
            // Translate common text fields in objects
            ['text', 'name', 'description', 'title', 'label', 'value'].forEach(key => {
                if (translatedItem[key] !== undefined) {
                    translatedItem[key] = getTranslatedField(translatedItem, key, language);
                }
            });
            
            return translatedItem;
        }
        
        // If item is a string, return as-is (no per-item translation for simple string arrays)
        // Translation should be done at the array level using flat suffix or nested format
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
        
        // If value is a string, try to translate it
        if (typeof value === 'string') {
            translated[key] = getTranslatedField(obj, key, language);
        }
        // If value is an object, recursively translate it
        else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            translated[key] = translateNestedObject(value, language);
        }
        // If value is an array, translate it
        else if (Array.isArray(value)) {
            translated[key] = translateArray(value, key, obj, language);
        }
        // Otherwise, keep as-is (numbers, booleans, etc.)
        else {
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
    
    // Debug: Log translation attempt
    if (language !== DEFAULT_LANGUAGE) {
        console.log(`🌐 [Translation] Translating product ${product.id || product._id || 'unknown'} to ${language}`);
    }
    
    // If requesting English and no Swedish translations exist, return early (no translation needed)
    if (language === DEFAULT_LANGUAGE) {
        const hasSwedishTranslations = Object.keys(product).some(key => 
            key.endsWith('_sv') || (typeof product[key] === 'object' && product[key] !== null && product[key]?.sv !== undefined)
        );
        
        // If no Swedish translations exist and requesting English, return as-is
        if (!hasSwedishTranslations) {
            return product;
        }
    }
    
    // Create a copy to avoid mutating original (shallow copy is sufficient)
    const translated = { ...product };
    
    // Complete list of translatable fields (user-facing content)
    const translatableFields = [
        // Product descriptions
        'description',
        'shortDescription',
        
        // Size & Fit
        'sizeFitDescription',
        'sizeMeasurements',
        'fitGuide',
        'sizeRecommendations',
        
        // Materials & Care
        'materials',
        'materialComposition',
        'careInstructions',
        'care_instructions',
        'sustainabilityInfo',
        
        // Shipping & Returns
        'shippingInfo',
        'shipping_info',
        'shippingCosts',
        'deliveryTime',
        'returnPolicy',
        'return_policy',
        'warrantyInfo',
        'warranty_info',
        
        // Product Features
        'features',
        
        // Legacy/alternative field names
        'category',
        'size_guide',
        'sizeGuide'
    ];
    
    // Translate each field
    let translationCount = 0;
    translatableFields.forEach(field => {
        // Check both in translated copy and original product for the field
        const fieldValue = translated[field] !== undefined ? translated[field] : product[field];
        
        if (fieldValue !== undefined) {
            const originalValue = translated[field];
            
            // Handle arrays (like features, materials, careInstructions, etc.)
            if (Array.isArray(fieldValue)) {
                const translatedArray = translateArray(fieldValue, field, product, language);
                translated[field] = translatedArray;
                if (language !== DEFAULT_LANGUAGE && JSON.stringify(translatedArray) !== JSON.stringify(fieldValue)) {
                    translationCount++;
                    console.log(`  ✅ Translated array field: ${field}`);
                }
            }
            // Handle nested objects (like sizeMeasurements)
            else if (typeof fieldValue === 'object' && fieldValue !== null && !Array.isArray(fieldValue)) {
                // Check if it's a nested translation object first
                if (fieldValue[language] !== undefined) {
                    translated[field] = fieldValue[language];
                    translationCount++;
                    console.log(`  ✅ Translated nested object field: ${field} (found ${language} translation)`);
                } else if (fieldValue[DEFAULT_LANGUAGE] !== undefined) {
                    // Fallback to English
                    translated[field] = fieldValue[DEFAULT_LANGUAGE];
                    if (language !== DEFAULT_LANGUAGE) {
                        console.log(`  ⚠️ Field ${field}: No ${language} translation, using English fallback`);
                    }
                } else {
                    // Recursively translate nested object
                    translated[field] = translateNestedObject(fieldValue, language);
                }
            }
            // Handle simple strings
            else if (typeof fieldValue === 'string') {
                const translatedValue = getTranslatedField(product, field, language);
                translated[field] = translatedValue;
                
                if (language !== DEFAULT_LANGUAGE && translatedValue !== fieldValue && translatedValue !== '') {
                    translationCount++;
                    console.log(`  ✅ Translated string field: ${field}`);
                } else if (language !== DEFAULT_LANGUAGE && translatedValue === fieldValue) {
                    // Check if Swedish translation exists but wasn't used (shouldn't happen, but just in case)
                    const svField = `${field}_sv`;
                    const nestedSv = product[field]?.sv;
                    if (product[svField] || nestedSv) {
                        // Force use the Swedish translation if it exists
                        if (product[svField]) {
                            translated[field] = product[svField];
                            translationCount++;
                            console.log(`  ✅ Applied Swedish translation for ${field}`);
                        } else if (nestedSv) {
                            translated[field] = nestedSv;
                            translationCount++;
                            console.log(`  ✅ Applied nested Swedish translation for ${field}`);
                        }
                    }
                }
            }
        }
    });
    
    if (language !== DEFAULT_LANGUAGE) {
        console.log(`🌐 [Translation] Completed: ${translationCount} fields translated for language ${language}`);
    }
    
    // Fields that should NEVER be translated (brand identity)
    // These remain unchanged: name, brand, sku, id, images, price, currency, inventory, etc.
    
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

