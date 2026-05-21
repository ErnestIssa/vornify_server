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

const p2 = normalizeProductForCatalog({
    id: 'p2',
    published: true,
    active: true,
    price: 50,
    inventory: {
        colors: [{ id: 'white', name: 'White', hex: '#fff' }],
        sizes: [{ id: 'Medium', name: 'M' }],
        variants: [{ colorId: 'white', sizeId: 'Medium', quantity: 1 }]
    }
});
const multiFacets = productFilterService.extractFacets([product, p2], {
    displayCurrency: 'SEK',
    vatRate: 0.25
});
const mCount = multiFacets.sizes.filter((s) => s.name === 'M' || s.id === 'm').length;
if (mCount !== 1) {
    console.error('FAIL expected one M size facet, got', multiFacets.sizes);
    process.exitCode = 1;
} else {
    console.log('dedupe OK: one M facet for M + Medium ids');
}
