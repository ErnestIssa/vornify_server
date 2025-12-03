# Fraktjakt Shipping Integration - Frontend Guide

---

**Subject: Fraktjakt API Integration - Fixed Service Point Locations**

Hi Frontend Team,

Great news! The Fraktjakt integration has been **fixed and updated** based on Fraktjakt support's response. Service points now correctly show locations **near the customer's address**, not the warehouse.

---

## ✅ What's Fixed

1. **Service Point Locations** - Now correctly shows service points near customer's address (not warehouse)
2. **Service Point Locator API** - New endpoint to get agents near customer address
3. **Service Point Selector API** - Updated to properly use `agent_id` (now required)

---

## 🎉 Current Status

**✅ Fraktjakt Query API: WORKING**  
**✅ Service Point Locator API: WORKING** (returns agents near customer)  
**✅ Service Point Selector API: FIXED** (requires agent_id)  
**✅ PostNord API: WORKING** (separate integration)

---

## Fraktjakt Integration - Implementation Guide

### Endpoint 1: Get Delivery Options + Service Points

**POST** `/api/shipping/fraktjakt-options`

This endpoint now returns:
- Delivery options (with pricing)
- Service points near customer's address (automatically included)

#### Request Format

```json
{
  "country": "SE",              // Required: Country code (ISO 2-letter)
  "postalCode": "11363",         // Required: Postal/ZIP code
  "street": "Solnavägen 3",      // Required: Street address
  "city": "Stockholm",           // Optional: City name
  "weight": 1.5,                 // Optional: Parcel weight in kg (default: 1.0)
  "length": 30,                   // Optional: Length in cm (default: 30)
  "width": 20,                   // Optional: Width in cm (default: 20)
  "height": 10                   // Optional: Height in cm (default: 10)
}
```

#### Response Format

```json
{
  "success": true,
  "deliveryOptions": [
    {
      "id": "fraktjakt_12345",
      "carrier": "PostNord Sverige AB",
      "name": "Standard Delivery",
      "description": "PostNord Sverige AB - Standard Delivery",
      "cost": 49.00,
      "tax": 9.80,
      "totalCost": 58.80,
      "currency": "SEK",
      "estimatedDays": "2-3 business days",
      "trackingEnabled": true,
      "serviceCode": "12345",
      "serviceId": "12345",
      "type": "fraktjakt",
      "shipmentId": "10800268",
      "accessCode": "01d9f19682857b719cc7df6c541edd59"
    }
    // ... more delivery options
  ],
  "servicePoints": [
    {
      "agentId": 170777,
      "name": "Coop Hagastaden",
      "address": {
        "street": "Hälsingegatan 57",
        "city": "STOCKHOLM",
        "postalCode": "11366",
        "country": "SE"
      },
      "distance": 0.120377834683629,
      "coordinate": {
        "latitude": 59.348014,
        "longitude": 18.036633
      },
      "openingHours": {
        "overrides": { ... },
        "default": []
      },
      "shipper": "PostNord Sverige AB",
      "shipperId": 1
    }
    // ... more service points (up to 20)
  ],
  "shipmentId": "10800268",
  "accessCode": "01d9f19682857b719cc7df6c541edd59",
  "address": {
    "country": "SE",
    "postalCode": "11363",
    "street": "Solnavägen 3",
    "city": "Stockholm"
  },
  "warehouse": {
    "country": "SE",
    "postalCode": "74639",
    "city": "Bålsta",
    "street": "Kapellgatan 10"
  },
  "parcel": {
    "weight": 1.5,
    "length": 30,
    "width": 20,
    "height": 10
  },
  "currency": "SEK",
  "timestamp": "2024-12-02T23:58:09.382Z"
}
```

#### Response Fields Explained

**Delivery Options:**
- `id` - Unique identifier
- `carrier` - Carrier name (e.g., "PostNord Sverige AB", "DHL", "UPS")
- `name` - Service name
- `cost` - Base price (SEK)
- `tax` - Tax amount (SEK)
- `totalCost` - Total price including tax
- `estimatedDays` - Delivery time estimate
- `shipmentId` - Required for Service Point Selector API
- `accessCode` - Required for Service Point Selector API

**Service Points:**
- `agentId` - **REQUIRED** for Service Point Selector API
- `name` - Service point name
- `address` - Full address (street, city, postalCode, country)
- `distance` - Distance from customer address (in km)
- `coordinate` - Latitude/longitude for maps
- `openingHours` - Opening hours information
- `shipper` - Carrier name
- `shipperId` - Carrier ID

---

### Endpoint 2: Get Service Points (Standalone)

**GET** `/api/shipping/fraktjakt-service-point-locator`

Get service points near a customer address without getting delivery options.

#### Request Parameters (Query String)

```
?country=se&city=Stockholm&street=Solnavägen 3&postal_code=11363&locale=sv
```

- `country` - **Required**: Country code (lowercase, e.g., "se")
- `city` - Optional: City name
- `street` - Optional: Street address
- `postal_code` - Optional: Postal code
- `locale` - Optional: Language (default: "sv")

#### Response Format

```json
{
  "success": true,
  "agents": [
    {
      "agentId": 170777,
      "name": "Coop Hagastaden",
      "address": {
        "street": "Hälsingegatan 57",
        "city": "STOCKHOLM",
        "postalCode": "11366",
        "country": "SE"
      },
      "distance": 0.120377834683629,
      "coordinate": {
        "latitude": 59.348014,
        "longitude": 18.036633
      },
      "openingHours": { ... },
      "shipper": "PostNord Sverige AB",
      "shipperId": 1
    }
    // ... more agents
  ],
  "count": 20,
  "address": {
    "country": "se",
    "city": "Stockholm",
    "street": "Solnavägen 3",
    "postal_code": "11363"
  },
  "timestamp": "2024-12-02T23:58:09.382Z"
}
```

---

### Endpoint 3: Select Service Point for Shipment

**GET** `/api/shipping/fraktjakt-service-points`

Select a specific service point (agent) for a shipment. **Requires `agent_id`** (from service points list).

#### Request Parameters (Query String)

```
?shipment_id=10800268&access_code=01d9f19682857b719cc7df6c541edd59&agent_id=170777&locale=sv
```

- `shipment_id` - **Required**: From delivery options response
- `access_code` - **Required**: From delivery options response
- `agent_id` - **Required**: From service points list (`agentId`)
- `locale` - Optional: Language (default: "sv")

#### Response Format

```json
{
  "success": true,
  "data": { ... },  // Response from Fraktjakt (could be HTML, XML, or JSON)
  "contentType": "text/html",
  "shipmentId": "10800268",
  "accessCode": "01d9f19682857b719cc7df6c541edd59",
  "agentId": "170777",
  "timestamp": "2024-12-02T23:58:09.382Z"
}
```

**Note:** This API may return HTML (for client-side service point selection) or JSON/XML. The response format depends on Fraktjakt's implementation.

---

## Frontend Implementation

### Basic Integration Flow

```javascript
// Step 1: Get delivery options and service points
async function getFraktjaktShippingOptions(address, parcel) {
  try {
    const response = await fetch('/api/shipping/fraktjakt-options', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        country: address.country,
        postalCode: address.postalCode,
        street: address.street,
        city: address.city,
        weight: parcel.weight,
        length: parcel.length,
        width: parcel.width,
        height: parcel.height
      })
    });

    const data = await response.json();

    if (data.success) {
      return {
        deliveryOptions: data.deliveryOptions,
        servicePoints: data.servicePoints,  // ✅ Now includes service points near customer!
        shipmentId: data.shipmentId,
        accessCode: data.accessCode
      };
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.error('Error fetching Fraktjakt options:', error);
    throw error;
  }
}

// Step 2: When customer selects a service point, call Service Point Selector API
async function selectServicePoint(shipmentId, accessCode, agentId) {
  try {
    const response = await fetch(
      `/api/shipping/fraktjakt-service-points?shipment_id=${shipmentId}&access_code=${accessCode}&agent_id=${agentId}&locale=sv`,
      {
        method: 'GET'
      }
    );

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error selecting service point:', error);
    throw error;
  }
}
```

### React Example

```jsx
import { useState, useEffect } from 'react';

function FraktjaktShippingOptions({ address, parcel, onSelect }) {
  const [options, setOptions] = useState(null);
  const [servicePoints, setServicePoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedServicePoint, setSelectedServicePoint] = useState(null);

  useEffect(() => {
    if (address?.country && address?.postalCode && address?.street) {
      fetchOptions();
    }
  }, [address]);

  const fetchOptions = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/shipping/fraktjakt-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country: address.country,
          postalCode: address.postalCode,
          street: address.street,
          city: address.city,
          weight: parcel?.weight || 1.0,
          length: parcel?.length || 30,
          width: parcel?.width || 20,
          height: parcel?.height || 10
        })
      });

      const data = await response.json();

      if (data.success) {
        setOptions(data.deliveryOptions);
        setServicePoints(data.servicePoints || []);  // ✅ Service points near customer!
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to load shipping options');
    } finally {
      setLoading(false);
    }
  };

  const handleServicePointSelection = async (agentId) => {
    if (!options || !options[0]) return;
    
    const shipmentId = options[0].shipmentId;
    const accessCode = options[0].accessCode;
    
    try {
      const result = await selectServicePoint(shipmentId, accessCode, agentId);
      setSelectedServicePoint(agentId);
      onSelect({ ...options[0], agentId, servicePointSelected: true });
    } catch (err) {
      console.error('Error selecting service point:', err);
    }
  };

  if (loading) return <div>Loading delivery options...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!options) return null;

  return (
    <div className="shipping-options">
      <h3>Select Delivery Method</h3>
      
      {/* Delivery Options */}
      <section>
        <h4>Delivery Options</h4>
        {options.map(option => (
          <div key={option.id} className="option-card">
            <input 
              type="radio" 
              name="shipping" 
              value={option.id}
              onChange={() => onSelect(option)}
            />
            <label>
              <div className="option-header">
                <span className="carrier">{option.carrier}</span>
                <span className="service-name">{option.name}</span>
              </div>
              <div className="option-description">{option.description}</div>
              <div className="option-meta">
                <span className="delivery-time">{option.estimatedDays}</span>
                <span className="price">{option.totalCost} {option.currency}</span>
              </div>
            </label>
          </div>
        ))}
      </section>

      {/* Service Points (if available) */}
      {servicePoints.length > 0 && (
        <section>
          <h4>Service Points Near You ({servicePoints.length} locations)</h4>
          <div className="service-points-list">
            {servicePoints.map(point => (
              <div 
                key={point.agentId} 
                className={`service-point-card ${selectedServicePoint === point.agentId ? 'selected' : ''}`}
                onClick={() => handleServicePointSelection(point.agentId)}
              >
                <div className="service-point-name">{point.name}</div>
                <div className="service-point-address">
                  {point.address.street}, {point.address.postalCode} {point.address.city}
                </div>
                {point.distance && (
                  <div className="service-point-distance">
                    {point.distance.toFixed(2)} km away
                  </div>
                )}
                {point.shipper && (
                  <div className="service-point-carrier">
                    {point.shipper}
                  </div>
                )}
                {point.coordinate && (
                  <div className="service-point-map">
                    <a 
                      href={`https://www.google.com/maps?q=${point.coordinate.latitude},${point.coordinate.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View on Map
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

---

## Important Notes

### 1. Service Point Selection Flow

1. **Get delivery options** → Returns delivery options + service points near customer
2. **Customer selects delivery option** → Choose carrier/service
3. **Customer selects service point** → Choose specific pickup location
4. **Call Service Point Selector API** → Confirm selection with `agent_id`

### 2. Service Points Location

✅ **FIXED:** Service points now show locations **near the customer's address**, not the warehouse.

- Service points are automatically included in `fraktjakt-options` response
- Or use standalone `fraktjakt-service-point-locator` endpoint
- Each service point has `agentId` which is **required** for Service Point Selector API

### 3. Service Point Selector API

⚠️ **IMPORTANT:** The Service Point Selector API **requires `agent_id`**.

- Get `agent_id` from service points list (`agentId` field)
- Get `shipment_id` and `access_code` from delivery options response
- All three are required: `shipment_id`, `access_code`, `agent_id`

### 4. Combining with PostNord

You now have **two shipping providers**:

1. **PostNord** - `POST /api/shipping/options`
   - Returns: home, servicePoint, parcelLocker, mailbox
   - Multiple service point/parcel locker locations
   - No pricing (cost: 0)

2. **Fraktjakt** - `POST /api/shipping/fraktjakt-options`
   - Returns: Multiple carriers (DHL, PostNord, UPS)
   - Includes pricing
   - Service points near customer address ✅

**Recommended Approach:**
- Show both providers' options
- Let customers choose their preferred provider
- Use Fraktjakt for pricing, PostNord for service point locations (or use Fraktjakt for both)

---

## Testing

You can test with these addresses:

```javascript
// Stockholm
{
  "country": "SE",
  "postalCode": "11363",
  "street": "Solnavägen 3",
  "city": "Stockholm",
  "weight": 1.5,
  "length": 30,
  "width": 20,
  "height": 10
}

// Borås
{
  "country": "SE",
  "postalCode": "50333",
  "street": "Lilla Brogatan 31",
  "city": "Borås",
  "weight": 1.0,
  "length": 30,
  "width": 20,
  "height": 10
}
```

**Expected:**
- Delivery options with pricing
- 15-20 service points near customer address (not warehouse)
- Each service point has `agentId` for selection

---

## Error Handling

### Missing Required Fields (400)
```json
{
  "success": false,
  "error": "Missing required fields: country, postalCode, and street are required"
}
```

### API Errors
```json
{
  "success": false,
  "error": "Error message here",
  "status": 400,
  "details": "Additional details"
}
```

### Service Point Selector API (Missing agent_id)
```json
{
  "success": false,
  "error": "Missing required parameters: shipment_id, access_code, and agent_id are all required"
}
```

---

## Summary

✅ **Fraktjakt integration is fixed and working**  
✅ **Service points now show near customer address** (not warehouse)  
✅ **Service Point Locator API integrated**  
✅ **Service Point Selector API requires agent_id**  
✅ **All endpoints tested and working**  

**Next Steps:**
1. Integrate the `fraktjakt-options` endpoint into checkout
2. Display delivery options with pricing
3. Show service points near customer address
4. Allow customers to select a service point
5. Call Service Point Selector API when service point is selected
6. Combine with PostNord options for comprehensive delivery choices

The backend is complete and tested. Ready for frontend integration! 🚀

---

