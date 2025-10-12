# 🎁 Discount Code System - Complete Implementation Guide

**Backend URL:** `https://vornify-server.onrender.com`  
**Discount Type:** 10% OFF Newsletter Signup Discount  
**Code Format:** `PEAK10-XXXXXX`  
**Expiry:** 14 days from signup  
**One-time use:** Yes

---

## ✅ BACKEND ENDPOINTS READY

### 1. **Subscribe to Newsletter** (Creates/Returns Discount Code)
```
POST /api/newsletter/subscribe
```

**Request:**
```json
{
  "email": "customer@example.com",
  "name": "Customer Name",
  "source": "website" // or "popup", "footer", etc.
}
```

**Response - New Subscriber:**
```json
{
  "success": true,
  "message": "Successfully subscribed to newsletter",
  "discountCode": "PEAK10-ABC123",
  "emailSent": true,
  "alreadySubscribed": false
}
```

**Response - Existing Subscriber:**
```json
{
  "success": true,
  "message": "You're already subscribed! Here's your discount code.",
  "discountCode": "PEAK10-ABC123",
  "isUsed": false,
  "expired": false,
  "alreadySubscribed": true,
  "expiresAt": "2025-01-30T12:00:00.000Z"
}
```

---

### 2. **Validate Discount Code** (Check Before Applying)
```
POST /api/newsletter/validate-discount
```

**Request:**
```json
{
  "discountCode": "PEAK10-ABC123"
}
```

**Response - Valid Code:**
```json
{
  "success": true,
  "valid": true,
  "discountValue": 10,
  "message": "Discount code is valid"
}
```

**Response - Invalid/Used/Expired:**
```json
{
  "success": false,
  "error": "Discount code already used"
}
// or
{
  "success": false,
  "error": "Discount code has expired"
}
// or
{
  "success": false,
  "error": "Invalid discount code"
}
```

---

### 3. **Use Discount Code** (Mark as Used After Payment)
```
POST /api/newsletter/use-discount
```

**Request:**
```json
{
  "discountCode": "PEAK10-ABC123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Discount code used successfully"
}
```

---

## 🎯 FRONTEND IMPLEMENTATION

### **Step 1: Newsletter Signup (Get Discount Code)**

```typescript
// In NewsletterSignup component

const handleNewsletterSignup = async (email: string, name: string) => {
  try {
    const response = await fetch(`${API_URL}/api/newsletter/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, source: 'footer' })
    });
    
    const data = await response.json();
    
    if (data.success) {
      if (data.alreadySubscribed) {
        // User already subscribed
        showToast(`You're already subscribed! Your code: ${data.discountCode}`);
        
        if (data.isUsed) {
          showToast('(Code already used)', 'warning');
        } else if (data.expired) {
          showToast('(Code expired)', 'warning');
        } else {
          // Show valid code
          showToast(`Valid until: ${new Date(data.expiresAt).toLocaleDateString()}`);
        }
      } else {
        // New subscriber
        showToast(`Welcome! Your 10% discount code: ${data.discountCode}`);
        showToast('Check your email for details!');
      }
      
      // Optionally save code to localStorage for easy access
      localStorage.setItem('peakmode_discount_code', data.discountCode);
    }
  } catch (error) {
    showToast('Subscription failed. Please try again.');
  }
};
```

---

### **Step 2: Cart/Checkout - Apply Discount Code**

```typescript
// In Cart or Checkout component

const [discountCode, setDiscountCode] = useState('');
const [discountApplied, setDiscountApplied] = useState(false);
const [discountValue, setDiscountValue] = useState(0);

const handleApplyDiscount = async () => {
  if (!discountCode.trim()) {
    showToast('Please enter a discount code');
    return;
  }
  
  try {
    // Step 1: Validate the discount code
    const response = await fetch(`${API_URL}/api/newsletter/validate-discount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discountCode: discountCode.trim().toUpperCase() })
    });
    
    const data = await response.json();
    
    if (data.success && data.valid) {
      // Code is valid!
      setDiscountApplied(true);
      setDiscountValue(data.discountValue); // 10
      
      // Recalculate cart total
      const discountAmount = (cartTotal * data.discountValue) / 100;
      const newTotal = cartTotal - discountAmount;
      
      showToast(`✅ Discount applied! You saved ${discountAmount} SEK`);
      
      // Update cart state
      setFinalTotal(newTotal);
      
    } else {
      // Code is invalid/used/expired
      showToast(`❌ ${data.error}`, 'error');
      setDiscountApplied(false);
      setDiscountValue(0);
    }
    
  } catch (error) {
    showToast('Failed to validate discount code', 'error');
  }
};

const handleRemoveDiscount = () => {
  setDiscountApplied(false);
  setDiscountValue(0);
  setDiscountCode('');
  setFinalTotal(cartTotal);
  showToast('Discount removed');
};
```

---

### **Step 3: After Payment Success - Mark Code as Used**

```typescript
// After successful payment (in payment success handler)

const handlePaymentSuccess = async (paymentResult) => {
  // ... handle payment success ...
  
  // If discount was applied, mark it as used
  if (discountApplied && discountCode) {
    try {
      await fetch(`${API_URL}/api/newsletter/use-discount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discountCode: discountCode.trim().toUpperCase() })
      });
      
      console.log('Discount code marked as used');
      
      // Clear discount from localStorage
      localStorage.removeItem('peakmode_discount_code');
      
    } catch (error) {
      console.error('Failed to mark discount as used:', error);
      // Don't fail the order if this fails - just log it
    }
  }
  
  // Redirect to thank you page
  navigate(`/thank-you?orderId=${orderId}`);
};
```

---

## 🎨 UI EXAMPLES

### **Discount Code Input in Cart/Checkout:**

```tsx
<div className="discount-code-section">
  <h3>Have a Discount Code?</h3>
  
  {!discountApplied ? (
    <div className="discount-input-group">
      <input
        type="text"
        placeholder="Enter code (e.g., PEAK10-ABC123)"
        value={discountCode}
        onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
        maxLength={15}
      />
      <button onClick={handleApplyDiscount} className="btn-apply">
        Apply
      </button>
    </div>
  ) : (
    <div className="discount-applied">
      <span className="discount-badge">
        ✅ {discountCode} applied (-{discountValue}%)
      </span>
      <button onClick={handleRemoveDiscount} className="btn-remove">
        Remove
      </button>
    </div>
  )}
</div>

{/* Cart Summary */}
<div className="cart-summary">
  <div className="summary-line">
    <span>Subtotal:</span>
    <span>{cartTotal} SEK</span>
  </div>
  
  {discountApplied && (
    <div className="summary-line discount">
      <span>Discount ({discountValue}%):</span>
      <span className="discount-amount">-{(cartTotal * discountValue / 100).toFixed(2)} SEK</span>
    </div>
  )}
  
  <div className="summary-line shipping">
    <span>Shipping:</span>
    <span>{shipping} SEK</span>
  </div>
  
  <div className="summary-line total">
    <span>Total:</span>
    <span>{finalTotal + shipping} SEK</span>
  </div>
</div>
```

---

## 🔄 COMPLETE USER FLOW

### **Flow 1: New User Gets & Uses Discount**

```
1. User signs up for newsletter
   ↓
2. Backend creates discount code (PEAK10-ABC123)
   ↓
3. Backend saves to database (isUsed: false)
   ↓
4. Backend sends welcome email with code
   ↓
5. User receives email with code
   ↓
6. User adds items to cart
   ↓
7. User enters code in checkout
   ↓
8. Frontend validates code (checks if valid/used/expired)
   ↓
9. Backend confirms: valid ✅
   ↓
10. Frontend applies 10% discount
   ↓
11. User completes payment
   ↓
12. Frontend marks code as used
   ↓
13. Backend updates database (isUsed: true)
   ↓
14. Code cannot be used again ✅
```

---

### **Flow 2: User Subscribes Again (Already Has Code)**

```
1. User tries to subscribe again
   ↓
2. Backend finds existing subscription
   ↓
3. Backend returns existing code
   ↓
4. Frontend shows: "You're already subscribed! Your code: PEAK10-ABC123"
   ↓
5. User can still use their code (if not used/expired)
```

---

### **Flow 3: User Tries to Use Code Twice**

```
1. User enters code in checkout
   ↓
2. Frontend validates code
   ↓
3. Backend checks: isUsed = true
   ↓
4. Backend returns error: "Discount code already used"
   ↓
5. Frontend shows error message
   ↓
6. User cannot apply discount ❌
```

---

## 📊 DISCOUNT CODE DATABASE SCHEMA

```javascript
{
  _id: ObjectId,
  email: "customer@example.com",
  name: "Customer Name",
  status: "active" | "unsubscribed",
  source: "website" | "popup" | "footer",
  discountCode: "PEAK10-ABC123",
  isUsed: false,              // Changes to true after first purchase
  subscribedAt: "2025-01-15T10:00:00.000Z",
  expiresAt: "2025-01-29T10:00:00.000Z",    // 14 days later
  usedAt: null                // Set when isUsed becomes true
}
```

---

## 🧪 TESTING CHECKLIST

### Test 1: Subscribe & Get Code
- [ ] Subscribe with new email
- [ ] Receive welcome email with code
- [ ] Code format is PEAK10-XXXXXX
- [ ] Code saved in database

### Test 2: Subscribe Again (Existing)
- [ ] Try to subscribe with same email
- [ ] Receive existing code
- [ ] No error message
- [ ] Shows "already subscribed" message

### Test 3: Validate Code
- [ ] Enter valid code in checkout
- [ ] Code validates successfully
- [ ] 10% discount applied
- [ ] Total recalculated correctly

### Test 4: Use Code (Mark as Used)
- [ ] Complete payment with discount
- [ ] Code marked as used in database
- [ ] isUsed = true
- [ ] usedAt timestamp set

### Test 5: Try to Reuse Code
- [ ] Try to use same code again
- [ ] Validation fails
- [ ] Error: "Discount code already used"
- [ ] Cannot apply discount

### Test 6: Expired Code
- [ ] Wait 14 days (or manually expire in DB)
- [ ] Try to use code
- [ ] Validation fails
- [ ] Error: "Discount code has expired"

### Test 7: Invalid Code
- [ ] Enter random code
- [ ] Validation fails
- [ ] Error: "Invalid discount code"

---

## 🎯 SUMMARY

### ✅ Backend Features:
1. Auto-generates unique discount codes (PEAK10-XXXXXX)
2. Stores codes with subscriber emails
3. Returns existing code if user subscribes again
4. Validates codes (checks used/expired/invalid)
5. Marks codes as used after purchase
6. 14-day expiry from signup
7. One-time use enforcement

### 🔄 Frontend Integration:
1. Newsletter signup returns discount code
2. Cart/checkout has discount code input
3. Validates code before applying
4. Applies 10% discount to cart total
5. Marks code as used after payment
6. Shows appropriate error messages

### 🛡️ Security Features:
1. Codes cannot be reused (one-time only)
2. Codes expire after 14 days
3. Validation happens server-side
4. Codes linked to specific emails
5. Used codes tracked in database

---

**All discount code functionality is COMPLETE and ready to use! 🚀**

