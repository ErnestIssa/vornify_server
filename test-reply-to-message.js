const getDB = require('./vornifydb/dbInstance');
const emailService = require('./services/emailService');
require('dotenv').config();

async function testReplyToMessage() {
    const db = getDB();
    // Using a real message ID that exists in the database (old format: website_contact_form, unread)
    const messageId = '6914a6ce8041f6493050190a'; // Real message from ernestissa32@gmail.com
    
    console.log(`🔍 Step 1: Finding message ${messageId}...\n`);
    
    // Try to find the message using the same logic as the backend
    const CONTACT_COLLECTIONS = ['contact_messages', 'support_messages'];
    let foundMessage = null;
    let foundCollection = null;
    
    for (const collectionName of CONTACT_COLLECTIONS) {
        try {
            // Try different filter variants
            const filters = [
                { _id: messageId },
                { id: messageId },
                { ticketId: messageId }
            ];
            
            // Try ObjectId if it looks like one (must be first to try)
            if (/^[0-9a-fA-F]{24}$/.test(messageId)) {
                try {
                    const { ObjectId } = require('mongodb');
                    filters.unshift({ _id: new ObjectId(messageId) });
                    console.log(`   Trying ObjectId conversion for: ${messageId}`);
                } catch (oidError) {
                    console.log(`   ⚠️ Could not convert to ObjectId: ${oidError.message}`);
                }
            }
            
            for (const filter of filters) {
                // readRecords expects the query directly, not wrapped in a 'filter' property
                const result = await db.executeOperation({
                    database_name: 'peakmode',
                    collection_name: collectionName,
                    command: '--read',
                    data: filter  // Pass filter directly, not wrapped
                });
                
                if (result.success && result.data) {
                    foundMessage = result.data;
                    foundCollection = collectionName;
                    console.log(`✅ Found message in ${collectionName} using filter:`, Object.keys(filter)[0]);
                    break;
                }
            }
            
            if (foundMessage) break;
        } catch (error) {
            console.error(`⚠️ Error checking ${collectionName}:`, error.message);
        }
    }
    
    if (!foundMessage) {
        console.error('❌ Message not found!');
        process.exit(1);
    }
    
    console.log(`\n📋 Message details:`);
    console.log(`   Collection: ${foundCollection}`);
    console.log(`   Source: ${foundMessage.source || 'N/A'}`);
    console.log(`   Status: ${foundMessage.status || 'N/A'}`);
    console.log(`   Email: ${foundMessage.email || foundMessage.customer?.email || 'N/A'}`);
    console.log(`   Subject: ${foundMessage.subject || 'N/A'}`);
    console.log(`   Has thread: ${Array.isArray(foundMessage.thread) ? 'Yes' : 'No'}`);
    console.log(`   Has customer object: ${foundMessage.customer ? 'Yes' : 'No'}\n`);
    
    const customerEmail = foundMessage.email || foundMessage.customer?.email;
    const customerName = foundMessage.name || foundMessage.customer?.name || 'Customer';
    const ticketId = foundMessage.ticketId || foundMessage.ticket || foundMessage.id || messageId;
    
    if (!customerEmail) {
        console.error('❌ No customer email found in message!');
        process.exit(1);
    }
    
    console.log(`📨 Step 2: Sending test reply email...\n`);
    
    try {
        const emailResult = await emailService.sendSupportReplyEmail({
            to: customerEmail,
            name: customerName,
            replyMessage: 'This is a test reply from the backend after fixing old message format compatibility. If you receive this email, the reply system is working correctly with old-format messages!',
            subject: foundMessage.subject || 'Support Request',
            ticketId: ticketId
        });
        
        if (emailResult.success) {
            console.log('✅ Reply email sent successfully!');
            console.log(`   To: ${customerEmail}`);
            console.log(`   Message ID: ${emailResult.messageId || 'N/A'}`);
            console.log(`   Timestamp: ${emailResult.timestamp || 'N/A'}\n`);
            console.log('✅ Test completed successfully!');
            console.log(`\n📝 Next: Test the API endpoint:`);
            console.log(`   curl -X POST https://vornify-server.onrender.com/api/support/messages/${messageId}/reply \\`);
            console.log(`     -H "Content-Type: application/json" \\`);
            console.log(`     -d '{"message":"Test reply via API"}'`);
        } else {
            console.error('❌ Failed to send reply email:', emailResult.error);
            console.error('   Details:', emailResult.details);
        }
    } catch (error) {
        console.error('❌ Error sending reply email:', error.message);
        console.error('   Stack:', error.stack);
    }
    
    process.exit(0);
}

testReplyToMessage().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

