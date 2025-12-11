# Apple Pay Domain Verification Checklist

## Critical Checks Required

### 1. Domain Matching (www vs non-www)

**CRITICAL:** Your site is accessed at BOTH `peakmode.se` and `www.peakmode.se`. Stripe treats these as DIFFERENT domains.

#### Required: Register BOTH Domains in Stripe

**You MUST add BOTH domains separately in Stripe Dashboard:**

1. Go to **Stripe Dashboard → Settings → Payment methods → Apple Pay**
2. **Add `peakmode.se`** (if not already added)
3. **Add `www.peakmode.se`** (if not already added)
4. **Both domains must be registered and verified separately**

#### Domain Matching Rules:

**For `peakmode.se`:**
- ✅ Stripe must have `peakmode.se` registered
- ✅ Frontend using `https://peakmode.se` will work
- ❌ Frontend using `https://www.peakmode.se` will NOT work with this domain entry

**For `www.peakmode.se`:**
- ✅ Stripe must have `www.peakmode.se` registered
- ✅ Frontend using `https://www.peakmode.se` will work
- ❌ Frontend using `https://peakmode.se` will NOT work with this domain entry

**Solution:**
- ✅ **Register BOTH domains in Stripe** (recommended)
- ✅ Verify both domains separately
- ✅ The same verification file works for both (same server)
- ✅ Apple Pay will work on both `peakmode.se` and `www.peakmode.se`

#### Why Both Domains Are Needed:

- Stripe treats `peakmode.se` and `www.peakmode.se` as completely different domains
- Each domain must be verified individually
- If a user accesses `www.peakmode.se` but only `peakmode.se` is registered, Apple Pay won't work
- If a user accesses `peakmode.se` but only `www.peakmode.se` is registered, Apple Pay won't work
- **Register both to ensure Apple Pay works regardless of which domain the user accesses**

### 2. Verification File Accessibility

**CRITICAL:** Test the file on BOTH domains. The same file works for both since they point to the same server.

#### Test 1: Non-www Domain (peakmode.se)

**Using curl:**
```bash
curl -I https://peakmode.se/.well-known/apple-developer-merchantid-domain-association
```

**Using browser:**
Visit: `https://peakmode.se/.well-known/apple-developer-merchantid-domain-association`

**Expected response:**
- Status: 200 OK
- Content-Type: text/plain
- Body: The verification file content (text string)
- No 404 error

#### Test 2: www Domain (www.peakmode.se)

**Using curl:**
```bash
curl -I https://www.peakmode.se/.well-known/apple-developer-merchantid-domain-association
```

**Using browser:**
Visit: `https://www.peakmode.se/.well-known/apple-developer-merchantid-domain-association`

**Expected response:**
- Status: 200 OK
- Content-Type: text/plain
- Body: The verification file content (text string)
- No 404 error

**Note:** The same file works for both domains. The backend route serves the file for both `peakmode.se` and `www.peakmode.se`.

#### Test 3: Using Backend Verification Endpoint

Visit: `https://vornify-server.onrender.com/api/apple-pay/verify`

**Expected response:**
```json
{
  "success": true,
  "fileExists": true,
  "envVarExists": false,
  "fileSource": "file",
  "fileContent": "abc123...",
  "fileLength": 123,
  "expectedUrl": "https://peakmode.se/.well-known/apple-developer-merchantid-domain-association",
  "message": "Apple Pay verification file is configured"
}
```

**If you get 404 on either domain:**
- File doesn't exist on server
- File not deployed to Render.com
- Route not working
- www redirects might be interfering (file should be accessible on both)

### 3. File Content Verification

The file content must match EXACTLY what Stripe shows:

1. **Get file content from Stripe:**
   - Stripe Dashboard → Settings → Payment methods → Apple Pay
   - Find domain: `peakmode.se`
   - Click "View file" or "Download"
   - Copy the exact content

2. **Get file content from your server:**
   ```bash
   curl https://peakmode.se/.well-known/apple-developer-merchantid-domain-association
   ```

3. **Compare:**
   - Content must match EXACTLY
   - No extra spaces
   - No line breaks (unless Stripe file has them)
   - No extra characters

### 4. Stripe Dashboard Verification

**CRITICAL:** Verify BOTH domains separately in Stripe Dashboard.

1. Go to **Stripe Dashboard → Settings → Payment methods → Apple Pay**

2. **For `peakmode.se`:**
   - Find domain: `peakmode.se`
   - Check status:
     - ✅ **Verified** = Good
     - ⚠️ **Pending** = Still verifying (wait a few minutes)
     - ❌ **Failed** = File not accessible or content wrong
   - Click **"Verify"** or **"Re-verify"** to trigger verification
   - Stripe will check: `https://peakmode.se/.well-known/apple-developer-merchantid-domain-association`

3. **For `www.peakmode.se`:**
   - Find domain: `www.peakmode.se`
   - Check status:
     - ✅ **Verified** = Good
     - ⚠️ **Pending** = Still verifying (wait a few minutes)
     - ❌ **Failed** = File not accessible or content wrong
   - Click **"Verify"** or **"Re-verify"** to trigger verification
   - Stripe will check: `https://www.peakmode.se/.well-known/apple-developer-merchantid-domain-association`

**Both domains must show "Verified" status for Apple Pay to work on both domains.**

### 5. Common Issues

#### Issue 1: Domain Mismatch
**Symptom:** Domain verified in Stripe but Apple Pay still doesn't work

**Check:**
- Both `peakmode.se` AND `www.peakmode.se` are registered in Stripe
- Frontend domain matches one of the registered domains exactly
- No subdomain differences

**Fix:**
- **Register BOTH domains in Stripe** (required since site uses both)
- Verify both domains separately
- Ensure file is accessible on both domains

#### Issue 2: File Returns 404
**Symptom:** `curl` or browser shows 404

**Check:**
1. File exists in `.well-known` folder
2. File name is exact: `apple-developer-merchantid-domain-association` (no extension)
3. File is deployed to Render.com
4. Route is working (check backend logs)

**Fix:**
- Create file in `.well-known` folder
- Deploy to Render.com
- Test again

#### Issue 3: File Content Wrong
**Symptom:** File accessible but Stripe verification fails

**Check:**
- File content matches Stripe exactly
- No extra whitespace
- Correct encoding (UTF-8 or plain text)

**Fix:**
- Re-download file from Stripe
- Replace file content
- Redeploy

#### Issue 4: Redirects
**Symptom:** File redirects instead of serving directly

**Check:**
- No redirects in route handler
- No redirects in Render.com configuration
- File served directly (not through redirect)

**Fix:**
- Ensure route serves file directly
- Check Render.com static file serving

## Verification Steps Summary

1. ✅ **Register BOTH domains in Stripe** (`peakmode.se` AND `www.peakmode.se`)
2. ✅ **Test file URL on BOTH domains** (`curl` or browser for both)
3. ✅ **Verify file content** matches Stripe (same content for both)
4. ✅ **Verify BOTH domains in Stripe Dashboard** (each separately)
5. ✅ **Test backend endpoint** (`/api/apple-pay/verify`)
6. ✅ **Ensure both domains show "Verified" status** in Stripe

## Backend Status

✅ **Backend route created:**
- Route: `/.well-known/apple-developer-merchantid-domain-association`
- Serves file with `Content-Type: text/plain`
- No redirects
- Supports both file and environment variable

✅ **Verification endpoint created:**
- Route: `/api/apple-pay/verify`
- Checks if file exists
- Shows file source and status

## Next Steps

1. **Check domain matching** in Stripe Dashboard vs frontend
2. **Test file URL** to ensure it's accessible
3. **Verify file content** matches Stripe
4. **Re-verify in Stripe Dashboard** after file is accessible
5. **Test Apple Pay** on Safari (iOS/macOS)

---

**Status:** 🟡 Verification required
**Action:** Check domain matching and file accessibility

