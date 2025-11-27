/**
 * Product Translation Helper
 * Automatically generates Swedish translations for products
 */

// Comprehensive translation mapping for common terms
// NOTE: For production-quality translations, use a proper translation API or manual translations
// This is a basic fallback that should be replaced with professional translations
const commonTranslations = {
    // Product descriptions
    'Push your limits': 'Pressa dina gränser',
    'push your limits': 'pressa dina gränser',
    'with the': 'med',
    'Crafted with': 'Tillverkade med',
    'crafted with': 'tillverkade med',
    'and': 'och',
    'design': 'design',
    'Design': 'Design',
    'these': 'dessa',
    'These': 'Dessa',
    'are built for': 'är byggda för',
    'are built': 'är byggda',
    'built for': 'byggda för',
    'Featuring': 'Med',
    'featuring': 'med',
    'with': 'med',
    'for': 'för',
    'and': 'och',
    'Perfect for': 'Perfekt för',
    'perfect for': 'perfekt för',
    'training': 'träning',
    'Training': 'Träning',
    'everyday use': 'vardagsanvändning',
    'Everyday use': 'Vardagsanvändning',
    'casual wear': 'vardagsanvändning',
    'Casual wear': 'Vardagsanvändning',
    
    // Features
    'Lightweight': 'Lättvikt',
    'lightweight': 'lättvikt',
    'training shorts': 'träningsshorts',
    'Training Shorts': 'Träningsshorts',
    'Performance Shorts': 'Performance Shorts', // Brand name - keep
    'performance shorts': 'performance shorts',
    'designed for': 'designade för',
    'comfort': 'komfort',
    'mobility': 'rörelse',
    'performance': 'prestanda',
    'Performance': 'Prestanda',
    'high-performance': 'högpresterande',
    'High-performance': 'Högpresterande',
    'high-intensity': 'högintensiva',
    'High-intensity': 'Högintensiva',
    'workouts': 'träningspass',
    'Workouts': 'Träningspass',
    'advanced': 'avancerad',
    'Advanced': 'Avancerad',
    'technology': 'teknologi',
    'Technology': 'Teknologi',
    'quick drying': 'snabb torkning',
    'Quick drying': 'Snabb torkning',
    'Quick-dry': 'Snabb torkning',
    'quick-dry': 'snabb torkning',
    'breathable': 'andningsbar',
    'Breathable': 'Andningsbar',
    'sweat-wicking': 'svettavledande',
    'Sweat-wicking': 'Svettavledande',
    'fabric': 'tyg',
    'Fabric': 'Tyg',
    'four-way stretch': 'fyrvägs stretch',
    'Four-way stretch': 'Fyrvägs stretch',
    'elastic waistband': 'elastiskt midjeband',
    'Elastic waistband': 'Elastiskt midjeband',
    'adjustable drawstrings': 'justerbara dragsnören',
    'Adjustable drawstrings': 'Justerbara dragsnören',
    'zippered side pockets': 'dragkedjefickor',
    'Zippered side pockets': 'Dragkedjefickor',
    'secure storage': 'säker förvaring',
    'Secure storage': 'Säker förvaring',
    'Moisture-wicking fabric': 'Svettavledande tyg',
    'moisture-wicking fabric': 'svettavledande tyg',
    'Flexible stretch': 'Flexibel stretch',
    'flexible stretch': 'flexibel stretch',
    'for maximum movement': 'för maximal rörlighet',
    'For maximum movement': 'För maximal rörlighet',
    
    // Materials
    'material': 'material',
    'Material': 'Material',
    'materials': 'material',
    'Materials': 'Material',
    'cotton': 'bomull',
    'Cotton': 'Bomull',
    'polyester': 'polyester',
    'Polyester': 'Polyester',
    
    // Care instructions
    'machine wash': 'maskintvätt',
    'Machine wash': 'Maskintvätt',
    'wash': 'tvätta',
    'Wash': 'Tvätta',
    'with': 'med',
    'warm water': 'varmt vatten',
    'Warm water': 'Varmt vatten',
    'cold water': 'kallt vatten',
    'Cold water': 'Kallt vatten',
    'tumble dry': 'torktumlare',
    'Tumble dry': 'Torktumlare',
    'low heat': 'låg värme',
    'Low heat': 'Låg värme',
    
    // Shipping & Returns
    'free shipping': 'gratis frakt',
    'Free shipping': 'Gratis frakt',
    'Free standard shipping': 'Gratis standardfrakt',
    'free standard shipping': 'gratis standardfrakt',
    'on': 'på',
    'On': 'På',
    'orders over': 'beställningar över',
    'Orders over': 'Beställningar över',
    'Delivery': 'Leverans',
    'delivery': 'leverans',
    'within': 'inom',
    'Within': 'Inom',
    'business days': 'arbetsdagar',
    'Business days': 'Arbetsdagar',
    'days': 'dagar',
    'Days': 'Dagar',
    'day return policy': 'dagar returpolicy',
    'Day return policy': 'Dagar returpolicy',
    '30-day': '30 dagars',
    '30-day free returns': '30 dagars gratis returer',
    'free returns': 'gratis returer',
    'Free returns': 'Gratis returer',
    'Items must be': 'Artiklar måste vara',
    'items must be': 'artiklar måste vara',
    'unworn': 'oanvända',
    'Unworn': 'Oanvända',
    'and in original packaging': 'och i originalförpackning',
    'And in original packaging': 'Och i originalförpackning',
    'Free size exchanges': 'Gratis storleksbyten',
    'free size exchanges': 'gratis storleksbyten',
    'after delivery': 'efter leverans',
    'After delivery': 'Efter leverans',
    'shipping': 'frakt',
    'Shipping': 'Frakt',
    'returns': 'returer',
    'Returns': 'Returer',
    '&': '&',
    'Frakt & Returer': 'Frakt & Returer',
    
    // Fit & Size
    'warranty': 'garanti',
    'Warranty': 'Garanti',
    'fit': 'passform',
    'Fit': 'Passform',
    'Fit guide': 'Passformsguide',
    'fit guide': 'passformsguide',
    'True to size': 'Sann till storlek',
    'true to size': 'sann till storlek',
    'regular fit': 'vanlig passform',
    'Regular fit': 'Vanlig passform',
    'Falls': 'Fall',
    'falls': 'fall',
    'just above': 'precis ovanför',
    'Just above': 'Precis ovanför',
    'the knee': 'knäet',
    'The knee': 'Knäet',
    'size': 'storlek',
    'Size': 'Storlek',
    'Size recommendations': 'Storleksrekommendationer',
    'size recommendations': 'storleksrekommendationer',
    'If between sizes': 'Om du är mellan storlekar',
    'if between sizes': 'om du är mellan storlekar',
    'size up': 'välj större',
    'Size up': 'Välj större',
    'for a relaxed fit': 'för en avslappnad passform',
    'For a relaxed fit': 'För en avslappnad passform',
    'Ideal for': 'Ideal för',
    'ideal for': 'ideal för',
    'running': 'löpning',
    'Running': 'Löpning',
    'or': 'eller',
    'Or': 'Eller',
    'recommendations': 'rekommendationer',
    'Recommendations': 'Rekommendationer',
    'Size great': 'Storlek bra',
    'size great': 'storlek bra',
    'fits well': 'passar bra',
    'Fits well': 'Passar bra'
};

/**
 * Simple translation function (basic phrase replacement)
 * 
 * IMPORTANT: This is a basic fallback. For production-quality translations:
 * - Use a proper translation API (Google Translate, DeepL, etc.)
 * - Or add manual translations to the database
 * 
 * This function will:
 * - Translate common phrases if found in dictionary
 * - Return English text if translation not available (better than broken translations)
 * - NEVER add "[SV]" prefixes or partial translations
 */
function translateToSwedish(text) {
    if (!text || typeof text !== 'string') return text;
    
    // If text is very short or just a single word, return as-is
    if (text.length < 3) return text;
    
    let translated = text;
    let hasTranslation = false;
    
    // Sort translations by length (longest first) to match phrases before words
    const sortedKeys = Object.keys(commonTranslations).sort((a, b) => b.length - a.length);
    
    // Replace common English phrases with Swedish (case-insensitive)
    sortedKeys.forEach(english => {
        const regex = new RegExp(english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        if (regex.test(translated)) {
            translated = translated.replace(regex, commonTranslations[english]);
            hasTranslation = true;
        }
    });
    
    // If no meaningful translation was made, return English (fallback)
    // This is better than broken partial translations
    if (!hasTranslation || translated === text) {
        // Return English - translation service will use this as fallback
        return null; // Signal that translation is not available
    }
    
    return translated;
}

/**
 * Translate array of strings
 * Returns array with translated items, or original items if translation not available
 */
function translateArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.map(item => {
        if (typeof item === 'string') {
            const translated = translateToSwedish(item);
            // Return original if translation not available (null)
            return translated !== null ? translated : item;
        }
        // If array item is an object, try to translate text fields
        if (typeof item === 'object' && item !== null) {
            const translatedItem = { ...item };
            if (translatedItem.text) {
                const translatedText = translateToSwedish(translatedItem.text);
                if (translatedText !== null) {
                    translatedItem.text = translatedText;
                }
            }
            if (translatedItem.name) {
                const translatedName = translateToSwedish(translatedItem.name);
                if (translatedName !== null) {
                    translatedItem.name = translatedName;
                }
            }
            return translatedItem;
        }
        return item;
    });
}

/**
 * Automatically generate Swedish translations for a product
 * Only adds translations if they don't already exist
 * 
 * IMPORTANT: This uses basic phrase replacement. For production:
 * - Manual translations should be added to database
 * - Or integrate a proper translation API
 * 
 * @param {object} product - Product object
 * @returns {object} Object with Swedish translation fields to add
 */
function generateSwedishTranslations(product) {
    const translations = {};
    
    // Translate description fields (using flat suffix format)
    // Only add translation if it's actually translated (not null)
    if (product.description && typeof product.description === 'string') {
        if (!product.description_sv && !product.description?.sv) {
            const translated = translateToSwedish(product.description);
            // Only add if translation was successful (not null)
            if (translated !== null && translated !== product.description) {
                translations.description_sv = translated;
            }
            // If translation is null, don't add it - translation service will use English fallback
        }
    }
    
    if (product.shortDescription && typeof product.shortDescription === 'string') {
        if (!product.shortDescription_sv && !product.shortDescription?.sv) {
            const translated = translateToSwedish(product.shortDescription);
            if (translated !== null && translated !== product.shortDescription) {
                translations.shortDescription_sv = translated;
            }
        }
    }
    
    // Translate array fields (using flat suffix format)
    // Only add if translation is successful
    if (product.materials && Array.isArray(product.materials) && product.materials.length > 0) {
        if (!product.materials_sv && !product.materials?.sv) {
            const translated = translateArray(product.materials);
            // Check if any items were actually translated
            if (translated && translated.some((item, idx) => item !== product.materials[idx] && item !== null)) {
                translations.materials_sv = translated.filter(item => item !== null);
            }
        }
    }
    
    if (product.features && Array.isArray(product.features) && product.features.length > 0) {
        if (!product.features_sv && !product.features?.sv) {
            const translated = translateArray(product.features);
            if (translated && translated.some((item, idx) => item !== product.features[idx] && item !== null)) {
                translations.features_sv = translated.filter(item => item !== null);
            }
        }
    }
    
    if (product.careInstructions && Array.isArray(product.careInstructions) && product.careInstructions.length > 0) {
        if (!product.careInstructions_sv && !product.careInstructions?.sv) {
            const translated = translateArray(product.careInstructions);
            if (translated && translated.some((item, idx) => item !== product.careInstructions[idx] && item !== null)) {
                translations.careInstructions_sv = translated.filter(item => item !== null);
            }
        }
    }
    
    if (product.shippingInfo && Array.isArray(product.shippingInfo) && product.shippingInfo.length > 0) {
        if (!product.shippingInfo_sv && !product.shippingInfo?.sv) {
            const translated = translateArray(product.shippingInfo);
            if (translated && translated.some((item, idx) => item !== product.shippingInfo[idx] && item !== null)) {
                translations.shippingInfo_sv = translated.filter(item => item !== null);
            }
        }
    }
    
    if (product.returnPolicy && Array.isArray(product.returnPolicy) && product.returnPolicy.length > 0) {
        if (!product.returnPolicy_sv && !product.returnPolicy?.sv) {
            const translated = translateArray(product.returnPolicy);
            if (translated && translated.some((item, idx) => item !== product.returnPolicy[idx] && item !== null)) {
                translations.returnPolicy_sv = translated.filter(item => item !== null);
            }
        }
    }
    
    if (product.fitGuide && Array.isArray(product.fitGuide) && product.fitGuide.length > 0) {
        if (!product.fitGuide_sv && !product.fitGuide?.sv) {
            const translated = translateArray(product.fitGuide);
            if (translated && translated.some((item, idx) => item !== product.fitGuide[idx] && item !== null)) {
                translations.fitGuide_sv = translated.filter(item => item !== null);
            }
        }
    }
    
    if (product.sizeRecommendations && Array.isArray(product.sizeRecommendations) && product.sizeRecommendations.length > 0) {
        if (!product.sizeRecommendations_sv && !product.sizeRecommendations?.sv) {
            const translated = translateArray(product.sizeRecommendations);
            if (translated && translated.some((item, idx) => item !== product.sizeRecommendations[idx] && item !== null)) {
                translations.sizeRecommendations_sv = translated.filter(item => item !== null);
            }
        }
    }
    
    // Translate string fields (using flat suffix format)
    const stringFields = [
        'sizeFitDescription',
        'materialComposition',
        'sustainabilityInfo',
        'shippingCosts',
        'deliveryTime',
        'warrantyInfo'
    ];
    
    stringFields.forEach(field => {
        if (product[field] && typeof product[field] === 'string') {
            if (!product[`${field}_sv`] && !product[field]?.sv) {
                const translated = translateToSwedish(product[field]);
                // Only add if translation was successful
                if (translated !== null && translated !== product[field]) {
                    translations[`${field}_sv`] = translated;
                }
            }
        }
    });
    
    return translations;
}

module.exports = {
    generateSwedishTranslations,
    translateToSwedish,
    translateArray
};

