# Email Service

## Overview

This directory contains the core email service using SendGrid for all email communications.

## Files

- **emailService.js** - Main SendGrid email service class with all email functions

## Usage

```javascript
const emailService = require('./services/emailService');

// Send a welcome email
const result = await emailService.sendWelcomeEmail(
  'user@example.com',
  'John Doe'
);

if (result.success) {
  console.log('Email sent successfully!');
} else {
  console.error('Email failed:', result.error);
}
```

## Available Functions

All functions return a Promise with the following response format:

**Success:**
```json
{
  "success": true,
  "message": "Email sent successfully",
  "messageId": "xxxxxxxx",
  "timestamp": "2025-10-08T12:00:00.000Z"
}
```

**Error:**
```json
{
  "success": false,
  "error": "Failed to send email",
  "details": "Error details here"
}
```

### Core Functions

1. `sendCustomEmail(to, subject, templateId, dynamicData)` - Generic template email
2. `sendWelcomeEmail(to, name)` - Welcome email
3. `sendOrderConfirmationEmail(to, name, orderDetails)` - Order confirmation
4. `sendPasswordResetEmail(to, resetLink)` - Password reset
5. `sendNewsletterWelcomeEmail(to, name, discountCode)` - Newsletter welcome
6. `sendOrderProcessingEmail(to, orderDetails)` - Order processing
7. `sendShippingNotificationEmail(to, orderDetails)` - Shipping notification
8. `sendDeliveryConfirmationEmail(to, orderDetails)` - Delivery confirmation
9. `sendReviewRequestEmail(to, orderDetails)` - Review request
10. `sendDiscountReminderEmail(to, name, discountCode)` - Discount reminder
11. `verifyConnection()` - Verify SendGrid API connection

## Configuration

All configuration is done through environment variables in `.env`:

```env
SENDGRID_API_KEY=your_api_key_here
EMAIL_FROM=support@peakmode.se
```

See `EMAIL_SETUP_GUIDE.md` in the root directory for full setup instructions.

## Error Handling

The service includes comprehensive error handling:

- Validates required parameters
- Catches SendGrid API errors
- Logs errors to console
- Returns user-friendly error messages
- Never throws exceptions (returns error objects instead)

## Testing

Use the email testing endpoints to test all email templates:

```
GET /api/email-test/test/confirmation?email=test@example.com
GET /api/email-test/test-all?email=test@example.com
```

## Security

- Never commit API keys to version control
- Always use verified sender addresses
- Validate all email addresses before sending
- Use environment variables for all sensitive data

## Dependencies

- `@sendgrid/mail` - SendGrid Node.js library
- `dotenv` - Environment variable management

## Support

For detailed documentation, see:
- `EMAIL_SETUP_GUIDE.md` - Complete setup and usage guide
- SendGrid Docs: https://docs.sendgrid.com/

