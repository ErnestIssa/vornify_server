/**
 * Test script to check Apple Pay domain verification status
 * Run this to test if the verification file route is working
 * 
 * Usage: node test-apple-pay-route.js
 */

const https = require('https');

const domains = [
    'peakmode.se',
    'www.peakmode.se'
];

const testRoute = (domain) => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: domain,
            path: '/.well-known/apple-developer-merchantid-domain-association',
            method: 'GET',
            headers: {
                'User-Agent': 'ApplePay-Domain-Verification-Test/1.0'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve({
                    domain,
                    statusCode: res.statusCode,
                    contentType: res.headers['content-type'],
                    contentLength: data.length,
                    content: data.substring(0, 100), // First 100 chars
                    success: res.statusCode === 200
                });
            });
        });

        req.on('error', (error) => {
            reject({
                domain,
                error: error.message
            });
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject({
                domain,
                error: 'Request timeout'
            });
        });

        req.end();
    });
};

const testVerifyEndpoint = (domain) => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: domain,
            path: '/api/apple-pay/verify',
            method: 'GET'
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({
                        domain,
                        ...json
                    });
                } catch (e) {
                    resolve({
                        domain,
                        rawResponse: data
                    });
                }
            });
        });

        req.on('error', (error) => {
            reject({
                domain,
                error: error.message
            });
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject({
                domain,
                error: 'Request timeout'
            });
        });

        req.end();
    });
};

async function runTests() {
    console.log('🧪 Testing Apple Pay Domain Verification\n');
    console.log('='.repeat(60));

    // Test verification file route
    console.log('\n📄 Testing Verification File Route:');
    console.log('-'.repeat(60));

    for (const domain of domains) {
        try {
            const result = await testRoute(domain);
            console.log(`\n🌐 ${domain}:`);
            console.log(`   Status: ${result.statusCode}`);
            console.log(`   Content-Type: ${result.contentType || 'N/A'}`);
            console.log(`   Content Length: ${result.contentLength} bytes`);
            
            if (result.success) {
                console.log(`   ✅ File is accessible!`);
                console.log(`   Preview: ${result.content}...`);
            } else {
                console.log(`   ❌ File not found (404 expected if file not added)`);
            }
        } catch (error) {
            console.log(`\n🌐 ${domain}:`);
            console.log(`   ❌ Error: ${error.error}`);
        }
    }

    // Test verification endpoint
    console.log('\n\n🔍 Testing Verification Status Endpoint:');
    console.log('-'.repeat(60));

    for (const domain of domains) {
        try {
            const result = await testVerifyEndpoint(domain);
            console.log(`\n🌐 ${domain}:`);
            console.log(`   File Exists: ${result.fileExists ? '✅ Yes' : '❌ No'}`);
            console.log(`   Env Var Exists: ${result.envVarExists ? '✅ Yes' : '❌ No'}`);
            console.log(`   File Source: ${result.fileSource || 'None'}`);
            console.log(`   Success: ${result.success ? '✅' : '❌'}`);
        } catch (error) {
            console.log(`\n🌐 ${domain}:`);
            console.log(`   ❌ Error: ${error.error}`);
        }
    }

    console.log('\n\n' + '='.repeat(60));
    console.log('✅ Testing complete!');
    console.log('\n📋 Next Steps:');
    console.log('   1. If all tests show ❌, add verification file or env var');
    console.log('   2. If tests show ✅, domains are ready for Apple Pay');
    console.log('   3. Test Apple Pay on mobile Safari to confirm');
}

runTests().catch(console.error);

