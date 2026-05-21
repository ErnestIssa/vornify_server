/**
 * Run: node scripts/test-product-filters.js
 */
const productFilterService = require('../services/productFilterService');
const { normalizeProductForCatalog } = require('../services/productCatalogNormalize');

const product = normalizeProductForCatalog({
    id: 'p1',
    published: true,
    active: true,
    category: 'Men',
    price: 100,
    inventory: {
        colors: [
            { id: 'Midnight Black', name: 'Midnight Black', hex: '#111' },
            { id: 'white', name: 'White', hex: '#fff' }
        ],
        sizes: [
            { id: 'M', name: 'M' },
            { id: 'L', name: 'L' }
        ],
        variants: [
            { colorId: 'Midnight Black', sizeId: 'M', quantity: 5 },
            { colorId: 'white', sizeId: 'L', quantity: 0 }
        ]
    }
});

const filters = productFilterService.parseFilterQuery({
    color: 'name:midnight-black',
    size: 'm'
});

const ok =
    productFilterService.productMatchesColorFilter(product, filters.colors) &&
    productFilterService.productMatchesSizeFilter(product, filters.sizes);

const facets = productFilterService.extractFacets([product], { displayCurrency: 'SEK', vatRate: 0.25 });
const colorIds = facets.colors.map((c) => c.id);
const sizeIds = facets.sizes.map((s) => s.id);

console.log('match', ok ? 'OK' : 'FAIL', filters);
console.log('facet colors', colorIds);
console.log('facet sizes', sizeIds);

if (!ok || !colorIds.includes('midnight-black') || !sizeIds.includes('m')) {
    process.exitCode = 1;
}
