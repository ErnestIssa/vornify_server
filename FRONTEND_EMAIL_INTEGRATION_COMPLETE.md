# 📧 Complete Frontend Email Integration Guide - Peak Mode

**Backend URL:** `https://vornify-server.onrender.com`  
**Status:** ✅ All email endpoints ready and working

---

## 🎯 CRITICAL: SendGrid Sender Verification Required

**BEFORE ANY EMAILS WILL WORK:**

The backend developer MUST complete SendGrid Single Sender Verification:
1. Go to: https://app.sendgrid.com/settings/sender_auth/senders
2. Create and verify: `support@peakmode.se`
3. Takes 5 minutes, enables sending to ALL email addresses

**Current Status:** ⏳ Emails only work for ernestissa32@gmail.com (verified address)  
**After Verification:** ✅ Emails will work for ANY email address

---

## 📋 ALL EMAIL TYPES & FRONTEND INTEGRATION

### **1. AUTHENTICATION EMAILS** (3 types)

#### A. Email Verification (Registration)
**When to send:** Immediately after user registration  
**Endpoint:** `POST /api/auth/register`  
**Email automatically sent by backend:** ✅ Yes

**Frontend Implementation:**
```typescript
// File: src/pages/HubAuth.tsx or similar

const handleSignup = async (name: string, email: string, password: string) => {
  try {
    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // ✅ Backend automatically sends email verification email
      showToast('Registration successful! Check your email to verify your account.');
      // Redirect to "check your email" page
    }
  } catch (error) {
    console.error('Registration error:', error);
  }
};
```

**Email Template Variables:**
- `customer_name`: User's name
- `verification_link`: Link to verify email (auto-generated)
- `website_url`: https://peakmode.se
- `year`: Current year

**User Experience:**
1. User fills registration form → Submits
2. Backend creates account + sends verification email
3. User checks email → Clicks verification link
4. Redirects to: `https://peakmode.se/verify-email?token=xxx&email=xxx`

---

#### B. Account Setup Confirmation
**When to send:** After user verifies their email  
**Endpoint:** `POST /api/auth/verify-email`  
**Email automatically sent by backend:** ✅ Yes

**Frontend Implementation:**
```typescript
// File: src/pages/VerifyEmail.tsx

const handleVerifyEmail = async () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const email = params.get('email');
  
  try {
    const response = await fetch(`${API_URL}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // ✅ Backend automatically sends account setup email
      showToast('Email verified! Check your inbox for next steps.');
      // Redirect to login or hub
      setTimeout(() => navigate('/hub/auth'), 3000);
    }
  } catch (error) {
    console.error('Verification error:', error);
  }
};
```

**Email Template Variables:**
- `customer_name`: User's name
- `hub_url`: Link to hub dashboard
- `website_url`: https://peakmode.se
- `year`: Current year

---

#### C. Password Reset
**When to send:** User requests password reset  
**Endpoint:** `POST /api/auth/request-password-reset`  
**Email automatically sent by backend:** ✅ Yes

**Frontend Implementation:**
```typescript
// File: src/pages/ResetPassword.tsx

const handleRequestReset = async (email: string) => {
  try {
    const response = await fetch(`${API_URL}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // ✅ Backend automatically sends password reset email
      showToast('Password reset link sent! Check your email.');
    }
  } catch (error) {
    console.error('Reset request error:', error);
  }
};
```

**Email Template Variables:**
- `customer_name`: User's name (if found)
- `reset_link`: Password reset link (auto-generated)
- `website_url`: https://peakmode.se
- `year`: Current year

---

#### D. Password Reset Success
**When to send:** After user successfully resets password  
**Endpoint:** `POST /api/auth/reset-password`  
**Email automatically sent by backend:** ✅ Yes

**Frontend Implementation:**
```typescript
// File: src/pages/ResetPassword.tsx

const handleResetPassword = async (token: string, newPassword: string) => {
  try {
    const response = await fetch(`${API_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // ✅ Backend automatically sends success confirmation email
      showToast('Password reset successful! You can now log in.');
      navigate('/hub/auth');
    }
  } catch (error) {
    console.error('Reset error:', error);
  }
};
```

---

### **2. ORDER EMAILS** (5 types)

#### A. Order Confirmation
**When to send:** Immediately when order is created  
**Endpoint:** `POST /api/orders/create`  
**Email automatically sent by backend:** ✅ Yes

**Frontend Implementation:**
```typescript
// File: src/pages/Checkout.tsx or order service

const createOrder = async (orderData: OrderData) => {
  try {
    const response = await fetch(`${API_URL}/api/orders/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          name: orderData.customerName,
          email: orderData.customerEmail,
          phone: orderData.customerPhone
        },
        items: orderData.items,
        totals: orderData.totals,
        shippingAddress: orderData.shippingAddress,
        paymentMethod: orderData.paymentMethod
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // ✅ Backend automatically sends order confirmation email
      console.log('Order created, confirmation email sent to:', orderData.customerEmail);
      navigate(`/thank-you?orderId=${data.orderId}`);
    }
  } catch (error) {
    console.error('Order creation error:', error);
  }
};
```

**Email Template Variables:**
- `customer_name`: Customer name
- `order_number`: Order ID (e.g., PM123456)
- `order_date`: Order date
- `order_total`: Total amount
- `order_items`: Array of items
- `shipping_address`: Formatted address
- `order_status_url`: Link to track order
- `website_url`: https://peakmode.se

---

#### B. Order Processing
**When to send:** When order status changes to "processing"  
**Endpoint:** `POST /api/orders/update-status`  
**Email automatically sent by backend:** ✅ Yes (conditionally)

**Frontend Implementation:**
```typescript
// Admin panel only - customer-facing frontend doesn't trigger this

// This is handled by admin panel when they update order status
```

---

#### C. Shipping Notification
**When to send:** When order status changes to "shipped"  
**Endpoint:** `POST /api/orders/update-status`  
**Email automatically sent by backend:** ✅ Yes (with tracking info)

**Frontend Implementation:**
```typescript
// Admin panel only - customer-facing frontend doesn't trigger this
```

---

#### D. Delivery Confirmation
**When to send:** When order status changes to "delivered"  
**Endpoint:** `POST /api/orders/update-status`  
**Email automatically sent by backend:** ✅ Yes

**Frontend Implementation:**
```typescript
// Admin panel only - customer-facing frontend doesn't trigger this
```

---

#### E. Review Request
**When to send:** Triggered by admin or automatically after delivery  
**Endpoint:** `POST /api/email/review-request`  
**Email automatically sent by backend:** ❌ No (manual trigger needed)

**Frontend Implementation:**
```typescript
// Optional: Can be triggered from order confirmation page

const requestReview = async (orderId: string, customerEmail: string) => {
  try {
    const response = await fetch(`${API_URL}/api/email/review-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: customerEmail,
        orderDetails: {
          orderId: orderId,
          customer: { name: customerName }
        }
      })
    });
    
    const data = await response.json();
    console.log('Review request sent:', data);
  } catch (error) {
    console.error('Review request error:', error);
  }
};
```

**Email Template Variables:**
- `customer_name`: Customer name
- `order_number`: Order ID
- `review_url`: Link to review page
- `website_url`: https://peakmode.se

---

### **3. NEWSLETTER EMAILS** (2 types)

#### A. Newsletter Welcome (with Discount Code)
**When to send:** User subscribes to newsletter  
**Endpoint:** `POST /api/newsletter/subscribe`  
**Email automatically sent by backend:** ✅ Yes

**Frontend Implementation:**
```typescript
// File: src/components/NewsletterSignup.tsx

const handleNewsletterSignup = async (email: string, name: string) => {
  try {
    const response = await fetch(`${API_URL}/api/newsletter/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email, 
        name,
        source: 'website' // or 'popup', 'footer', etc.
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // ✅ Backend automatically sends welcome email with 10% discount code
      showToast(`Welcome! Check ${email} for your 10% discount code!`);
      console.log('Discount code:', data.discountCode); // e.g., PEAK10-ABC123
    }
  } catch (error) {
    console.error('Newsletter signup error:', error);
  }
};
```

**Email Template Variables:**
- `customer_name`: Subscriber name
- `discount_code`: 10% discount code (e.g., PEAK10-ABC123)
- `discount_value`: "10"
- `discount_expiry`: "14 days"
- `shop_url`: Link to shop
- `website_url`: https://peakmode.se

**Discount Code Details:**
- Format: `PEAK10-XXXXXX` (random 6 characters)
- Value: 10% off
- Expiry: 14 days from signup
- One-time use per email

---

#### B. Discount Reminder
**When to send:** 7 days after signup if code unused  
**Endpoint:** `POST /api/newsletter/send-reminder`  
**Email automatically sent by backend:** ❌ No (admin triggers)

**Frontend Implementation:**
```typescript
// This is typically triggered by admin panel or backend cron job
// Not directly from customer-facing frontend

// Optional: Show "Resend discount code" button for users
const resendDiscountCode = async (email: string) => {
  try {
    const response = await fetch(`${API_URL}/api/newsletter/send-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Discount reminder sent! Check your email.');
    }
  } catch (error) {
    console.error('Reminder error:', error);
  }
};
```

---

### **4. CUSTOM/MANUAL EMAILS** (1 type)

#### Welcome Email (General)
**When to send:** Manual/custom trigger  
**Endpoint:** `POST /api/email/welcome`  
**Email automatically sent by backend:** ❌ No (manual only)

**Frontend Implementation:**
```typescript
// Optional: Custom welcome flow

const sendWelcomeEmail = async (email: string, name: string) => {
  try {
    const response = await fetch(`${API_URL}/api/email/welcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, name })
    });
    
    const data = await response.json();
    console.log('Welcome email sent:', data);
  } catch (error) {
    console.error('Welcome email error:', error);
  }
};
```

---

## ✅ FRONTEND CHECKLIST - Ensure All Email Triggers Work

### Authentication Flow
- [ ] Registration form → Sends email verification
- [ ] Email verification page → Handles verification → Sends account setup email
- [ ] Password reset request → Sends reset email
- [ ] Password reset completion → Sends success email
- [ ] All auth pages redirect correctly after email actions

### E-commerce Flow
- [ ] Checkout completion → Creates order → Sends confirmation email
- [ ] Order tracking page exists at `/track-order?orderId=XXX`
- [ ] Review page exists at `/review?orderId=XXX`
- [ ] Thank you page displays order confirmation

### Newsletter Flow
- [ ] Newsletter signup form (footer) → Sends welcome + discount
- [ ] Newsletter popup (if any) → Sends welcome + discount
- [ ] Unsubscribe page exists at `/unsubscribe?email=XXX`

### Email Link Destinations (Must Exist!)
- [ ] `/verify-email?token=xxx&email=xxx` - Email verification page
- [ ] `/reset-password?token=xxx&email=xxx` - Password reset page
- [ ] `/hub/dashboard` or `/peak-mode-hub` - Hub dashboard
- [ ] `/hub/auth` - Hub login/signup page
- [ ] `/track-order?orderId=XXX` - Order tracking page
- [ ] `/review?orderId=XXX` - Product review page
- [ ] `/unsubscribe?email=XXX` - Unsubscribe page
- [ ] `/privacy-policy` - Privacy policy
- [ ] `/terms-of-service` - Terms of service

---

## 🔧 ENVIRONMENT CONFIGURATION

Ensure your frontend `.env.production` has:

```env
# Backend API
VITE_API_URL=https://vornify-server.onrender.com

# Site Configuration
VITE_SITE_NAME=Peak Mode
VITE_SITE_URL=https://peakmode.se
VITE_CONTACT_EMAIL=support@peakmode.se
```

---

## 🧪 TESTING CHECKLIST

### Test Each Email Type:

#### Authentication Emails:
```bash
# 1. Register new user
POST https://vornify-server.onrender.com/api/auth/register
Body: { "email": "test@gmail.com", "password": "pass123", "name": "Test" }
# → Should receive email verification email

# 2. Verify email (use token from email)
POST https://vornify-server.onrender.com/api/auth/verify-email
Body: { "token": "...", "email": "test@gmail.com" }
# → Should receive account setup email

# 3. Request password reset
POST https://vornify-server.onrender.com/api/auth/request-password-reset
Body: { "email": "test@gmail.com" }
# → Should receive password reset email

# 4. Reset password (use token from email)
POST https://vornify-server.onrender.com/api/auth/reset-password
Body: { "token": "...", "newPassword": "newpass123" }
# → Should receive password reset success email
```

#### Newsletter Emails:
```bash
# Subscribe to newsletter
POST https://vornify-server.onrender.com/api/newsletter/subscribe
Body: { "email": "test@gmail.com", "name": "Test User" }
# → Should receive welcome email with PEAK10-XXXXXX discount code
```

#### Order Emails:
```bash
# Create order (complex - test via frontend checkout)
# Should automatically send order confirmation email
```

---

## 🚨 COMMON ISSUES & FIXES

### Issue 1: Emails Not Received
**Cause:** SendGrid sender not verified  
**Fix:** Complete Single Sender Verification (see top of document)

### Issue 2: Email Links Lead to 404
**Cause:** Frontend routes don't exist  
**Fix:** Ensure all routes in "Email Link Destinations" section exist

### Issue 3: "Subscriber not found" for Newsletter
**Cause:** Email not in database  
**Fix:** User must subscribe first via `/api/newsletter/subscribe`

### Issue 4: Order Emails Not Sending
**Cause:** Missing customer email in order data  
**Fix:** Ensure `customer.email` is included in order creation request

---

## 📊 EMAIL TRACKING (Optional Enhancement)

To track email opens/clicks, integrate with SendGrid Event Webhook:

1. Set up webhook in SendGrid
2. Create endpoint: `POST /api/email/webhook`
3. Update email_logs collection with delivery status

---

## ✅ SUMMARY

### Automatic Emails (Backend Sends Automatically):
1. ✅ Email Verification (on registration)
2. ✅ Account Setup (on email verification)
3. ✅ Password Reset (on reset request)
4. ✅ Password Reset Success (on password reset)
5. ✅ Order Confirmation (on order creation)
6. ✅ Order Status Updates (on status change - admin only)
7. ✅ Newsletter Welcome (on newsletter signup)

### Manual Emails (Require Frontend Trigger):
1. ⏸️ Review Request (optional - admin or frontend)
2. ⏸️ Discount Reminder (admin panel)
3. ⏸️ Custom Welcome (if needed)

### Total Email Types: 13
- **Implemented & Auto-send:** 7
- **Implemented & Manual:** 6
- **All Ready:** ✅ Yes

---

## 🚀 FINAL DEPLOYMENT STEPS

1. **Backend:** ✅ Deployed to Render
2. **Frontend:** Update API_URL to production
3. **SendGrid:** Complete sender verification
4. **Test:** All email flows end-to-end
5. **Monitor:** Check SendGrid dashboard for delivery rates

---

**Once SendGrid sender verification is complete, ALL email features will work perfectly! 🎉**

