/**
 * Run: node scripts/test-product-search.js
 */
const productFilterService = require('../services/productFilterService');
const { normalizeProductForCatalog } = require('../services/productCatalogNormalize');

const product = normalizeProductForCatalog({
    id: 'prod-1',
    name: 'Performance Tee',
    published: true,
    active: true,
    category: 'Men',
    inventory: {
        colors: [{ id: 'black', name: 'Black', hex: '#000' }],
        sizes: [{ id: 'M', name: 'M' }],
        variants: [
            {
                colorId: 'black',
                sizeId: 'M',
                sku: 'PM-TEE-BLK-M',
                quantity: 3
            }
        ]
    }
});

const bySku = productFilterService.productMatchesSearch(product, 'PM-TEE-BLK-M');
const byPartial = productFilterService.productMatchesSearch(product, 'tee-blk');
const byName = productFilterService.productMatchesSearch(product, 'performance');
const skuOnly = productFilterService.productMatchesSearch(product, 'performance', {
    searchSkuOnly: true
});

const filters = productFilterService.parseFilterQuery({ search: 'PM-TEE-BLK-M' });
const matches = productFilterService.productMatchesFilters(product, filters, {});
const annotation = productFilterService.buildSearchMatchAnnotation(product, 'PM-TEE-BLK-M');
const variantCount = product.inventory.variants.length;

const hoodieBlack = normalizeProductForCatalog({
    id: 'hoodie-1',
    name: 'Performance Hoodie Black',
    published: true,
    active: true,
    inventory: {
        colors: [{ id: 'black', name: 'Black', hex: '#000' }],
        sizes: [{ id: 'M', name: 'M' }],
        variants: [{ colorId: 'black', sizeId: 'M', sku: 'PM-HOODIE-BLK-M', quantity: 1 }]
    }
});
const hoodieWhite = normalizeProductForCatalog({
    id: 'hoodie-2',
    name: 'Performance Hoodie White',
    published: true,
    active: true,
    inventory: {
        colors: [{ id: 'white', name: 'White', hex: '#fff' }],
        sizes: [{ id: 'M', name: 'M' }],
        variants: [{ colorId: 'white', sizeId: 'M', sku: 'PM-HOODIE-WHT-M', quantity: 1 }]
    }
});
const familyBlack = productFilterService.productMatchesSearch(hoodieBlack, 'PM-HOODIE-BLK-M');
const familyWhite = productFilterService.productMatchesSearch(hoodieWhite, 'PM-HOODIE-BLK-M');

console.log('exact sku', bySku);
console.log('partial sku', byPartial);
console.log('name', byName);
console.log('sku-only mode rejects name', !skuOnly);
console.log('parseFilter+matches', matches);
console.log('annotation', annotation?.scope, annotation?.includeAllVariants);
console.log('variants preserved', variantCount);
console.log('style family white listing', familyWhite);

if (
    !bySku ||
    !byPartial ||
    !byName ||
    skuOnly ||
    !matches ||
    annotation?.scope !== 'fullProduct' ||
    !annotation?.includeAllVariants ||
    !familyBlack ||
    !familyWhite
) {
    process.exitCode = 1;
    console.error('FAIL');
} else {
    console.log('OK');
}

const productSearchService = require('../services/productSearchService');
const onSale = normalizeProductForCatalog({
    id: 'sale-1',
    name: 'Sale Tee',
    published: true,
    active: true,
    price: 80,
    compareAtPrice: 120,
    inventory: { variants: [{ sku: 'SALE-1', quantity: 1, colorId: 'x', sizeId: 'm' }] }
});
const parsedSale = productSearchService.parseProductSearchQuery('sale');
const parsedUnder = productSearchService.parseProductSearchQuery('hoodie under 500');
const parsedTwo = productSearchService.parseProductSearchQuery('size two');
const matchSale = productFilterService.productMatchesFilters(onSale, {
    ...productFilterService.parseFilterQuery({ search: 'sale' }),
    search: 'sale',
    searchParsed: parsedSale
}, {});
const filtersTwo = productFilterService.parseFilterQuery({ search: 'two' });
const sizeProduct = normalizeProductForCatalog({
    id: 'sz',
    name: 'Numeric Size',
    published: true,
    active: true,
    inventory: {
        sizes: [{ id: '2', name: '2' }],
        variants: [{ sizeId: '2', colorId: 'c', sku: 'N2', quantity: 1 }]
    }
});
const matchTwo = productFilterService.productMatchesFilters(sizeProduct, filtersTwo, {});

console.log('sale intent', matchSale, parsedSale.intents);
console.log('under 500', parsedUnder.priceMax);
console.log('two→2 token', filtersTwo.searchParsed?.tokens, matchTwo);

if (!matchSale || parsedUnder.priceMax !== 500 || !matchTwo) {
    process.exitCode = 1;
    console.error('advanced search FAIL');
}
