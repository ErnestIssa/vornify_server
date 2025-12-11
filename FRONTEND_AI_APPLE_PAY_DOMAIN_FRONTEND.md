# Frontend AI - Apple Pay Domain Verification: Frontend Requirements

## Backend Status

✅ **Backend is handling domain verification:**
- Route created to serve verification file at `/.well-known/apple-developer-merchantid-domain-association`
- File is accessible on both `peakmode.se` and `www.peakmode.se`
- No frontend code needed for file serving

## Frontend Requirements

### 1. Ensure Correct Domain Usage

**CRITICAL:** The frontend must use the SAME domain that's registered in Stripe Dashboard.

**Since both domains are registered:**
- ✅ Frontend can use `https://peakmode.se` (non-www)
- ✅ Frontend can use `https://www.peakmode.se` (www)
- ✅ Both will work as long as both are registered in Stripe

**What to check:**
- Ensure Stripe.js is initialized with the correct publishable key
- Ensure PaymentElement is created on the correct domain
- If using redirects, ensure `return_url` uses the correct domain

### 2. Check Apple Pay Availability

**Before showing Apple Pay button, check if it's available:**

```typescript
// Check Apple Pay availability
const checkApplePayAvailability = async () => {
  if (!stripe) return false;
  
  try {
    const paymentRequest = stripe.paymentRequest({
      country: 'SE',
      currency: 'sek',
      total: {
        label: 'Total',
        amount: amountInCents,
      },
    });
    
    const canMakePayment = await paymentRequest.canMakePayment();
    
    return canMakePayment?.applePay || false;
  } catch (error) {
    console.error('Error checking Apple Pay availability:', error);
    return false;
  }
};

// Only show Apple Pay if available
const isApplePayAvailable = await checkApplePayAvailability();
```

### 3. Handle Domain-Specific Errors

**If Apple Pay fails, check domain:**

```typescript
// When Apple Pay error occurs
if (error && error.message?.includes('apple')) {
  // Check if domain is registered
  const currentDomain = window.location.hostname;
  console.error('Apple Pay error on domain:', currentDomain);
  console.error('Ensure this domain is registered in Stripe Dashboard');
  
  // Show user-friendly error
  if (currentDomain === 'peakmode.se' || currentDomain === 'www.peakmode.se') {
    // Domain should be registered - might be verification issue
    alert('Apple Pay is not available. Please try another payment method.');
  }
}
```

### 4. PaymentElement Configuration

**Ensure PaymentElement is configured correctly:**

```typescript
<PaymentElement
  options={{
    wallets: {
      applePay: 'auto', // or 'always' - will only show if available
      googlePay: 'auto'
    }
  }}
  onReady={(event) => {
    // Check if Apple Pay is available
    if (event.wallets) {
      console.log('Apple Pay available:', event.wallets.applePay);
      
      // If Apple Pay not available, hide button or show message
      if (!event.wallets.applePay) {
        // Apple Pay not available on this device/browser
        // This is normal - only works on Safari (iOS/macOS)
      }
    }
  }}
/>
```

### 5. Return URL Configuration

**If using redirects (e.g., for Klarna), ensure return URLs use correct domain:**

```typescript
const returnUrl = `${window.location.origin}/thank-you`;

// This will automatically use the correct domain:
// - https://peakmode.se/thank-you (if on peakmode.se)
// - https://www.peakmode.se/thank-you (if on www.peakmode.se)
```

## What Frontend Does NOT Need to Do

❌ **Frontend does NOT need to:**
- Serve the verification file (backend handles this)
- Register domains in Stripe (manual admin task)
- Download verification file (backend handles this)
- Handle domain verification logic (Stripe handles this)

## What Frontend DOES Need to Do

✅ **Frontend MUST:**
- Use correct domain when initializing Stripe
- Check Apple Pay availability before showing button
- Handle Apple Pay errors gracefully
- Ensure return URLs use correct domain
- Only show Apple Pay on supported devices/browsers (Safari on iOS/macOS)

## Testing

**After both domains are registered in Stripe:**

1. **Test on `peakmode.se`:**
   - Visit `https://peakmode.se`
   - Check if Apple Pay button appears (if on Safari iOS/macOS)
   - Try Apple Pay payment

2. **Test on `www.peakmode.se`:**
   - Visit `https://www.peakmode.se`
   - Check if Apple Pay button appears (if on Safari iOS/macOS)
   - Try Apple Pay payment

3. **Both should work** if both domains are registered and verified in Stripe

## Summary

**Frontend requirements are minimal:**
- ✅ Use correct domain (automatic - uses current domain)
- ✅ Check Apple Pay availability (best practice)
- ✅ Handle errors gracefully (best practice)
- ✅ Configure PaymentElement correctly (already done)

**The domain verification itself is handled by:**
- Backend (serves the file) ✅
- Stripe Dashboard (domain registration) - manual admin task
- Stripe (verifies the file) - automatic

**Frontend just needs to ensure it's using the correct domain and handling Apple Pay correctly.**

---

**Status:** ✅ Frontend requirements are minimal
**Backend:** ✅ Handles file serving
**Action Required:** Ensure both domains registered in Stripe Dashboard (admin task)

