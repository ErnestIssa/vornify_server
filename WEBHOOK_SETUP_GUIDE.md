# Stripe Webhook Setup Guide

## ✅ Your Configuration

You've already configured:
- ✅ **Stripe Secret Key**: `sk_live_51SbSo5...` (Production)
- ✅ **Stripe Public Key**: `pk_live_51SbSo5...` (Production)
- ✅ **Webhook Secret**: `whsec_AwKmjultE2utaICZ4sJL2Q8bQpTYLHQY`

## 🔧 Webhook Configuration in Stripe Dashboard

### Step 1: Access Webhook Settings
1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Developers** → **Webhooks**
3. Click **"Add endpoint"** (or edit existing if you have one)

### Step 2: Configure Webhook Endpoint

**Endpoint URL:**
```
https://your-backend-domain.com/api/payments/webhook
```

Replace `your-backend-domain.com` with your actual Render deployment URL.

**Example:**
```
https://vornify-server.onrender.com/api/payments/webhook
```

### Step 3: Select Events to Listen To

Select these events:
- ✅ `payment_intent.succeeded`
- ✅ `payment_intent.payment_failed`
- ✅ `payment_intent.canceled`
- ✅ `charge.refunded`

### Step 4: Get Webhook Signing Secret

1. After creating the webhook, click on it
2. In the **"Signing secret"** section, click **"Reveal"**
3. Copy the webhook secret (should start with `whsec_`)
4. Verify it matches: `whsec_AwKmjultE2utaICZ4sJL2Q8bQpTYLHQY`

### Step 5: Test Webhook

1. In the webhook details page, click **"Send test webhook"**
2. Select event: `payment_intent.succeeded`
3. Check your server logs to verify it was received

---

## 🔍 Verify Configuration

### Check Configuration Endpoint

Test that your environment variables are loaded correctly:

```bash
GET https://your-backend-domain.com/api/payments/config
```

**Expected Response:**
```json
{
  "success": true,
  "stripe": {
    "secretKeyConfigured": true,
    "publicKeyConfigured": true,
    "webhookSecretConfigured": true,
    "secretKeyPrefix": "sk_live...",
    "publicKeyPrefix": "pk_live...",
    "mode": "production"
  }
}
```

### Check Server Logs

When your server starts, you should see:
```
✅ STRIPE_SECRET_KEY loaded (length: 107)
✅ STRIPE_PUBLIC_KEY loaded (prefix: pk_live...)
✅ STRIPE_WEBHOOK_SECRET loaded
✅ VornifyPay service initialized
```

---

## 🧪 Testing Webhooks Locally (Optional)

If you need to test webhooks locally during development:

### Using Stripe CLI

1. Install Stripe CLI: https://stripe.com/docs/stripe-cli
2. Login: `stripe login`
3. Forward webhooks: 
   ```bash
   stripe listen --forward-to localhost:10000/api/payments/webhook
   ```
4. Copy the webhook signing secret shown (starts with `whsec_`)
5. Add it to your local `.env` file

### Test Webhook Events

```bash
stripe trigger payment_intent.succeeded
```

---

## 📋 Webhook Event Flow

### When Payment Succeeds:
1. Customer completes payment on frontend
2. Stripe sends `payment_intent.succeeded` webhook
3. Backend receives webhook at `/api/payments/webhook`
4. Backend verifies webhook signature
5. Backend updates order:
   - Sets `paymentStatus: "succeeded"`
   - Updates order status to "processing"
   - Adds timeline entry
6. Backend sends order confirmation email
7. Backend returns 200 to Stripe

### When Payment Fails:
1. Stripe sends `payment_intent.payment_failed` webhook
2. Backend updates order:
   - Sets `paymentStatus: "failed"`
   - Adds timeline entry with error message

### When Payment is Refunded:
1. Admin processes refund via `/api/payments/refund`
2. Stripe sends `charge.refunded` webhook
3. Backend updates order:
   - Sets `paymentStatus: "refunded"` or `"partially_refunded"`
   - Adds timeline entry

---

## 🚨 Troubleshooting

### Webhook Not Receiving Events

1. **Check endpoint URL**: Ensure it's publicly accessible (not localhost)
2. **Check SSL**: Stripe requires HTTPS (except for local testing)
3. **Check logs**: Look for webhook signature verification errors
4. **Test endpoint**: Use Stripe Dashboard to send test webhook

### Webhook Signature Verification Fails

1. **Verify webhook secret**: Ensure `STRIPE_WEBHOOK_SECRET` matches the one in Stripe Dashboard
2. **Check raw body**: Webhook endpoint uses `express.raw()` for signature verification
3. **Check headers**: Ensure `stripe-signature` header is present

### Webhook Returns 500 Error

1. **Check server logs**: Look for error messages
2. **Verify database connection**: Webhook needs to update orders
3. **Check email service**: If email sending fails, webhook still returns 200

---

## 📝 Important Notes

1. **Always return 200**: Webhook endpoint must return 200 status code, even on errors, to prevent Stripe from retrying
2. **Idempotency**: Webhook handlers are designed to be idempotent (safe to process same event multiple times)
3. **Production vs Test**: You're using production keys (`sk_live_`), so all payments will be real
4. **Webhook Secret**: Keep this secret secure - it's used to verify webhook authenticity

---

## ✅ Checklist

- [ ] Webhook endpoint created in Stripe Dashboard
- [ ] Endpoint URL points to your production backend
- [ ] All 4 events selected (succeeded, failed, canceled, refunded)
- [ ] Webhook secret copied to `STRIPE_WEBHOOK_SECRET` environment variable
- [ ] Configuration endpoint returns all keys as configured
- [ ] Test webhook sent successfully from Stripe Dashboard
- [ ] Server logs show webhook received and processed

---

## 🎯 Next Steps

Once webhook is configured:
1. Test a real payment flow end-to-end
2. Monitor webhook events in Stripe Dashboard
3. Check server logs for webhook processing
4. Verify orders are updated correctly
5. Confirm confirmation emails are sent

Your Stripe integration is now ready for production! 🚀

