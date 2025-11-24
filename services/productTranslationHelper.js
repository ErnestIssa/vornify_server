/**
 * Product Translation Helper
 * Automatically generates Swedish translations for products
 */

// Simple translation mapping for common terms
const commonTranslations = {
    'Lightweight': 'Lättvikt',
    'lightweight': 'lättvikt',
    'training shorts': 'träningsshorts',
    'Training Shorts': 'Träningsshorts',
    'designed for': 'designade för',
    'comfort': 'komfort',
    'mobility': 'rörelse',
    'performance': 'prestanda',
    'Performance': 'Prestanda',
    'high-performance': 'högpresterande',
    'High-performance': 'Högpresterande',
    'advanced': 'avancerad',
    'Advanced': 'Avancerad',
    'technology': 'teknologi',
    'Technology': 'Teknologi',
    'quick drying': 'snabb torkning',
    'Quick drying': 'Snabb torkning',
    'breathable': 'andningsbar',
    'Breathable': 'Andningsbar',
    'material': 'material',
    'Material': 'Material',
    'materials': 'material',
    'Materials': 'Material',
    'machine wash': 'maskintvätt',
    'Machine wash': 'Maskintvätt',
    'cold water': 'kallt vatten',
    'Cold water': 'Kallt vatten',
    'tumble dry': 'torktumlare',
    'Tumble dry': 'Torktumlare',
    'low heat': 'låg värme',
    'Low heat': 'Låg värme',
    'free shipping': 'gratis frakt',
    'Free shipping': 'Gratis frakt',
    'orders over': 'beställningar över',
    'Orders over': 'Beställningar över',
    'day return policy': 'dagar returpolicy',
    'Day return policy': 'Dagar returpolicy',
    'after delivery': 'efter leverans',
    'After delivery': 'Efter leverans',
    'shipping': 'frakt',
    'Shipping': 'Frakt',
    'returns': 'returer',
    'Returns': 'Returer',
    'warranty': 'garanti',
    'Warranty': 'Garanti',
    'fit': 'passform',
    'Fit': 'Passform',
    'size': 'storlek',
    'Size': 'Storlek',
    'recommendations': 'rekommendationer',
    'Recommendations': 'Rekommendationer'
};

/**
 * Simple translation function (basic word replacement)
 * In production, this could use a proper translation API
 */
function translateToSwedish(text) {
    if (!text || typeof text !== 'string') return text;
    
    let translated = text;
    
    // Replace common English phrases with Swedish (case-insensitive)
    Object.keys(commonTranslations).forEach(english => {
        const regex = new RegExp(english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        translated = translated.replace(regex, commonTranslations[english]);
    });
    
    // If no translation was made and text is substantial, add prefix
    if (translated === text && text.length > 10 && !text.startsWith('[SV]')) {
        return `[SV] ${text}`; // Prefix to indicate Swedish translation needed
    }
    
    return translated;
}

/**
 * Translate array of strings
 */
function translateArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.map(item => {
        if (typeof item === 'string') {
            return translateToSwedish(item);
        }
        // If array item is an object, try to translate text fields
        if (typeof item === 'object' && item !== null) {
            const translatedItem = { ...item };
            if (translatedItem.text) {
                translatedItem.text = translateToSwedish(translatedItem.text);
            }
            if (translatedItem.name) {
                translatedItem.name = translateToSwedish(translatedItem.name);
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
 * @param {object} product - Product object
 * @returns {object} Object with Swedish translation fields to add
 */
function generateSwedishTranslations(product) {
    const translations = {};
    
    // Translate description fields (using flat suffix format)
    if (product.description && typeof product.description === 'string') {
        if (!product.description_sv && !product.description?.sv) {
            translations.description_sv = translateToSwedish(product.description);
        }
    }
    
    if (product.shortDescription && typeof product.shortDescription === 'string') {
        if (!product.shortDescription_sv && !product.shortDescription?.sv) {
            translations.shortDescription_sv = translateToSwedish(product.shortDescription);
        }
    }
    
    // Translate array fields (using flat suffix format)
    if (product.materials && Array.isArray(product.materials) && product.materials.length > 0) {
        if (!product.materials_sv && !product.materials?.sv) {
            translations.materials_sv = translateArray(product.materials);
        }
    }
    
    if (product.features && Array.isArray(product.features) && product.features.length > 0) {
        if (!product.features_sv && !product.features?.sv) {
            translations.features_sv = translateArray(product.features);
        }
    }
    
    if (product.careInstructions && Array.isArray(product.careInstructions) && product.careInstructions.length > 0) {
        if (!product.careInstructions_sv && !product.careInstructions?.sv) {
            translations.careInstructions_sv = translateArray(product.careInstructions);
        }
    }
    
    if (product.shippingInfo && Array.isArray(product.shippingInfo) && product.shippingInfo.length > 0) {
        if (!product.shippingInfo_sv && !product.shippingInfo?.sv) {
            translations.shippingInfo_sv = translateArray(product.shippingInfo);
        }
    }
    
    if (product.returnPolicy && Array.isArray(product.returnPolicy) && product.returnPolicy.length > 0) {
        if (!product.returnPolicy_sv && !product.returnPolicy?.sv) {
            translations.returnPolicy_sv = translateArray(product.returnPolicy);
        }
    }
    
    if (product.fitGuide && Array.isArray(product.fitGuide) && product.fitGuide.length > 0) {
        if (!product.fitGuide_sv && !product.fitGuide?.sv) {
            translations.fitGuide_sv = translateArray(product.fitGuide);
        }
    }
    
    if (product.sizeRecommendations && Array.isArray(product.sizeRecommendations) && product.sizeRecommendations.length > 0) {
        if (!product.sizeRecommendations_sv && !product.sizeRecommendations?.sv) {
            translations.sizeRecommendations_sv = translateArray(product.sizeRecommendations);
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
                translations[`${field}_sv`] = translateToSwedish(product[field]);
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

