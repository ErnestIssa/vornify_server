const getDB = require('./vornifydb/dbInstance');
require('dotenv').config();

async function findAllMessages() {
    const db = getDB();
    const CONTACT_COLLECTIONS = ['contact_messages', 'support_messages'];
    
    console.log('🔍 Searching for all messages...\n');
    
    for (const collectionName of CONTACT_COLLECTIONS) {
        try {
            const result = await db.executeOperation({
                database_name: 'peakmode',
                collection_name: collectionName,
                command: '--read',
                data: {}
            });
            
            if (result.success && result.data) {
                const messages = Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);
                console.log(`📊 Collection: ${collectionName} - Found ${messages.length} messages`);
                
                if (messages.length > 0) {
                    messages.slice(0, 5).forEach((msg, idx) => {
                        const id = msg._id || msg.id || msg.ticketId;
                        const email = msg.email || msg.customer?.email || 'N/A';
                        const source = msg.source || 'N/A';
                        const status = msg.status || 'N/A';
                        console.log(`   ${idx + 1}. ID: ${id}`);
                        console.log(`      Email: ${email}`);
                        console.log(`      Source: ${source}`);
                        console.log(`      Status: ${status}`);
                        console.log(`      Subject: ${msg.subject || 'N/A'}`);
                        console.log('');
                    });
                    
                    if (messages.length > 5) {
                        console.log(`   ... and ${messages.length - 5} more messages\n`);
                    }
                }
            } else {
                console.log(`   No messages found in ${collectionName}\n`);
            }
        } catch (error) {
            console.error(`⚠️ Error reading ${collectionName}:`, error.message);
        }
    }
    
    process.exit(0);
}

findAllMessages().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

