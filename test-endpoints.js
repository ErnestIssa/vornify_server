const http = require('http');

const BASE_URL = 'https://vornify-server.onrender.com';
const TEST_MESSAGE_ID = '691b44b3dee5c4bec412ca64'; // From the error logs

async function testEndpoint(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: body
                });
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

async function runTests() {
    console.log('🧪 Testing support message endpoints...\n');

    // Test 1: Test route
    console.log('1. Testing GET /api/support/test...');
    try {
        const result = await testEndpoint('GET', '/api/support/test');
        console.log(`   Status: ${result.status}`);
        console.log(`   Response: ${result.body}\n`);
    } catch (error) {
        console.log(`   Error: ${error.message}\n`);
    }

    // Test 2: PATCH route
    console.log('2. Testing PATCH /api/support/messages/:id...');
    try {
        const result = await testEndpoint('PATCH', `/api/support/messages/${TEST_MESSAGE_ID}`, { status: 'read' });
        console.log(`   Status: ${result.status}`);
        console.log(`   Response: ${result.body.substring(0, 200)}...\n`);
    } catch (error) {
        console.log(`   Error: ${error.message}\n`);
    }

    // Test 3: POST reply route
    console.log('3. Testing POST /api/support/messages/:id/reply...');
    try {
        const result = await testEndpoint('POST', `/api/support/messages/${TEST_MESSAGE_ID}/reply`, { 
            message: 'Test reply from backend verification script' 
        });
        console.log(`   Status: ${result.status}`);
        console.log(`   Response: ${result.body.substring(0, 200)}...\n`);
    } catch (error) {
        console.log(`   Error: ${error.message}\n`);
    }

    process.exit(0);
}

runTests();

