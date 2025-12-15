/**
 * SEO Helper Utilities for Peak Mode
 * Provides functions for URL generation, canonical URLs, and SEO data formatting
 * All functions are backend-only and do not affect visible functionality
 */

const BASE_URL = process.env.BASE_URL || 'https://peakmode.se';
const BRAND_NAME = 'Peak Mode';

/**
 * Generate a URL-friendly slug from a string
 * @param {string} text - Text to convert to slug
 * @returns {string} - URL-friendly slug (lowercase, hyphen-separated)
 */
function generateSlug(text) {
    if (!text) return '';
    
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')           // Replace spaces with hyphens
        .replace(/[^\w\-]+/g, '')       // Remove non-word characters except hyphens
        .replace(/\-\-+/g, '-')         // Replace multiple hyphens with single hyphen
        .replace(/^-+/, '')             // Remove leading hyphens
        .replace(/-+$/, '');            // Remove trailing hyphens
}

/**
 * Validate URL slug format
 * @param {string} slug - Slug to validate
 * @returns {boolean} - True if valid
 */
function isValidSlug(slug) {
    if (!slug) return false;
    
    // Must be lowercase, hyphen-separated, no spaces or special chars
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    return slugRegex.test(slug);
}

/**
 * Generate canonical URL for a product
 * @param {string} slug - Product slug
 * @returns {string} - Canonical URL
 */
function getProductCanonicalUrl(slug) {
    if (!slug) return `${BASE_URL}/`;
    return `${BASE_URL}/products/${slug}`;
}

/**
 * Generate canonical URL for a collection/category
 * @param {string} categorySlug - Category slug
 * @returns {string} - Canonical URL
 */
function getCollectionCanonicalUrl(categorySlug) {
    if (!categorySlug) return `${BASE_URL}/`;
    const slug = generateSlug(categorySlug);
    return `${BASE_URL}/${slug}`;
}

/**
 * Generate canonical URL for any path
 * @param {string} path - Path (e.g., '/products/performance-shorts')
 * @returns {string} - Canonical URL
 */
function getCanonicalUrl(path) {
    if (!path) return `${BASE_URL}/`;
    // Ensure path starts with /
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${BASE_URL}${cleanPath}`;
}

/**
 * Calculate product availability status
 * @param {object} product - Product object
 * @returns {string} - 'in_stock', 'out_of_stock', or 'preorder'
 */
function calculateAvailability(product) {
    if (!product) return 'out_of_stock';
    
    // Check if product is active
    if (product.active === false) {
        return 'out_of_stock';
    }
    
    // Check inventory variants
    if (product.inventory && product.inventory.variants) {
        const variants = product.inventory.variants;
        const availableVariants = variants.filter(v => 
            v.available !== false && 
            (v.stock === undefined || v.stock > 0)
        );
        
        if (availableVariants.length > 0) {
            return 'in_stock';
        }
    }
    
    // Check if there's a stock field at product level
    if (product.stock !== undefined) {
        return product.stock > 0 ? 'in_stock' : 'out_of_stock';
    }
    
    // Default to in_stock if no inventory system (for products without variants)
    if (!product.inventory) {
        return product.active ? 'in_stock' : 'out_of_stock';
    }
    
    return 'out_of_stock';
}

/**
 * Get availability status for Schema.org
 * @param {string} availability - Internal availability status
 * @returns {string} - Schema.org availability status
 */
function getSchemaAvailability(availability) {
    const mapping = {
        'in_stock': 'https://schema.org/InStock',
        'out_of_stock': 'https://schema.org/OutOfStock',
        'preorder': 'https://schema.org/PreOrder'
    };
    return mapping[availability] || mapping['out_of_stock'];
}

/**
 * Generate default meta title for product
 * @param {object} product - Product object
 * @returns {string} - Meta title (50-60 characters)
 */
function generateProductMetaTitle(product) {
    if (!product) return `${BRAND_NAME} | Performance Activewear`;
    
    // Use custom metaTitle if available
    if (product.metaTitle) {
        return product.metaTitle;
    }
    
    // Generate from product name
    const productName = product.name || 'Product';
    const title = `${productName} – Performance Activewear | ${BRAND_NAME}`;
    
    // Ensure it's within 50-60 characters
    if (title.length <= 60) {
        return title;
    }
    
    // Truncate product name if needed
    const maxProductNameLength = 60 - ` – Performance Activewear | ${BRAND_NAME}`.length;
    const truncatedName = productName.substring(0, maxProductNameLength).trim();
    return `${truncatedName} – Performance Activewear | ${BRAND_NAME}`;
}

/**
 * Generate default meta description for product
 * @param {object} product - Product object
 * @returns {string} - Meta description (140-160 characters)
 */
function generateProductMetaDescription(product) {
    if (!product) {
        return `${BRAND_NAME} designs performance activewear for training, gym, and everyday wear. Built for movement, comfort, and minimalist style.`;
    }
    
    // Use custom metaDescription if available
    if (product.metaDescription) {
        return product.metaDescription;
    }
    
    // Generate from product description
    const productName = product.name || 'Product';
    const description = product.description || '';
    
    // Create description
    let metaDesc = `${productName} performance activewear designed for training and everyday wear.`;
    
    if (description) {
        // Try to use first sentence or first 100 chars of description
        const firstSentence = description.split('.')[0];
        if (firstSentence && firstSentence.length < 100) {
            metaDesc = `${productName} ${firstSentence.toLowerCase()}. Built for movement by ${BRAND_NAME}.`;
        } else {
            const shortDesc = description.substring(0, 80).trim();
            metaDesc = `${productName} ${shortDesc}... Built for movement by ${BRAND_NAME}.`;
        }
    } else {
        metaDesc = `${productName} performance activewear designed for training and everyday wear. Lightweight, durable, and built for movement by ${BRAND_NAME}.`;
    }
    
    // Ensure it's within 140-160 characters
    if (metaDesc.length <= 160) {
        return metaDesc;
    }
    
    // Truncate to 157 chars and add ellipsis
    return metaDesc.substring(0, 157).trim() + '...';
}

/**
 * Generate image alt text
 * @param {object} product - Product object
 * @param {number} imageIndex - Index of image (optional)
 * @returns {string} - Alt text
 */
function generateImageAltText(product, imageIndex = 0) {
    if (!product) return `${BRAND_NAME} performance activewear for training`;
    
    const productName = product.name || 'Product';
    const suffix = imageIndex > 0 ? ` - Image ${imageIndex + 1}` : '';
    return `Peak Mode ${productName} performance activewear for training${suffix}`;
}

/**
 * Get product brand (defaults to Peak Mode)
 * @param {object} product - Product object
 * @returns {string} - Brand name
 */
function getProductBrand(product) {
    return product?.brand || BRAND_NAME;
}

/**
 * Format product data for SEO (adds SEO fields without modifying existing data)
 * @param {object} product - Product object
 * @param {object} reviewStats - Review statistics (optional)
 * @returns {object} - SEO fields only (to be merged with product)
 */
function getProductSEOFields(product, reviewStats = null) {
    if (!product) return {};
    
    // Generate slug if not present
    const slug = product.slug || generateSlug(product.name || product.id);
    
    // Calculate availability
    const availability = calculateAvailability(product);
    
    // Get images (ensure HTTPS URLs)
    const images = (product.images || []).map(img => {
        if (typeof img === 'string') {
            // Ensure HTTPS if it's a full URL
            if (img.startsWith('http://')) {
                return img.replace('http://', 'https://');
            }
            // If relative URL, prepend base URL
            if (img.startsWith('/')) {
                return `${BASE_URL}${img}`;
            }
            return img;
        }
        return img;
    });
    
    // Get primary image
    const primaryImage = images[0] || product.image || null;
    
    // Return only SEO fields (to be merged with existing product data)
    return {
        // SEO-specific fields (additive only)
        seo: {
            slug: slug,
            metaTitle: product.metaTitle || generateProductMetaTitle(product),
            metaDescription: product.metaDescription || generateProductMetaDescription(product),
            brand: getProductBrand(product),
            availability: availability,
            availabilitySchema: getSchemaAvailability(availability),
            canonicalUrl: getProductCanonicalUrl(slug),
            primaryImage: primaryImage,
            images: images,
            rating: reviewStats?.averageRating || product.rating || null,
            reviewCount: reviewStats?.count || product.reviewCount || 0
        }
    };
}

module.exports = {
    generateSlug,
    isValidSlug,
    getProductCanonicalUrl,
    getCollectionCanonicalUrl,
    getCanonicalUrl,
    calculateAvailability,
    getSchemaAvailability,
    generateProductMetaTitle,
    generateProductMetaDescription,
    generateImageAltText,
    getProductBrand,
    getProductSEOFields,
    BASE_URL,
    BRAND_NAME
};

