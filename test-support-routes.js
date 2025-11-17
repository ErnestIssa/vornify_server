const getDB = require('./vornifydb/dbInstance');
require('dotenv').config();

async function testRoutes() {
    const db = getDB();
    
    // Find a message from the test email
    console.log('🔍 Looking for messages from ernestissa32@gmail.com...');
    const result = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'contact_messages',
        command: '--read',
        data: {}
    });
    
    if (result.success && result.data) {
        const messages = Array.isArray(result.data) ? result.data : [result.data];
        const testMessage = messages.find(m => 
            (m.email && m.email.toLowerCase().includes('ernestissa32')) ||
            (m.customer && m.customer.email && m.customer.email.toLowerCase().includes('ernestissa32'))
        ) || messages[0];
        
        if (testMessage) {
            const messageId = testMessage._id || testMessage.id || testMessage.ticketId;
            console.log(`✅ Found message: ${messageId}`);
            console.log(`   Email: ${testMessage.email || testMessage.customer?.email}`);
            console.log(`   Subject: ${testMessage.subject || 'N/A'}`);
            console.log(`\n📝 Test these endpoints:`);
            console.log(`   PATCH https://vornify-server.onrender.com/api/support/messages/${messageId}`);
            console.log(`   POST https://vornify-server.onrender.com/api/support/messages/${messageId}/reply`);
            return messageId;
        } else {
            console.log('❌ No messages found');
        }
    } else {
        console.log('❌ Failed to fetch messages:', result.error);
    }
    
    process.exit(0);
}

testRoutes().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

