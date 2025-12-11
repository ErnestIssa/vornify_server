# Apple Pay Domain Verification Setup

## Backend Route Added

✅ **Route created to serve Apple Pay domain verification file:**

The backend now serves the file at: `/.well-known/apple-developer-merchantid-domain-association`

**Route location:** `app.js` (before health check endpoint)

**How it works:**
1. First tries to read from: `.well-known/apple-developer-merchantid-domain-association` file
2. Falls back to: `APPLE_PAY_DOMAIN_VERIFICATION` environment variable
3. Returns 404 if neither exists (with helpful error message)

## CRITICAL: Both Domains Must Be Registered

**Your site is accessed at both:**
- `peakmode.se` (non-www)
- `www.peakmode.se` (www)

**Stripe treats these as DIFFERENT domains.** You MUST register BOTH separately in Stripe Dashboard.

### Step 1: Add Both Domains in Stripe Dashboard

1. Go to **Stripe Dashboard → Settings → Payment methods → Apple Pay**
2. **Add `peakmode.se`** (if not already added)
3. **Add `www.peakmode.se`** (if not already added)
4. **Both domains must be added separately**
5. Each domain will have its own verification file (same content, but registered separately)

**Important:** 
- Stripe treats `peakmode.se` and `www.peakmode.se` as completely different domains
- Each must be verified individually
- The verification file content is the same for both, but each domain needs its own entry in Stripe

### Step 2: Download Verification File from Stripe

1. Go to **Stripe Dashboard → Settings → Payment methods → Apple Pay**
2. For **each domain** (`peakmode.se` and `www.peakmode.se`):
   - Click on the domain
   - Click **"Download"** or **"View file"** to get the verification file content
   - The file content is a simple text string (looks like a hash/ID)
   - **Note:** The file content should be the same for both domains, but verify this


### Step 3: Create the File on Server

**Option A: Create file in `.well-known` folder (Recommended)**

1. Create folder: `.well-known` in the project root
2. Create file: `apple-developer-merchantid-domain-association` (no extension)
3. Paste the file content from Stripe (same content works for both domains)
4. Ensure the file has no extra whitespace or line breaks
5. Deploy to Render.com

**File structure:**
```
vornify_server/
  .well-known/
    apple-developer-merchantid-domain-association  (no .txt extension)
```

**Note:** The same file works for both `peakmode.se` and `www.peakmode.se` since they point to the same server. The backend route will serve the file for both domains.

**Option B: Use Environment Variable**

1. Go to **Render.com Dashboard → Your Service → Environment**
2. Add new environment variable:
   - **Key:** `APPLE_PAY_DOMAIN_VERIFICATION`
   - **Value:** Paste the file content from Stripe (exact content, no extra spaces)
3. Save and redeploy

### Step 4: Verify File is Accessible on BOTH Domains

**CRITICAL:** Test the file on BOTH domains:

**Test 1: Non-www domain**
```bash
curl https://peakmode.se/.well-known/apple-developer-merchantid-domain-association
```

**Test 2: www domain**
```bash
curl https://www.peakmode.se/.well-known/apple-developer-merchantid-domain-association
```

**Expected response for BOTH:**
- Status: 200 OK
- Content-Type: text/plain
- Body: The verification file content (should match what you downloaded from Stripe)

**If you get 404 on either:**
- Check file exists in `.well-known` folder
- Check file name is exactly: `apple-developer-merchantid-domain-association` (no extension)
- Check Render.com is serving the file (may need to rebuild/redeploy)
- Check if www redirects are interfering (the file should be accessible on both)

### Step 5: Verify BOTH Domains in Stripe Dashboard

1. Go to **Stripe Dashboard → Settings → Payment methods → Apple Pay**
2. **For `peakmode.se`:**
   - Find domain: `peakmode.se`
   - Click **"Verify"** or **"Re-verify"**
   - Stripe will check if the file is accessible at `https://peakmode.se/.well-known/apple-developer-merchantid-domain-association`
   - Status should change to **"Verified"** ✅
3. **For `www.peakmode.se`:**
   - Find domain: `www.peakmode.se`
   - Click **"Verify"** or **"Re-verify"**
   - Stripe will check if the file is accessible at `https://www.peakmode.se/.well-known/apple-developer-merchantid-domain-association`
   - Status should change to **"Verified"** ✅

**Both domains must show "Verified" status.**

## Payment Intent Configuration

✅ **Payment intent is correctly configured for Apple Pay:**

```javascript
{
  automatic_payment_methods: {
    enabled: true,
    allow_redirects: 'always'
  },
  // No payment_method_types - correct for Apple Pay
  // Apple Pay works through automatic_payment_methods
}
```

**This configuration:**
- ✅ Enables Apple Pay automatically
- ✅ Works with PaymentElement
- ✅ No conflicts with other payment methods
- ✅ Correct for Apple Pay support

## Troubleshooting

### File Not Found (404)

**Check:**
1. File exists in `.well-known` folder
2. File name is exact: `apple-developer-merchantid-domain-association` (no extension)
3. File content matches Stripe exactly (no extra spaces/line breaks)
4. Render.com has deployed the file (check build logs)

### File Content Wrong

**Check:**
1. File content matches exactly what Stripe shows
2. No extra whitespace or line breaks
3. File encoding is UTF-8 or plain text

### Still Getting "Apple Pay could not be opened"

**After file is verified, check:**
1. Payment intent uses `automatic_payment_methods` (✅ confirmed)
2. Frontend is using PaymentElement correctly
3. User is on Safari (iOS/macOS) with Apple Wallet configured
4. Payment amount is valid

## Backend Status

✅ **Backend is ready:**
- Route created to serve verification file ✅
- Payment intent correctly configured ✅
- Supports both file and environment variable ✅

**Next step:** Download file from Stripe and place it in `.well-known` folder, then redeploy.

---

**Status:** 🟡 Waiting for verification file to be added
**Action Required:** Download file from Stripe and place in `.well-known` folder

