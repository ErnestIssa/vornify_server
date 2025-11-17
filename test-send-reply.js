const getDB = require('./vornifydb/dbInstance');
const emailService = require('./services/emailService');
require('dotenv').config();

async function findAndReplyToMessage() {
    const db = getDB();
    
    console.log('🔍 Step 1: Finding message from ernestissa32@gmail.com...\n');
    
    // Find messages
    const result = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'contact_messages',
        command: '--read',
        data: {}
    });
    
    if (!result.success) {
        console.error('❌ Failed to fetch messages:', result.error);
        process.exit(1);
    }
    
    const messages = Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);
    console.log(`📊 Found ${messages.length} total messages`);
    
    // Find message from test email
    const testMessage = messages.find(m => {
        const email = (m.email || m.customer?.email || '').toLowerCase();
        return email.includes('ernestissa32');
    });
    
    if (!testMessage) {
        console.log('❌ No message found from ernestissa32@gmail.com');
        console.log('   Using first available message instead...\n');
        if (messages.length === 0) {
            console.error('❌ No messages found in database');
            process.exit(1);
        }
        var messageToReply = messages[0];
    } else {
        var messageToReply = testMessage;
    }
    
    const messageId = messageToReply._id || messageToReply.id || messageToReply.ticketId;
    const customerEmail = messageToReply.email || messageToReply.customer?.email;
    const customerName = messageToReply.name || messageToReply.customer?.name || 'Customer';
    
    console.log(`✅ Found message: ${messageId}`);
    console.log(`   From: ${customerEmail}`);
    console.log(`   Subject: ${messageToReply.subject || 'N/A'}\n`);
    
    console.log('📨 Step 2: Sending reply via email service...\n');
    
    // Send reply email
    try {
        const emailResult = await emailService.sendSupportReplyEmail({
            to: customerEmail,
            name: customerName,
            replyMessage: 'This is a test reply from the backend verification script. If you receive this, the email service is working correctly!',
            subject: messageToReply.subject || 'Support Request',
            ticketId: messageToReply.ticketId || messageId
        });
        
        if (emailResult.success) {
            console.log('✅ Reply email sent successfully!');
            console.log(`   Message ID: ${emailResult.messageId || 'N/A'}`);
            console.log(`   Timestamp: ${emailResult.timestamp || 'N/A'}\n`);
        } else {
            console.error('❌ Failed to send reply email:', emailResult.error);
            console.error('   Details:', emailResult.details);
        }
    } catch (error) {
        console.error('❌ Error sending reply email:', error.message);
    }
    
    console.log('\n📝 Step 3: Testing API endpoints...\n');
    console.log('   To test the API endpoints, use:');
    console.log(`   curl -X PATCH https://vornify-server.onrender.com/api/support/messages/${messageId} \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"status":"read"}'`);
    console.log(`\n   curl -X POST https://vornify-server.onrender.com/api/support/messages/${messageId}/reply \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"message":"Test reply"}'`);
    
    process.exit(0);
}

findAndReplyToMessage().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

