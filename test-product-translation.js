/**
 * Test script to check if product has Swedish translations and test translation service
 */

require('dotenv').config();
const getDBInstance = require('./vornifydb/dbInstance');
const translationService = require('./services/translationService');

const db = getDBInstance();
const productId = '68d93ed5b8c5f8165f3b813a';

async function testProductTranslation() {
    try {
        console.log('🧪 Testing Product Translation\n');
        console.log('='.repeat(60));
        
        // Wait for DB connection
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Fetch the product - try both id and _id
        console.log(`\n📦 Fetching product: ${productId}`);
        let result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id: productId }
        });
        
        // If not found by id, try _id
        if (!result.success || !result.data) {
            console.log('   Trying _id instead...');
            const { ObjectId } = require('mongodb');
            try {
                result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--read',
                    data: { _id: new ObjectId(productId) }
                });
            } catch (e) {
                // Try as string
                result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--read',
                    data: { _id: productId }
                });
            }
        }
        
        // If still not found, get all products to see the structure
        if (!result.success || !result.data) {
            console.log('   Product not found by id/_id, fetching all products to check structure...');
            const allProducts = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: 'products',
                command: '--read',
                data: {}
            });
            
            if (allProducts.success && allProducts.data) {
                const products = Array.isArray(allProducts.data) ? allProducts.data : [allProducts.data];
                console.log(`   Found ${products.length} products`);
                if (products.length > 0) {
                    const firstProduct = products[0];
                    console.log(`   First product keys: ${Object.keys(firstProduct).join(', ')}`);
                    console.log(`   First product id: ${firstProduct.id || firstProduct._id}`);
                    result = { success: true, data: firstProduct };
                }
            }
        }
        
        if (!result.success || !result.data) {
            console.error('❌ Product not found!');
            process.exit(1);
        }
        
        const product = result.data;
        console.log('✅ Product fetched successfully\n');
        
        // Check what fields the product has
        console.log('📋 Product Fields:');
        console.log('   All keys:', Object.keys(product).join(', '));
        console.log('\n   Swedish translation fields:');
        const svFields = Object.keys(product).filter(k => k.endsWith('_sv'));
        if (svFields.length > 0) {
            svFields.forEach(field => {
                const value = product[field];
                if (typeof value === 'string') {
                    console.log(`   ✅ ${field}: ${value.substring(0, 60)}...`);
                } else if (Array.isArray(value)) {
                    console.log(`   ✅ ${field}: [${value.length} items]`);
                } else {
                    console.log(`   ✅ ${field}: ${typeof value}`);
                }
            });
        } else {
            console.log('   ❌ No _sv fields found!');
        }
        
        // Check specific fields
        console.log('\n🔍 Checking specific fields:');
        console.log(`   description: ${product.description ? 'EXISTS' : 'MISSING'} (${typeof product.description})`);
        console.log(`   description_sv: ${product.description_sv ? 'EXISTS' : 'MISSING'} (${typeof product.description_sv})`);
        console.log(`   shortDescription: ${product.shortDescription ? 'EXISTS' : 'MISSING'}`);
        console.log(`   shortDescription_sv: ${product.shortDescription_sv ? 'EXISTS' : 'MISSING'}`);
        console.log(`   shippingInfo: ${product.shippingInfo ? 'EXISTS' : 'MISSING'} (${Array.isArray(product.shippingInfo) ? 'array' : typeof product.shippingInfo})`);
        console.log(`   shippingInfo_sv: ${product.shippingInfo_sv ? 'EXISTS' : 'MISSING'} (${Array.isArray(product.shippingInfo_sv) ? 'array' : typeof product.shippingInfo_sv})`);
        
        // Test translation service
        console.log('\n🌐 Testing Translation Service:');
        console.log('   Requesting Swedish translation...\n');
        
        const translated = translationService.translateProduct(product, 'sv');
        
        console.log('\n📊 Translation Results:');
        console.log(`   description: ${translated.description === product.description ? '❌ NOT TRANSLATED' : '✅ TRANSLATED'}`);
        if (translated.description !== product.description) {
            console.log(`      Original: ${product.description.substring(0, 60)}...`);
            console.log(`      Translated: ${translated.description.substring(0, 60)}...`);
        }
        
        console.log(`   shortDescription: ${translated.shortDescription === product.shortDescription ? '❌ NOT TRANSLATED' : '✅ TRANSLATED'}`);
        if (translated.shortDescription !== product.shortDescription) {
            console.log(`      Original: ${product.shortDescription}`);
            console.log(`      Translated: ${translated.shortDescription}`);
        }
        
        console.log(`   shippingInfo: ${JSON.stringify(translated.shippingInfo) === JSON.stringify(product.shippingInfo) ? '❌ NOT TRANSLATED' : '✅ TRANSLATED'}`);
        if (JSON.stringify(translated.shippingInfo) !== JSON.stringify(product.shippingInfo)) {
            console.log(`      Original: ${JSON.stringify(product.shippingInfo)}`);
            console.log(`      Translated: ${JSON.stringify(translated.shippingInfo)}`);
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ Test complete!\n');
        
        // Close connection
        if (db.client) {
            await db.client.close();
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

testProductTranslation();

