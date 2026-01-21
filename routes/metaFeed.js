const express = require('express');
const getDBInstance = require('../vornifydb/dbInstance');
const seoHelper = require('../utils/seoHelper');

const router = express.Router();
const db = getDBInstance();

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // If it contains special chars, wrap in quotes and escape quotes
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toAbsoluteUrl(url, baseUrl) {
  if (!url) return '';
  const str = String(url).trim();
  if (!str) return '';
  if (str.startsWith('http://') || str.startsWith('https://')) return str;
  if (str.startsWith('/')) return `${baseUrl}${str}`;
  return `${baseUrl}/${str}`;
}

function getPrimaryImage(product, baseUrl) {
  const candidate =
    (Array.isArray(product?.media) && product.media[0]) ||
    (Array.isArray(product?.images) && product.images[0]) ||
    product?.image ||
    product?.seo?.primaryImage ||
    (Array.isArray(product?.seo?.images) && product.seo.images[0]) ||
    '';

  return toAbsoluteUrl(candidate, baseUrl);
}

function getProductLink(product, baseUrl) {
  const slug =
    product?.seo?.slug ||
    product?.slug ||
    seoHelper.generateSlug(product?.name || product?.id || '');
  return `${baseUrl}/products/${encodeURIComponent(slug)}`;
}

function getMetaAvailability(product) {
  // Reuse existing availability logic then map to Meta values
  const avail = seoHelper.calculateAvailability(product); // in_stock | out_of_stock | preorder
  switch (avail) {
    case 'in_stock':
      return 'in stock';
    case 'preorder':
      return 'preorder';
    case 'out_of_stock':
    default:
      return 'out of stock';
  }
}

router.get('/meta-feed.csv', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || process.env.FRONTEND_URL || 'https://peakmode.se';

    const result = await db.executeOperation({
      database_name: 'peakmode',
      collection_name: 'products',
      command: '--read',
      data: {}
    });

    if (!result.success) {
      return res.status(500).setHeader('Content-Type', 'application/json').json({
        success: false,
        error: 'Failed to fetch products for Meta feed'
      });
    }

    let products = result.data || [];
    if (!Array.isArray(products)) products = [products].filter(Boolean);

    // Only include active/published products by default
    products = products.filter(p => (p?.active !== false) && (p?.published !== false));

    // CSV header (Meta / Facebook Catalog)
    const headers = [
      'id',
      'title',
      'description',
      'availability',
      'condition',
      'price',
      'link',
      'image_link',
      'brand',
      'gtin',
      'mpn',
      'shipping_weight',
      'shipping_price'
    ];

    const lines = [];
    lines.push(headers.join(','));

    for (const product of products) {
      const id = product?.id || product?._id || '';
      const title = product?.name || product?.title || '';
      const description = product?.description || '';
      const availability = getMetaAvailability(product);
      const condition = 'new';
      const currency = (product?.currency || product?.baseCurrency || 'SEK').toUpperCase();
      const priceNumber = product?.price ?? '';
      const price = priceNumber !== '' ? `${priceNumber} ${currency}` : '';
      const link = getProductLink(product, baseUrl);
      const image_link = getPrimaryImage(product, baseUrl);
      const brand = 'Peak Mode';

      const gtin = product?.gtin || '';
      const mpn = product?.mpn || product?.sku || '';
      const shipping_weight = product?.shipping_weight || product?.weight || '';
      const shipping_price = product?.shipping_price || '';

      const row = [
        id,
        title,
        description,
        availability,
        condition,
        price,
        link,
        image_link,
        brand,
        gtin,
        mpn,
        shipping_weight,
        shipping_price
      ].map(csvEscape);

      lines.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
    return res.status(200).send(lines.join('\n'));
  } catch (error) {
    console.error('Meta feed error:', error);
    return res.status(500).setHeader('Content-Type', 'application/json').json({
      success: false,
      error: 'Internal server error generating Meta feed'
    });
  }
});

module.exports = router;


