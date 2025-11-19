# 🕐 Render Cron Job Setup for Exchange Rates

## Overview
This guide explains how to set up a scheduled job on Render.com to automatically update exchange rates daily from the ECB (European Central Bank).

## Why Daily Updates?
- ECB updates rates once per day (around 16:00 CET)
- Daily updates ensure accurate pricing for EU customers
- Prevents stale rates from affecting conversions

## Setup Instructions

### Step 1: Access Render Dashboard
1. Log in to [Render Dashboard](https://dashboard.render.com)
2. Navigate to your service: `vornify-server`

### Step 2: Create Scheduled Job
1. In your service dashboard, go to **"Scheduled Jobs"** or **"Cron Jobs"** section
2. Click **"New Scheduled Job"** or **"Add Cron Job"**

### Step 3: Configure the Job

**Job Settings:**
- **Name**: `Update Exchange Rates`
- **Schedule**: `0 3 * * *` (runs daily at 3:00 AM CET / 2:00 AM UTC)
  - Alternative: `0 4 * * *` (4:00 AM CET) - after ECB updates
- **Method**: `POST`
- **URL**: `https://vornify-server.onrender.com/api/settings/currencies/update`
- **Headers**: 
  - `Content-Type: application/json`
  - (Optional) Add authentication header if you implement auth for this endpoint

### Step 4: Test the Endpoint Manually

Before setting up the cron, test the endpoint:

```bash
curl -X POST https://vornify-server.onrender.com/api/settings/currencies/update \
  -H "Content-Type: application/json"
```

Expected response:
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

### Step 5: Verify in Database

After the job runs, verify rates are stored:

```javascript
// Check exchange_rates collection
{
  "currency": "SEK",
  "baseCurrency": "EUR",
  "rate": 11.24,
  "lastUpdated": "2025-11-19T03:00:00.000Z",
  "source": "ECB"
}
```

## Cron Schedule Options

| Schedule | Description | Time (CET) |
|----------|-------------|------------|
| `0 3 * * *` | Daily at 3:00 AM | 3:00 AM |
| `0 4 * * *` | Daily at 4:00 AM | 4:00 AM (recommended) |
| `0 5 * * *` | Daily at 5:00 AM | 5:00 AM |
| `0 */6 * * *` | Every 6 hours | Multiple times per day |

**Recommended**: `0 4 * * *` (4:00 AM CET) - runs after ECB updates rates

## Monitoring

### Check Job Logs
1. Go to Render Dashboard → Your Service → Scheduled Jobs
2. Click on the job name
3. View execution logs and history

### Check Application Logs
Look for these log messages:
- `📡 Fetching exchange rates from ECB...`
- `✅ Fetched X exchange rates from ECB`
- `✅ Updated X exchange rates`

### Error Handling
If the job fails:
- ECB API might be temporarily unavailable
- System will use last stored rates (fallback)
- Default rates will be used if no stored rates exist
- Check logs for specific error messages

## Manual Update

You can also trigger updates manually:

**Via API:**
```bash
curl -X POST https://vornify-server.onrender.com/api/settings/currencies/update
```

**Via Render Dashboard:**
1. Go to Scheduled Jobs
2. Click "Run Now" on the job

## Fallback Behavior

The system is designed to never break:
1. **First priority**: Fresh rates from ECB (fetched daily)
2. **Second priority**: Last stored rates (even if expired)
3. **Third priority**: Default hardcoded rates

This ensures prices always display, even if:
- ECB API is down
- Cron job fails
- Database connection issues

## Troubleshooting

### Job Not Running
- Check Render service status
- Verify cron syntax is correct
- Check Render logs for errors

### Rates Not Updating
- Test endpoint manually first
- Check ECB API is accessible
- Verify database connection
- Check application logs

### Old Rates Being Used
- Verify cron job is running
- Check `lastUpdated` timestamp in database
- Manually trigger update to refresh

## Security (Optional)

If you want to protect the update endpoint:

1. Add authentication header requirement
2. Use environment variable for API key
3. Update route to check auth:

```javascript
router.post('/settings/currencies/update', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.CURRENCY_UPDATE_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    // ... rest of code
});
```

Then add header in Render cron job:
- Header: `X-API-Key`
- Value: Your API key from environment variables

## Support

If you encounter issues:
1. Check Render service logs
2. Test endpoint manually
3. Verify ECB API is accessible
4. Check database connection

---

**Last Updated**: November 2025
**ECB API**: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml

