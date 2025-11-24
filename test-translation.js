/**
 * Test script to verify translation service is working
 * Run: node test-translation.js
 */

const translationService = require('./services/translationService');

// Test product with Swedish translations (Format 1: Nested objects)
const testProduct1 = {
    id: 'test-1',
    name: 'Test Product',
    description: {
        en: 'English description',
        sv: 'Swedish description'
    },
    shortDescription: {
        en: 'English short',
        sv: 'Swedish short'
    },
    materials: {
        en: ['Material 1', 'Material 2'],
        sv: ['Material 1 SV', 'Material 2 SV']
    },
    features: ['Feature 1', 'Feature 2']
};

// Test product with Swedish translations (Format 2: Flat suffix)
const testProduct2 = {
    id: 'test-2',
    name: 'Test Product 2',
    description: 'English description',
    description_sv: 'Swedish description',
    shortDescription: 'English short',
    shortDescription_sv: 'Swedish short',
    materials: ['Material 1', 'Material 2'],
    materials_sv: ['Material 1 SV', 'Material 2 SV'],
    features: ['Feature 1', 'Feature 2']
};

// Test product without Swedish translations (should fallback to English)
const testProduct3 = {
    id: 'test-3',
    name: 'Test Product 3',
    description: 'English description only',
    shortDescription: 'English short only',
    materials: ['Material 1', 'Material 2'],
    features: ['Feature 1', 'Feature 2']
};

console.log('🧪 Testing Translation Service\n');
console.log('='.repeat(60));

// Test 1: Nested object format
console.log('\n📦 Test 1: Nested Object Format (Format 1)');
console.log('Requesting Swedish translation...');
const translated1 = translationService.translateProduct(testProduct1, 'sv');
console.log('Result:');
console.log('  description:', translated1.description);
console.log('  shortDescription:', translated1.shortDescription);
console.log('  materials:', translated1.materials);
console.log('✅ Expected: Swedish translations');
console.log('✅ Actual:', 
    translated1.description === 'Swedish description' &&
    translated1.shortDescription === 'Swedish short' &&
    JSON.stringify(translated1.materials) === JSON.stringify(['Material 1 SV', 'Material 2 SV'])
    ? 'PASS' : 'FAIL'
);

// Test 2: Flat suffix format
console.log('\n📦 Test 2: Flat Suffix Format (Format 2)');
console.log('Requesting Swedish translation...');
const translated2 = translationService.translateProduct(testProduct2, 'sv');
console.log('Result:');
console.log('  description:', translated2.description);
console.log('  shortDescription:', translated2.shortDescription);
console.log('  materials:', translated2.materials);
console.log('✅ Expected: Swedish translations');
console.log('✅ Actual:', 
    translated2.description === 'Swedish description' &&
    translated2.shortDescription === 'Swedish short' &&
    JSON.stringify(translated2.materials) === JSON.stringify(['Material 1 SV', 'Material 2 SV'])
    ? 'PASS' : 'FAIL'
);

// Test 3: No Swedish translations (fallback)
console.log('\n📦 Test 3: No Swedish Translations (Fallback)');
console.log('Requesting Swedish translation...');
const translated3 = translationService.translateProduct(testProduct3, 'sv');
console.log('Result:');
console.log('  description:', translated3.description);
console.log('  shortDescription:', translated3.shortDescription);
console.log('  materials:', translated3.materials);
console.log('✅ Expected: English fallback');
console.log('✅ Actual:', 
    translated3.description === 'English description only' &&
    translated3.shortDescription === 'English short only' &&
    JSON.stringify(translated3.materials) === JSON.stringify(['Material 1', 'Material 2'])
    ? 'PASS' : 'FAIL'
);

// Test 4: English (default)
console.log('\n📦 Test 4: English (Default Language)');
console.log('Requesting English translation...');
const translated4 = translationService.translateProduct(testProduct1, 'en');
console.log('Result:');
console.log('  description:', translated4.description);
console.log('✅ Expected: English or nested object');
console.log('✅ Actual:', translated4.description ? 'PASS' : 'FAIL');

console.log('\n' + '='.repeat(60));
console.log('✅ Translation service tests complete!\n');

