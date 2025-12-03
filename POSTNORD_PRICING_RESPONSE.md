# PostNord Delivery Options Pricing - Backend Response

---

**Subject: PostNord Pricing - Delivery Options API vs Booking API**

Hi Frontend Team,

Thank you for the detailed question about PostNord pricing. I've investigated the PostNord API response and here's what I found:

---

## 🔍 Investigation Results

### 1. **PostNord Delivery Options API - No Pricing Included**

I've checked the **raw PostNord API response**, and confirmed that:

- ✅ **The Delivery Options API does NOT include pricing information**
- ✅ **This is expected behavior** - PostNord's Delivery Options API is designed to show available delivery methods, not prices
- ✅ **All options correctly show `cost: 0`** - this is not a bug, it's a limitation of the API

**Raw Response Structure:**
```json
{
  "bookingInstructions": {
    "deliveryOptionId": "...",
    "serviceCode": "17"
  },
  "descriptiveTexts": { ... },
  "deliveryTime": { ... },
  "sustainability": { ... }
  // ❌ NO pricing fields (price, cost, fee, amount, charge, etc.)
}
```

### 2. **Service Code Analysis**

I've analyzed the service codes returned from actual API calls:

- **Service Code 17**: Home delivery
- **Service Code 19**: Service points AND Parcel lockers (same code for both types)
- **Service Code 11**: Standard mailbox delivery
- **Service Code 86**: Fast/Express mailbox delivery

**Important Findings:**
- ✅ Service codes **are different** per delivery type (17, 19, 11, 86)
- ✅ Multiple options can have the same service code (e.g., all 6 service points use code 19)
- ✅ Each option has a **unique `deliveryOptionId`** (even if same service code)
- ✅ The `deliveryOptionId` is what you should use to identify/select a specific option
- ⚠️ Service points and parcel lockers share the same service code (19), but are differentiated by `type` field

---

## 💡 Solutions

PostNord has a **separate Booking API** that provides pricing, but it requires:
1. Creating a shipment/booking request
2. Different authentication/credentials
3. More complex integration

We have **3 options**:

### **Option 1: Integrate PostNord Booking API** (Recommended for accurate pricing)

**Pros:**
- ✅ Real-time, accurate pricing from PostNord
- ✅ Includes all fees and surcharges
- ✅ Updates automatically if PostNord changes prices

**Cons:**
- ❌ Requires additional API integration
- ❌ May need different API credentials
- ❌ More complex (requires creating a booking request to get pricing)

**Implementation:**
- Would need to call Booking API for each delivery option
- Could be slow if calling for all options
- May need to cache pricing

---

### **Option 2: Implement Pricing Table Based on Service Codes** (Quick solution)

**Pros:**
- ✅ Fast implementation
- ✅ No additional API calls needed
- ✅ Full control over pricing

**Cons:**
- ❌ Requires manual price updates
- ❌ May not match PostNord's exact pricing
- ❌ Need to handle different countries/regions

**Implementation:**
```javascript
// Pricing table based on service codes
const POSTNORD_PRICING = {
  '17': { // Home delivery
    'SE': { base: 49, perKg: 5 }, // Sweden
    'FI': { base: 79, perKg: 8 }, // Finland
    'DK': { base: 69, perKg: 7 }, // Denmark
    // ... other countries
  },
  '19': { // Service point / Parcel locker (same code for both)
    'SE': { base: 39, perKg: 3 },
    'FI': { base: 59, perKg: 5 },
    'DK': { base: 49, perKg: 4 },
  },
  '11': { // Standard mailbox
    'SE': { base: 29, perKg: 2 },
    'FI': { base: 49, perKg: 4 },
    'DK': { base: 39, perKg: 3 },
  },
  '86': { // Fast/Express mailbox
    'SE': { base: 49, perKg: 4 },
    'FI': { base: 69, perKg: 6 },
    'DK': { base: 59, perKg: 5 },
  }
};
```

**Note:** These are example prices - you'll need to get actual PostNord pricing or use their Booking API for accurate costs.

**Note:** You would need to:
1. Get parcel weight from the order
2. Calculate: `cost = base + (weight * perKg)`
3. Apply pricing based on recipient country and service code

---

### **Option 3: Display Options Without Prices** (Simplest)

**Pros:**
- ✅ No additional work needed
- ✅ Can calculate pricing at checkout/order confirmation
- ✅ Use Fraktjakt for pricing (which already includes costs)

**Cons:**
- ❌ Customers don't see shipping cost until later
- ❌ May reduce conversion (customers prefer transparent pricing)

**Implementation:**
- Show delivery options with estimated delivery times
- Calculate/display pricing at checkout when order weight is known
- Or use Fraktjakt API which already includes pricing

---

## 📊 Current Response Data

Here's what we're currently returning (and what's available):

```json
{
  "id": "dcafca895a9741cfb84539bf48425ba8",
  "type": "home",
  "name": "Home delivery",
  "description": "Nordic Swan Ecolabelled delivery...",
  "cost": 0,  // ❌ Always 0 (not available in Delivery Options API)
  "currency": "SEK",
  "estimatedDays": "1-3",
  "serviceCode": "17",  // ✅ Unique per delivery type
  "deliveryOptionId": "dcafca895a9741cfb8...",  // ✅ Unique per option
  "location": { ... },  // ✅ Available for service points/parcel lockers
  "sustainability": { ... }  // ✅ Eco-label info
}
```

**Available Fields:**
- ✅ `serviceCode` - Differentiates delivery types (17=home, 19=service/locker, 11=mailbox, 86=express mailbox)
- ✅ `deliveryOptionId` - Unique ID for each option (even if same service code)
- ✅ `location` - **Full location details for service points/parcel lockers** (see below)
- ✅ `estimatedDays` - Delivery time estimate
- ✅ `sustainability` - Eco-label information
- ❌ `cost` - Not available (always 0)

**Location Data Structure (for Service Points & Parcel Lockers):**
```json
{
  "location": {
    "name": "Hemköp Torsplan",
    "distanceFromRecipientAddress": 189,  // meters
    "address": {
      "countryCode": "SE",
      "postCode": "11365",
      "city": "STOCKHOLM",
      "streetName": "Norra Stationsgatan",
      "streetNumber": "80C"
    },
    "coordinate": {
      "latitude": 59.3464001,
      "longitude": 18.0336962
    },
    "openingHours": {
      "regular": {
        "monday": { "open": true, "timeRanges": [{"from": "09:00", "to": "20:00"}] },
        // ... other days
      },
      "deviations": [
        {
          "date": "2025-12-24",
          "reason": "Christmas Eve",
          "openHours": { ... }
        }
      ]
    }
  }
}
```

**✅ Location Data is Available!**
- All service point options include full location details
- All parcel locker options include full location details
- Each option has a unique location (name, address, coordinates, distance, opening hours)
- Customers can choose their preferred service point/parcel locker location

---

## 🎯 Recommendations

### **Short-term (Quick Fix):**
1. **Use Fraktjakt API for pricing** - It already includes costs
2. **Show PostNord options without prices** - Display as "Price calculated at checkout"
3. **Or implement a simple pricing table** based on service codes and country

### **Long-term (Best Solution):**
1. **Integrate PostNord Booking API** for accurate pricing
2. **Or use a hybrid approach:**
   - Use PostNord for delivery options (better location accuracy)
   - Use Fraktjakt for pricing (already working)
   - Match them by delivery type

---

## 🔧 What We Can Do Next

### **Option A: Add Pricing Table to Backend**
I can implement a pricing table in the backend that calculates costs based on:
- Service code
- Recipient country
- Parcel weight (from order)

**Request:** Would need parcel weight in the request, or we calculate from order items.

### **Option B: Integrate PostNord Booking API**
I can integrate PostNord's Booking API to get real-time pricing.

**Request:** Need to check if we have Booking API access, or need to request it from PostNord.

### **Option C: Hybrid Approach**
- Keep PostNord for delivery options
- Use Fraktjakt for pricing
- Match them in the frontend

---

## 📝 Questions for You

1. **Do you have parcel weight available** when calling the shipping options endpoint?
   - If yes, I can implement Option A (pricing table)
   - If no, we need to get it from the order/cart

2. **Which approach do you prefer?**
   - A) Pricing table (quick, but manual updates)
   - B) PostNord Booking API (accurate, but more complex)
   - C) Show without prices / use Fraktjakt pricing

3. **Do you want to contact PostNord** about Booking API access for pricing?

---

## 📋 Summary

**Current Situation:**
- ✅ PostNord Delivery Options API is working correctly
- ✅ All options are being returned properly
- ✅ **Service point and parcel locker locations ARE included** with full details (name, address, coordinates, distance, opening hours)
- ✅ Customers can choose from multiple service point/parcel locker locations
- ❌ Pricing is NOT included in Delivery Options API (this is expected)
- ✅ Service codes are different per delivery type (17, 19, 11, 86)
- ✅ Each option has a unique `deliveryOptionId` (even if same service code)

**Location Data:**
- ✅ Service points: 5-6 locations per address, each with full location details
- ✅ Parcel lockers: 5 locations per address, each with full location details
- ✅ Each location includes: name, full address, coordinates, distance from recipient, opening hours
- ✅ Customers can see and select their preferred pickup location

**Next Steps:**
1. Decide on pricing approach (table, Booking API, or no pricing)
2. If pricing table: provide parcel weight in request or get from order
3. If Booking API: check access/permissions with PostNord

**Recommendation:** 
- **Short-term:** Use Fraktjakt for pricing (already working) or implement simple pricing table
- **Long-term:** Integrate PostNord Booking API for accurate pricing

---

Let me know which approach you'd like to take, and I'll implement it!

**Backend Team**

---

