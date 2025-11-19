const currencyService = require('./services/currencyService');
require('dotenv').config();

async function testECBIntegration() {
    console.log('🧪 Testing ECB Exchange Rate Integration\n');
    
    try {
        // Test 1: Update rates from ECB
        console.log('1️⃣ Testing rate update from ECB...\n');
        const updateResult = await currencyService.updateExchangeRates();
        
        if (updateResult.success) {
            console.log('✅ Rate update successful!');
            console.log(`   Updated: ${updateResult.updated} currencies`);
            console.log(`   Source: ${updateResult.source}`);
            console.log(`   Fetched from ECB: ${updateResult.fetchedFromECB ? 'Yes' : 'No'}`);
            console.log(`   Timestamp: ${updateResult.timestamp}\n`);
            
            if (updateResult.rates && updateResult.rates.length > 0) {
                console.log('   Rates updated:');
                updateResult.rates.forEach(({ currency, rate, source }) => {
                    console.log(`     ${currency}: ${rate} (${source})`);
                });
            }
        } else {
            console.log('❌ Rate update failed:', updateResult.error);
        }
        
        console.log('\n2️⃣ Testing currency conversion...\n');
        
        // Test 2: Convert EUR to SEK
        const conversion1 = await currencyService.convertCurrency(100, 'EUR', 'SEK');
        console.log(`   Convert 100 EUR to SEK:`);
        console.log(`     Result: ${conversion1.convertedAmount} SEK`);
        console.log(`     Rate: ${conversion1.rate}`);
        console.log(`     Success: ${conversion1.success}\n`);
        
        // Test 3: Convert SEK to EUR
        const conversion2 = await currencyService.convertCurrency(1000, 'SEK', 'EUR');
        console.log(`   Convert 1000 SEK to EUR:`);
        console.log(`     Result: ${conversion2.convertedAmount} EUR`);
        console.log(`     Rate: ${conversion2.rate}`);
        console.log(`     Success: ${conversion2.success}\n`);
        
        // Test 4: Get all supported currencies
        console.log('3️⃣ Testing get supported currencies...\n');
        const currencies = await currencyService.getSupportedCurrencies();
        if (currencies.success) {
            console.log(`   Base Currency: ${currencies.baseCurrency}`);
            console.log(`   Last Updated: ${currencies.lastUpdated}`);
            console.log(`   Supported Currencies: ${currencies.currencies.length}\n`);
            currencies.currencies.slice(0, 5).forEach(curr => {
                console.log(`     ${curr.code}: ${curr.symbol} - Rate: ${curr.rate}`);
            });
        }
        
        console.log('\n✅ All tests completed!\n');
        console.log('📝 Next steps:');
        console.log('   1. Set up cron job on Render to call POST /api/settings/currencies/update daily');
        console.log('   2. Test the endpoint: curl -X POST https://your-server.com/api/settings/currencies/update');
        console.log('   3. Verify rates are stored in database');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        console.error('   Stack:', error.stack);
    }
    
    process.exit(0);
}

testECBIntegration();

