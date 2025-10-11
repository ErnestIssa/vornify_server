# 🧪 Test New Email Endpoints - PowerShell Commands

## Prerequisites
Make sure your backend server is running locally or use the deployed URL.

---

## 🔧 Test Commands (PowerShell)

### 1. Test Newsletter Analytics
```powershell
Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/newsletter/analytics"
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "totalSubscribers": 10,
    "activeSubscribers": 8,
    "unsubscribed": 2,
    "totalCodes": 10,
    "usedCodes": 3,
    "expiredCodes": 1,
    "activeCodes": 6,
    "conversionRate": 30.00,
    "recentSubscribers": 5,
    "last30Days": 5
  }
}
```

---

### 2. Test Bulk Discount Reminders
```powershell
$body = @{
    emails = @("ernestissa32@gmail.com")
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/newsletter/send-bulk-reminders" -Method POST -ContentType "application/json" -Body $body
```

**Expected Response:**
```json
{
  "success": true,
  "sent": 1,
  "failed": 0,
  "total": 1,
  "results": [
    { "email": "ernestissa32@gmail.com", "success": true }
  ]
}
```

---

### 3. Test Email Stats
```powershell
Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/email/stats"
```

**Expected Response:**
```json
{
  "success": true,
  "stats": {
    "totalSent": 0,
    "delivered": 0,
    "failed": 0,
    "opened": 0,
    "byType": {
      "order": 0,
      "newsletter": 0,
      "authentication": 0,
      "customer": 0
    }
  }
}
```
*Note: Will show zeros until emails are logged*

---

### 4. Test Email Logs
```powershell
Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/email/logs?limit=10&offset=0&type=all"
```

**Expected Response:**
```json
{
  "success": true,
  "logs": [],
  "total": 0,
  "limit": 10,
  "offset": 0
}
```
*Note: Will be empty until emails are logged*

---

### 5. Test Unsubscribe
```powershell
$body = @{
    email = "ernestissa32@gmail.com"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/newsletter/unsubscribe" -Method POST -ContentType "application/json" -Body $body
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Successfully unsubscribed from newsletter"
}
```

---

## 🔄 Test Full Flow

### Step 1: Subscribe to Newsletter
```powershell
$body = @{
    email = "test@example.com"
    name = "Test User"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/newsletter/subscribe" -Method POST -ContentType "application/json" -Body $body
```

### Step 2: Get All Subscribers
```powershell
Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/newsletter/subscribers"
```

### Step 3: Get Analytics
```powershell
Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/newsletter/analytics"
```

### Step 4: Send Bulk Reminder
```powershell
$body = @{
    emails = @("test@example.com")
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/newsletter/send-bulk-reminders" -Method POST -ContentType "application/json" -Body $body
```

### Step 5: Unsubscribe
```powershell
$body = @{
    email = "test@example.com"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/newsletter/unsubscribe" -Method POST -ContentType "application/json" -Body $body
```

### Step 6: Verify Analytics Updated
```powershell
Invoke-RestMethod -Uri "https://vornify-server.onrender.com/api/newsletter/analytics"
```
*Should show unsubscribed count increased by 1*

---

## ✅ Success Criteria

All endpoints should return:
- ✅ `success: true` in response
- ✅ No error messages
- ✅ Correct data structure
- ✅ Proper status codes (200 for success, 400/404/500 for errors)

---

## 🐛 Troubleshooting

### Issue: "Failed to fetch subscribers"
- Check if VornifyDB is running
- Verify database connection

### Issue: "Subscriber not found" for bulk reminders
- Make sure subscriber email exists in database
- Check if email is spelled correctly

### Issue: "Discount code already used"
- This is expected if the code was already redeemed
- Create a new subscriber to test

### Issue: Empty stats/logs
- This is normal if no emails have been sent yet
- Email logging will populate automatically as emails are sent

---

## 📊 Next: Enable in Admin Panel

Once these tests pass, send this message to Admin AI:

```
All Priority 1 email endpoints are now implemented and tested! 🎉

Please update the admin panel to:
1. Use POST /api/newsletter/send-bulk-reminders for bulk sending
2. Use GET /api/newsletter/analytics for the analytics dashboard
3. Use GET /api/email/stats for email statistics
4. Use GET /api/email/logs for email logs
5. Enable the unsubscribe functionality

Remove all "Coming Soon" badges and workarounds for these features.
```

