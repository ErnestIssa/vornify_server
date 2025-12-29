# Database Diagnostic Guide

## 🔍 Diagnostic Endpoints Created

### 1. Checkout Diagnostic
```
GET /api/checkout/diagnostic
```

This endpoint will:
- ✅ Test database connection to `peakmode` database
- ✅ Test reading from `abandoned_checkouts` collection
- ✅ Test creating a record in `abandoned_checkouts` collection
- ✅ Test reading the record back
- ✅ Clean up test record
- ✅ Verify route is registered

**Use this to verify:**
- Database connectivity
- Collection access
- Create/read operations work
- Route is registered correctly

---

## 📋 Comprehensive Logging Added

### Abandoned Checkout Email Capture

**When endpoint is hit:**
```
🔔 [CHECKOUT] Email capture endpoint HIT: { timestamp, hasEmail, email, cartItemsCount }
```

**When checking for existing checkout:**
```
🔍 [CHECKOUT] Checking for existing checkout: { email, database, collection }
🔍 [CHECKOUT] Existing checkout check result: { success, hasData, dataType }
```

**When creating new checkout:**
```
💾 [CHECKOUT] About to CREATE new checkout record: { database, collection, checkoutId, email, dataKeys }
💾 [CHECKOUT] Database save result: { success, status, message, error, data }
```

**When updating existing checkout:**
```
💾 [CHECKOUT] Attempting to update abandoned checkout: { checkoutId, email, hasCartItems, cartItemsCount, total }
💾 [CHECKOUT] Database update result: { success, status, message, error, data }
```

**On success:**
```
✅ [CHECKOUT] Email captured for abandoned checkout: { checkoutId, email, total, itemsCount }
```

**On failure:**
```
❌ [CHECKOUT] Failed to save abandoned checkout: { success, status, message, error, fullResult, database, collection, checkoutId, email }
```

### Payment Failure

**When endpoint is hit:**
```
🔔 [PAYMENT FAILURE] Payment failed endpoint HIT: { timestamp, hasOrderId, hasPaymentIntentId, orderId, paymentIntentId }
```

**When saveFailedCheckout is called:**
```
🔔 [PAYMENT FAILURE] saveFailedCheckout function CALLED: { timestamp, hasPaymentIntent, hasOrder, paymentIntentId, orderId, hasCustomerEmail }
```

**When saving:**
```
💾 [PAYMENT FAILURE] Attempting to save failed checkout: { id, email, total, itemsCount, retryToken }
💾 [PAYMENT FAILURE] Database save result: { success, status, message, error, data }
```

**On success:**
```
✅ [PAYMENT FAILURE] Failed checkout saved: { id, email, retryToken, total, itemsCount }
```

**On failure:**
```
❌ [PAYMENT FAILURE] Failed to save failed checkout: { success, status, message, error, fullResult }
```

---

## 🧪 Testing Checklist

### Step 1: Test Database Connectivity
```bash
GET /api/checkout/diagnostic
```

**Expected:**
- `readTest.success: true`
- `createTest.success: true`
- `readBackTest.success: true`

### Step 2: Test Abandoned Checkout Capture
```bash
POST /api/checkout/email-capture
{
  "email": "test@example.com",
  "cartItems": [{"name": "Test", "quantity": 1, "price": 100}],
  "total": 100
}
```

**Check logs for:**
- `🔔 [CHECKOUT] Email capture endpoint HIT` - Confirms endpoint was called
- `💾 [CHECKOUT] About to CREATE new checkout record` - Confirms it's trying to save
- `💾 [CHECKOUT] Database save result` - Shows database response
- `✅ [CHECKOUT] Email captured` - Confirms success

### Step 3: Test Payment Failure
```bash
POST /api/payments/payment-failed
{
  "orderId": "PM123456",
  "paymentIntentId": "pi_xxx"
}
```

**Check logs for:**
- `🔔 [PAYMENT FAILURE] Payment failed endpoint HIT` - Confirms endpoint was called
- `🔔 [PAYMENT FAILURE] saveFailedCheckout function CALLED` - Confirms function was called
- `💾 [PAYMENT FAILURE] Attempting to save failed checkout` - Confirms it's trying to save
- `💾 [PAYMENT FAILURE] Database save result` - Shows database response
- `✅ [PAYMENT FAILURE] Failed checkout saved` - Confirms success

---

## 🔍 Troubleshooting

### If endpoint is never hit:
- Check frontend is calling correct URL
- Check CORS settings
- Check route registration in `app.js`

### If endpoint is hit but save fails:
- Check `💾 Database save result` logs for error details
- Check database connection
- Check collection name is correct
- Check database name is correct

### If save succeeds but no records in database:
- Check if writing to different database (dev vs prod)
- Check if collection name is different
- Check database connection string in environment variables

---

## 📊 Database Configuration

**Database Name:** `peakmode`
**Collections:**
- `abandoned_checkouts` - For abandoned checkout emails
- `failed_checkouts` - For payment failure emails

**Verify these match your actual database configuration!**

