/**
 * Test the new product to verify translations work
 */

require('dotenv').config();
const getDBInstance = require('./vornifydb/dbInstance');
const translationService = require('./services/translationService');

const db = getDBInstance();
const productId = '692869e5b7dd33b5471c7e7e';

async function testNewProduct() {
    try {
        console.log('🧪 Testing New Product Translation\n');
        console.log('='.repeat(60));
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Try both id and _id
        console.log(`\n📦 Fetching product: ${productId}`);
        let result = await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'products',
            command: '--read',
            data: { id: productId }
        });
        
        if (!result.success || !result.data) {
            const { ObjectId } = require('mongodb');
            try {
                result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--read',
                    data: { _id: new ObjectId(productId) }
                });
            } catch (e) {
                result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: 'products',
                    command: '--read',
                    data: { _id: productId }
                });
            }
        }
        
        if (!result.success || !result.data) {
            console.error('❌ Product not found!');
            process.exit(1);
        }
        
        const product = result.data;
        console.log('✅ Product fetched\n');
        
        // Check for Swedish fields
        console.log('📋 Swedish Translation Fields:');
        const svFields = Object.keys(product).filter(k => k.endsWith('_sv'));
        if (svFields.length > 0) {
            svFields.forEach(field => {
                const value = product[field];
                if (typeof value === 'string') {
                    console.log(`   ✅ ${field}: ${value.substring(0, 80)}...`);
                } else if (Array.isArray(value)) {
                    console.log(`   ✅ ${field}: ${JSON.stringify(value)}`);
                }
            });
        } else {
            console.log('   ❌ No _sv fields found!');
        }
        
        // Test translation
        console.log('\n🌐 Testing Translation Service:');
        console.log('   Requesting Swedish translation...\n');
        
        const translated = translationService.translateProduct(product, 'sv');
        
        console.log('\n📊 Translation Results:');
        console.log(`   description: ${translated.description === product.description ? '❌ NOT TRANSLATED' : '✅ TRANSLATED'}`);
        if (translated.description !== product.description) {
            console.log(`      English: ${product.description.substring(0, 60)}...`);
            console.log(`      Swedish: ${translated.description.substring(0, 60)}...`);
        } else {
            console.log(`      Value: ${product.description.substring(0, 60)}...`);
            console.log(`      Has description_sv: ${product.description_sv ? 'YES' : 'NO'}`);
        }
        
        console.log(`   shortDescription: ${translated.shortDescription === product.shortDescription ? '❌ NOT TRANSLATED' : '✅ TRANSLATED'}`);
        console.log(`   shippingInfo: ${JSON.stringify(translated.shippingInfo) === JSON.stringify(product.shippingInfo) ? '❌ NOT TRANSLATED' : '✅ TRANSLATED'}`);
        if (JSON.stringify(translated.shippingInfo) !== JSON.stringify(product.shippingInfo)) {
            console.log(`      English: ${JSON.stringify(product.shippingInfo)}`);
            console.log(`      Swedish: ${JSON.stringify(translated.shippingInfo)}`);
        }
        
        console.log('\n' + '='.repeat(60));
        
        if (db.client) {
            await db.client.close();
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

testNewProduct();

