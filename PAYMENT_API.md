# Payment API Documentation

This document describes the Stripe payment integration endpoints for the Peak Mode backend.

## Environment Variables Required

```env
STRIPE_SECRET_KEY=sk_test_...  # Your Stripe secret key
STRIPE_PUBLIC_KEY=pk_test_...  # Your Stripe publishable key (for frontend)
STRIPE_WEBHOOK_SECRET=whsec_... # Webhook signing secret (from Stripe dashboard)
```

## Endpoints

### 1. Create Payment Intent

**POST** `/api/payments/create-intent`

Creates a Stripe payment intent for checkout processing.

**Request Body:**
```json
{
  "amount": 100.00,
  "currency": "sek",
  "orderId": "PM123456",
  "customerEmail": "customer@example.com",
  "paymentMethod": "card",
  "metadata": {
    "customField": "value"
  }
}
```

**Response:**
```json
{
  "success": true,
  "paymentIntentId": "pi_xxx",
  "clientSecret": "pi_xxx_secret_xxx",
  "amount": 100.00,
  "currency": "sek",
  "orderId": "PM123456"
}
```

**Notes:**
- The `clientSecret` should be used on the frontend with Stripe.js to confirm the payment
- The order will be automatically updated with the `paymentIntentId`
- If `customerEmail` is provided, a Stripe customer will be created or retrieved

---

### 2. Confirm Payment

**POST** `/api/payments/confirm`

Confirms payment completion after the frontend has processed the payment.

**Request Body:**
```json
{
  "paymentIntentId": "pi_xxx",
  "orderId": "PM123456"
}
```

**Response:**
```json
{
  "success": true,
  "paymentStatus": "succeeded",
  "orderId": "PM123456",
  "amount": 100.00,
  "currency": "sek"
}
```

**Notes:**
- This endpoint updates the order status based on the payment intent status
- If payment succeeded, order status is updated to "processing"
- Timeline entry is added to the order

---

### 3. Get Payment Status

**GET** `/api/payments/status/:paymentIntentId`

Retrieves the current status of a payment intent.

**Response:**
```json
{
  "success": true,
  "paymentIntentId": "pi_xxx",
  "status": "succeeded",
  "amount": 100.00,
  "currency": "sek",
  "orderId": "PM123456",
  "created": "2024-12-01T10:00:00.000Z"
}
```

**Possible Status Values:**
- `requires_payment_method` - Payment method needs to be attached
- `requires_confirmation` - Payment intent needs to be confirmed
- `requires_action` - Additional authentication required (3D Secure)
- `processing` - Payment is being processed
- `requires_capture` - Payment succeeded, needs capture
- `succeeded` - Payment succeeded
- `canceled` - Payment was canceled

---

### 4. Stripe Webhook

**POST** `/api/payments/webhook`

Handles Stripe webhook events for payment status updates.

**Headers:**
- `stripe-signature`: Stripe webhook signature (automatically sent by Stripe)

**Webhook Events Handled:**
- `payment_intent.succeeded` - Updates order payment status to "succeeded" and sends confirmation email
- `payment_intent.payment_failed` - Updates order payment status to "failed"
- `payment_intent.canceled` - Updates order payment status to "canceled"
- `charge.refunded` - Updates order payment status to "refunded"

**Response:**
```json
{
  "received": true
}
```

**Notes:**
- Webhook signature verification is performed automatically
- The webhook endpoint uses raw body parsing for signature verification
- Always returns 200 to acknowledge receipt (even on errors) to prevent Stripe retries

**Webhook Setup:**
1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://your-domain.com/api/payments/webhook`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`
4. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET` environment variable

---

### 5. Process Refund

**POST** `/api/payments/refund`

Processes a refund for a payment (admin use).

**Request Body:**
```json
{
  "paymentIntentId": "pi_xxx",
  "amount": 50.00,  // Optional - if not provided, full refund
  "reason": "requested_by_customer"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "refundId": "re_xxx",
  "amount": 50.00,
  "currency": "sek",
  "status": "succeeded",
  "orderId": "PM123456"
}
```

**Refund Reasons:**
- `duplicate` - Duplicate charge
- `fraudulent` - Fraudulent charge
- `requested_by_customer` - Customer requested refund

**Notes:**
- If `amount` is not provided, a full refund is processed
- Order status is updated to "refunded" or "partially_refunded"
- Timeline entry is added to the order

---

## Payment Flow

### Standard Checkout Flow

1. **Frontend**: User completes checkout form
2. **Frontend**: Calls `POST /api/orders/create` to create order
3. **Frontend**: Calls `POST /api/payments/create-intent` with order details
4. **Frontend**: Uses `clientSecret` with Stripe.js to process payment
5. **Frontend**: Calls `POST /api/payments/confirm` after payment confirmation
6. **Backend**: Webhook receives `payment_intent.succeeded` event
7. **Backend**: Updates order status and sends confirmation email

### Webhook Flow

1. **Stripe**: Sends webhook event to `/api/payments/webhook`
2. **Backend**: Verifies webhook signature
3. **Backend**: Processes event and updates order
4. **Backend**: Sends confirmation email (if payment succeeded)
5. **Backend**: Returns 200 to acknowledge receipt

---

## Order Schema Updates

Orders now include the following payment-related fields:

```javascript
{
  paymentStatus: "pending" | "succeeded" | "failed" | "canceled" | "refunded" | "partially_refunded",
  paymentIntentId: "pi_xxx",  // Stripe payment intent ID
  stripeCustomerId: "cus_xxx", // Stripe customer ID (optional)
  paymentMethod: "card" | "klarna" | "swish" | "apple_pay" | "google_pay" | "paypal"
}
```

---

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message",
  "code": "error_code"  // Optional
}
```

**Common Error Codes:**
- `payment_intent_creation_failed` - Failed to create payment intent
- `payment_confirmation_failed` - Failed to confirm payment
- `payment_status_retrieval_failed` - Failed to retrieve payment status
- `refund_failed` - Failed to process refund

---

## Security Considerations

1. **Never expose secret keys**: `STRIPE_SECRET_KEY` should never be sent to the frontend
2. **Webhook verification**: All webhooks are verified using the signing secret
3. **Amount validation**: Payment amounts are validated server-side
4. **Order validation**: Payment intents are linked to orders via metadata
5. **Error logging**: All payment errors are logged for debugging

---

## Testing

### Test Mode

Use Stripe test keys for development:
- Test secret key: `sk_test_...`
- Test publishable key: `pk_test_...`
- Test card: `4242 4242 4242 4242`

### Webhook Testing

Use Stripe CLI for local webhook testing:
```bash
stripe listen --forward-to localhost:10000/api/payments/webhook
```

---

## Legacy Endpoint

The legacy payment endpoint is still available for backward compatibility:

**POST** `/api/vornifypay`

This endpoint uses the VornifyPay service wrapper and supports the existing payment processing format.

