# 🕐 Free Exchange Rate Updates - External Cron Services

## Overview
This guide explains how to set up **completely FREE** scheduled jobs to automatically update exchange rates daily from the ECB (European Central Bank).

**✅ All methods below are 100% FREE** - no paid plans required!

## Why Daily Updates?
- ECB updates rates once per day (around 16:00 CET)
- Daily updates ensure accurate pricing for EU customers
- Prevents stale rates from affecting conversions

---

## 🎯 Method 1: cron-job.org (Recommended - Easiest)

**✅ Completely FREE**  
**✅ No account required for basic usage**  
**✅ Simple setup (5 minutes)**

### Step 1: Visit cron-job.org
1. Go to [https://cron-job.org](https://cron-job.org)
2. Click **"Create cronjob"** (no signup needed for basic usage, or create free account)

### Step 2: Configure the Cron Job

**Settings:**
- **Title**: `Update Exchange Rates`
- **Address (URL)**: `https://vornify-server.onrender.com/api/settings/currencies/update`
- **Request method**: `POST`
- **Request body**: Leave empty
- **Schedule**: 
  - Select **"Daily"**
  - Set time to **4:00 AM UTC** (5:00 AM CET) - recommended after ECB updates
  - Or use cron expression: `0 4 * * *`
- **Notification email** (optional): Your email to get notified of failures

### Step 3: Save and Test
1. Click **"Create cronjob"**
2. Click **"Run now"** to test immediately
3. Check your backend logs to verify it worked

**That's it!** The job will run daily automatically.

---

## 🎯 Method 2: EasyCron (Alternative)

**✅ FREE tier available**  
**✅ More features than cron-job.org**

### Step 1: Sign Up
1. Go to [https://www.easycron.com](https://www.easycron.com)
2. Sign up for a **free account** (allows 2 cron jobs)

### Step 2: Create Cron Job
1. Click **"Add Cron Job"**
2. **Job Title**: `Update Exchange Rates`
3. **URL**: `https://vornify-server.onrender.com/api/settings/currencies/update`
4. **HTTP Method**: `POST`
5. **Schedule**: 
   - **Cron Expression**: `0 4 * * *` (daily at 4 AM UTC)
   - Or use the visual scheduler
6. **HTTP Auth** (optional): Leave empty
7. Click **"Save"**

### Step 3: Test
1. Click **"Run"** to test
2. Check execution logs

---

## 🎯 Method 3: GitHub Actions (If Using GitHub)

**✅ Completely FREE**  
**✅ Most reliable**  
**✅ No external service needed**

### Step 1: Create Workflow File

Create `.github/workflows/update-currency-rates.yml` in your repository:

```yaml
name: Update Currency Rates

on:
  schedule:
    # Runs daily at 4:00 AM UTC (5:00 AM CET)
    - cron: '0 4 * * *'
  workflow_dispatch: # Allows manual trigger

jobs:
  update-rates:
    runs-on: ubuntu-latest
    steps:
      - name: Update Exchange Rates
        run: |
          curl -X POST https://vornify-server.onrender.com/api/settings/currencies/update \
            -H "Content-Type: application/json"
```

### Step 2: Commit and Push
```bash
git add .github/workflows/update-currency-rates.yml
git commit -m "Add daily currency rate update workflow"
git push
```

### Step 3: Verify
1. Go to your GitHub repository
2. Click **"Actions"** tab
3. You'll see the workflow scheduled
4. Click **"Run workflow"** to test immediately

**That's it!** GitHub will run this daily automatically.

---

## 🎯 Method 4: UptimeRobot (Monitoring + Cron)

**✅ FREE tier available**  
**✅ Can monitor your service AND trigger updates**

### Step 1: Sign Up
1. Go to [https://uptimerobot.com](https://uptimerobot.com)
2. Sign up for **free account** (50 monitors)

### Step 2: Create Monitor
1. Click **"Add New Monitor"**
2. **Monitor Type**: `HTTP(s)`
3. **Friendly Name**: `Update Exchange Rates`
4. **URL**: `https://vornify-server.onrender.com/api/settings/currencies/update`
5. **Monitoring Interval**: `Every 24 hours` (or set custom)
6. **HTTP Method**: `POST`
7. Click **"Create Monitor"**

**Note**: UptimeRobot is primarily for monitoring, but can trigger POST requests. For pure scheduling, use Method 1 or 2.

---

## Testing the Endpoint Manually

Before setting up any cron service, test the endpoint:

```bash
curl -X POST https://vornify-server.onrender.com/api/settings/currencies/update \
  -H "Content-Type: application/json"
```

**Expected response:**
```json
{
  "success": true,
  "updated": 7,
  "rates": [
    { "currency": "SEK", "rate": 11.24, "source": "ECB" },
    { "currency": "DKK", "rate": 7.46, "source": "ECB" },
    ...
  ],
  "timestamp": "2025-11-19T03:00:00.000Z",
  "source": "ECB",
  "fetchedFromECB": true
}
```

---

## Recommended Schedule Times

| Schedule | Time (UTC) | Time (CET) | Description |
|----------|------------|------------|-------------|
| `0 3 * * *` | 3:00 AM | 4:00 AM | Early morning |
| `0 4 * * *` | 4:00 AM | 5:00 AM | **Recommended** - After ECB updates |
| `0 5 * * *` | 5:00 AM | 6:00 AM | Later morning |

**Recommended**: `0 4 * * *` (4:00 AM UTC / 5:00 AM CET)
- ECB updates rates around 16:00 CET (previous day)
- Running at 5:00 AM CET ensures fresh rates are available

---

## Monitoring

### Check if Updates Are Working

**Via API:**
```bash
curl https://vornify-server.onrender.com/api/settings/currencies
```

Look for recent `lastUpdated` timestamps in the response.

**Via Backend Logs:**
Check your Render service logs for:
- `📡 Fetching exchange rates from ECB...`
- `✅ Fetched X exchange rates from ECB`
- `✅ Updated X exchange rates`

### Check Cron Service Logs

- **cron-job.org**: Go to your cronjob → View execution history
- **EasyCron**: Dashboard → View execution logs
- **GitHub Actions**: Repository → Actions tab → View workflow runs
- **UptimeRobot**: Dashboard → View monitor history

---

## Troubleshooting

### Updates Not Running

1. **Test endpoint manually first** - Use curl command above
2. **Check cron service status** - Verify job is enabled/active
3. **Check schedule** - Ensure timezone is correct (UTC vs CET)
4. **Check backend logs** - Look for incoming POST requests
5. **Verify URL** - Ensure endpoint URL is correct

### Rates Not Updating

1. **ECB API might be down** - System will use fallback rates
2. **Database connection issue** - Check MongoDB connection
3. **Check last update time** - Verify rates are actually being stored

### Old Rates Being Used

1. **Verify cron is running** - Check execution logs in cron service
2. **Check database** - Verify `lastUpdated` timestamp in `exchange_rates` collection
3. **Manual trigger** - Run curl command to force immediate update

---

## Fallback Behavior

The system is designed to never break:

1. **First priority**: Fresh rates from ECB (fetched daily)
2. **Second priority**: Last stored rates (even if expired)
3. **Third priority**: Default hardcoded rates

This ensures prices always display, even if:
- ECB API is down
- Cron job fails
- Database connection issues

---

## Security (Optional)

If you want to protect the update endpoint from unauthorized calls:

### Add API Key Protection

1. **Update route** (`routes/currency.js`):
```javascript
router.post('/settings/currencies/update', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.CURRENCY_UPDATE_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    // ... rest of code
});
```

2. **Add environment variable**:
```env
CURRENCY_UPDATE_API_KEY=your-secret-key-here
```

3. **Add header in cron service**:
- Header: `X-API-Key`
- Value: `your-secret-key-here`

**Note**: This is optional. The endpoint is safe to leave public since it only updates rates and doesn't expose sensitive data.

---

## Quick Start Summary

**Fastest setup (5 minutes):**

1. Go to [cron-job.org](https://cron-job.org)
2. Click **"Create cronjob"**
3. **URL**: `https://vornify-server.onrender.com/api/settings/currencies/update`
4. **Method**: `POST`
5. **Schedule**: Daily at 4:00 AM UTC
6. Click **"Create"**

**That's it!** The job will run daily automatically.

---

## Comparison of Methods

| Method | Free? | Setup Time | Reliability | Best For |
|--------|-------|------------|-------------|----------|
| **cron-job.org** | ✅ Yes | 5 min | ⭐⭐⭐⭐ | Quick setup |
| **EasyCron** | ✅ Yes | 10 min | ⭐⭐⭐⭐⭐ | More features |
| **GitHub Actions** | ✅ Yes | 10 min | ⭐⭐⭐⭐⭐ | If using GitHub |
| **UptimeRobot** | ✅ Yes | 10 min | ⭐⭐⭐ | Monitoring + updates |

**Recommendation**: Start with **cron-job.org** (easiest), or **GitHub Actions** if you use GitHub (most reliable).

---

**Last Updated**: November 2025  
**ECB API**: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml  
**Backend Endpoint**: `POST https://vornify-server.onrender.com/api/settings/currencies/update`  
**All Methods**: ✅ 100% FREE
