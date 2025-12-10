# Frontend AI - Apple Pay Still Not Working (Domain Verified)

## Current Status

✅ **Domain is verified in Stripe Dashboard:**
- Domain: `peakmode.se`
- Status: Enabled
- Apple Pay status: Enabled

❌ **Apple Pay still showing error:**
- "Something went wrong. unable to show apple pay. please choose another method"

## Root Cause Analysis

Since the domain is verified, the issue is likely in:

1. **Frontend Apple Pay implementation**
2. **Payment Request API not being called correctly**
3. **Device/browser compatibility**
4. **Payment intent configuration for Apple Pay**

## Required Fixes

### 1. Check Apple Pay Availability Before Showing

**CRITICAL:** Always check if Apple Pay is available before showing the button:

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
        amount: amountInCents, // Amount in smallest currency unit
      },
      requestPayerName: true,
      requestPayerEmail: true,
    });
    
    const canMakePayment = await paymentRequest.canMakePayment();
    
    if (canMakePayment && canMakePayment.applePay) {
      return true; // Apple Pay is available
    }
    
    return false; // Apple Pay not available
  } catch (error) {
    console.error('Error checking Apple Pay availability:', error);
    return false;
  }
};

// Use this before showing Apple Pay button
const isApplePayAvailable = await checkApplePayAvailability();
if (!isApplePayAvailable) {
  // Don't show Apple Pay button or show appropriate message
  console.log('Apple Pay not available on this device/browser');
}
```

### 2. PaymentElement Apple Pay Configuration

Ensure PaymentElement is configured correctly:

```typescript
<PaymentElement
  options={{
    layout: 'tabs',
    wallets: {
      applePay: 'always', // or 'auto' - but 'always' is better for debugging
      googlePay: 'always'
    },
    fields: {
      billingDetails: 'auto'
    }
  }}
  onReady={(event) => {
    console.log('PaymentElement ready:', event);
    
    // Check if Apple Pay is available
    if (event.wallets) {
      console.log('Available wallets:', event.wallets);
      console.log('Apple Pay available:', event.wallets.applePay);
    }
  }}
  onChange={(event) => {
    if (event.error) {
      console.error('PaymentElement error:', event.error);
      
      // Handle Apple Pay specific errors
      if (event.error.type === 'validation_error' && 
          event.error.message?.includes('apple')) {
        console.error('Apple Pay error:', event.error.message);
      }
    }
  }}
/>
```

### 3. Handle Apple Pay Errors Gracefully

```typescript
// When user clicks Apple Pay button
const handleApplePay = async () => {
  try {
    // PaymentElement should handle Apple Pay automatically
    // But you can also use Payment Request API directly
    
    const paymentRequest = stripe.paymentRequest({
      country: 'SE',
      currency: 'sek',
      total: {
        label: 'Total',
        amount: amountInCents,
      },
      requestPayerName: true,
      requestPayerEmail: true,
    });
    
    // Check availability
    const canMakePayment = await paymentRequest.canMakePayment();
    
    if (!canMakePayment || !canMakePayment.applePay) {
      // Apple Pay not available
      alert('Apple Pay is not available on this device. Please use another payment method.');
      return;
    }
    
    // Show Apple Pay sheet
    paymentRequest.show();
    
    // Handle payment method
    paymentRequest.on('paymentmethod', async (event) => {
      try {
        // Confirm payment with Apple Pay payment method
        const { error, paymentIntent } = await stripe.confirmCardPayment(
          clientSecret,
          {
            payment_method: event.paymentMethod.id
          },
          {
            handleActions: false // Don't handle 3DS automatically
          }
        );
        
        if (error) {
          event.complete('fail');
          console.error('Apple Pay payment error:', error);
        } else if (paymentIntent.status === 'requires_action') {
          // 3DS required
          event.complete('success');
          // Handle 3DS
          const { error: confirmError } = await stripe.confirmCardPayment(
            clientSecret
          );
          if (confirmError) {
            console.error('3DS confirmation error:', confirmError);
          }
        } else {
          event.complete('success');
        }
      } catch (err) {
        event.complete('fail');
        console.error('Apple Pay processing error:', err);
      }
    });
    
  } catch (error) {
    console.error('Apple Pay error:', error);
    alert('Unable to process Apple Pay. Please try another payment method.');
  }
};
```

### 4. Debug Apple Pay Availability

Add comprehensive logging:

```typescript
// Check what's available
const debugPaymentMethods = async () => {
  if (!stripe) {
    console.error('Stripe not initialized');
    return;
  }
  
  try {
    const paymentRequest = stripe.paymentRequest({
      country: 'SE',
      currency: 'sek',
      total: {
        label: 'Total',
        amount: 10000, // 100.00 SEK
      },
    });
    
    const canMakePayment = await paymentRequest.canMakePayment();
    
    console.log('Payment Request availability:', {
      applePay: canMakePayment?.applePay || false,
      googlePay: canMakePayment?.googlePay || false,
      canMakePayment: !!canMakePayment,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
      isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
      isMacOS: /Macintosh/.test(navigator.userAgent)
    });
    
    return canMakePayment;
  } catch (error) {
    console.error('Error checking payment methods:', error);
    return null;
  }
};

// Call this on component mount
debugPaymentMethods();
```

### 5. Common Apple Pay Issues

#### Issue 1: Not on Safari
**Solution:** Apple Pay only works on Safari (iOS/macOS). Check browser:

```typescript
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isMacOS = /Macintosh/.test(navigator.userAgent);

if (!isSafari || (!isIOS && !isMacOS)) {
  // Don't show Apple Pay
  console.log('Apple Pay only works on Safari (iOS/macOS)');
}
```

#### Issue 2: Apple Wallet Not Set Up
**Solution:** User must have Apple Wallet configured with a payment method.

#### Issue 3: Payment Amount Too Small/Large
**Solution:** Ensure amount is valid (not 0, not negative, reasonable range).

#### Issue 4: Currency Not Supported
**Solution:** Apple Pay must support SEK. Check if SEK is supported in your region.

### 6. Payment Intent Configuration Check

The backend is using `automatic_payment_methods` which should enable Apple Pay. Verify the payment intent response includes Apple Pay:

```typescript
// After creating payment intent, check response
const response = await createPaymentIntent(...);
console.log('Payment intent response:', {
  paymentMethods: response.paymentMethods,
  applePay: response.paymentMethods?.applePay,
  automaticPaymentMethods: response.automaticPaymentMethods
});
```

## Testing Steps

1. **Check browser/device:**
   - Must be Safari on iOS or macOS
   - User must have Apple Wallet set up

2. **Check availability:**
   - Call `canMakePayment()` before showing button
   - Log the result to see what's available

3. **Check PaymentElement:**
   - Verify `wallets.applePay` is set to `'always'` or `'auto'`
   - Check `onReady` event for wallet availability

4. **Check errors:**
   - Look for specific error messages in console
   - Check if error is from Stripe or your code

5. **Test with Payment Request API directly:**
   - Try using Payment Request API instead of PaymentElement
   - See if that works (helps isolate the issue)

## Expected Behavior

1. **On Safari (iOS/macOS) with Apple Wallet:**
   - Apple Pay button should appear in PaymentElement
   - Clicking should show Apple Pay sheet
   - User can authenticate and complete payment

2. **On other browsers/devices:**
   - Apple Pay button should NOT appear
   - Or should be hidden/disabled

## Backend Status

✅ **Backend is correctly configured:**
- `automatic_payment_methods: { enabled: true }` ✅
- Domain verified in Stripe Dashboard ✅
- Payment intent supports Apple Pay ✅

**Backend cannot fix:**
- Frontend Apple Pay implementation
- Device/browser compatibility
- Apple Wallet setup on user's device

## Next Steps

1. **Add availability check** before showing Apple Pay
2. **Add comprehensive logging** to see what's happening
3. **Test on Safari (iOS/macOS)** with Apple Wallet configured
4. **Check PaymentElement `onReady` event** for wallet availability
5. **Try Payment Request API directly** to isolate the issue

---

**Status:** 🔴 Apple Pay not working despite domain verification
**Root Cause:** Likely frontend implementation or device/browser compatibility
**Backend:** ✅ Correctly configured - domain verified
**Action Required:** Frontend to add availability checks and proper error handling

