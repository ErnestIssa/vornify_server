# Order Tracking System - Backend API Documentation

## ✅ Implementation Status: COMPLETE

The order tracking system has been fully implemented and tested. All features are working as expected.

---

## 🎯 Implemented Features

### ✅ 1. Unique Order ID Generation
- Format: `PM` + 6 random digits (e.g., `PM632053`)
- Uniqueness is guaranteed through database check
- Auto-generated on order creation

### ✅ 2. Order Creation with Timeline
- Initial status: `processing`
- Initial timeline entry: "Order Placed"
- All required fields properly stored
- Timestamps automatically added

### ✅ 3. Order Tracking
- Query orders by `orderId`
- Returns complete order data including timeline
- Works through dedicated endpoint and VornifyDB

### ✅ 4. Status Updates
- Update order status with tracking information
- Automatically adds timeline entries
- Preserves all existing data

---

## 📡 API Endpoints

### 1. Create Order
**Endpoint:** `POST /api/orders/create`

**Request Body:**
```json
{
  "customer": {
    "name": "Customer Name",
    "email": "customer@example.com",
    "phone": "+46701234567"
  },
  "items": [
    {
      "productId": "prod_123",
      "name": "Peak Mode Training Shorts",
      "quantity": 1,
      "price": 499,
      "image": "https://...",
      "variant": {
        "color": "Black",
        "size": "M",
        "variantId": "variant_123"
      }
    }
  ],
  "totals": {
    "subtotal": 499,
    "discount": 0,
    "tax": 124.75,
    "shipping": 0,
    "total": 623.75
  },
  "shippingAddress": {
    "name": "Customer Name",
    "street": "Testgatan 123",
    "city": "Stockholm",
    "postalCode": "12345",
    "country": "Sweden",
    "phone": "+46701234567"
  },
  "billingAddress": {
    "name": "Customer Name",
    "street": "Testgatan 123",
    "city": "Stockholm",
    "postalCode": "12345",
    "country": "Sweden"
  },
  "paymentMethod": "card",
  "paymentStatus": "paid"
}
```

**Response:**
```json
{
  "success": true,
  "orderId": "PM632053",
  "data": {
    "acknowledged": true,
    "insertedId": "68dc917d2951c4dd2a684524"
  }
}
```

**Backend Auto-Adds:**
- `orderId` - Unique Order ID (PM + 6 digits)
- `status` - Initial status: "processing"
- `timeline` - Array with initial entry
- `createdAt` - ISO timestamp
- `updatedAt` - ISO timestamp
- `orderDate` - ISO timestamp
- `shippingProvider` - null (until shipped)
- `trackingNumber` - null (until shipped)
- `trackingUrl` - null (until shipped)
- `estimatedDelivery` - null (until shipped)

---

### 2. Track Order
**Endpoint:** `GET /api/orders/track/:orderId`

**Example:** `GET /api/orders/track/PM632053`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "68dc917d2951c4dd2a684524",
    "orderId": "PM632053",
    "customer": {
      "name": "Test Customer",
      "email": "test@peakmode.co",
      "phone": "+46701234567"
    },
    "items": [...],
    "totals": {...},
    "shippingAddress": {...},
    "billingAddress": {...},
    "paymentMethod": "card",
    "paymentStatus": "paid",
    "status": "shipped",
    "shippingProvider": "PostNord",
    "trackingNumber": "ABC123456789",
    "trackingUrl": "https://www.postnord.se/track?id=ABC123456789",
    "estimatedDelivery": "2025-10-07",
    "timeline": [
      {
        "status": "Order Placed",
        "date": "2025-10-01T02:27:09.391Z",
        "description": "Order received and payment confirmed"
      },
      {
        "status": "Shipped",
        "date": "2025-10-01T02:29:12.223Z",
        "description": "Order shipped with PostNord - Tracking: ABC123456789"
      }
    ],
    "createdAt": "2025-10-01T02:27:09.391Z",
    "updatedAt": "2025-10-01T02:29:12.223Z",
    "orderDate": "2025-10-01T02:27:09.391Z",
    "isPrivate": true
  }
}
```

---

### 3. Update Order Status (Admin)
**Endpoint:** `POST /api/orders/update-status`

**Request Body:**
```json
{
  "orderId": "PM632053",
  "status": "shipped",
  "shippingProvider": "PostNord",
  "trackingNumber": "ABC123456789",
  "trackingUrl": "https://www.postnord.se/track?id=ABC123456789",
  "estimatedDelivery": "2025-10-07"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Order status updated",
  "data": {
    "acknowledged": true,
    "modifiedCount": 1,
    "matchedCount": 1
  }
}
```

**What It Does:**
1. Finds the order by `orderId`
2. Updates the `status` field
3. Adds shipping fields (if provided)
4. Creates new timeline entry
5. Updates `updatedAt` timestamp

---

### 4. Get All Orders (Admin)
**Endpoint:** `GET /api/orders/all`

**Response:**
```json
{
  "success": true,
  "data": [
    { /* order 1 */ },
    { /* order 2 */ }
  ]
}
```

---

### 5. Get Orders by Customer Email
**Endpoint:** `GET /api/orders/customer/:email`

**Example:** `GET /api/orders/customer/test@peakmode.co`

**Response:**
```json
{
  "success": true,
  "data": [
    { /* order 1 */ },
    { /* order 2 */ }
  ]
}
```

---

## 🗄️ Database Schema

### Orders Collection Structure
```javascript
{
  _id: ObjectId,                      // MongoDB ID
  orderId: String,                    // ✅ UNIQUE! "PM123456"
  
  // Customer Information
  customer: {
    name: String,
    email: String,
    phone: String
  },
  
  // Order Items
  items: [
    {
      productId: String,
      name: String,
      quantity: Number,
      price: Number,
      image: String,
      variant: {                      // Optional
        color: String,
        size: String,
        variantId: String
      }
    }
  ],
  
  // Order Totals
  totals: {
    subtotal: Number,
    discount: Number,
    tax: Number,
    shipping: Number,
    total: Number
  },
  
  // Addresses
  shippingAddress: {
    name: String,
    street: String,
    city: String,
    postalCode: String,
    country: String,
    phone: String
  },
  billingAddress: {
    name: String,
    street: String,
    city: String,
    postalCode: String,
    country: String
  },
  
  // Payment
  paymentMethod: String,              // "card", "swish", etc.
  paymentStatus: String,              // "pending", "paid", "failed"
  
  // ⭐ TRACKING FIELDS
  status: String,                     // "processing", "confirmed", "shipped", "delivered", "cancelled"
  shippingProvider: String,           // "PostNord", "DHL", "Bring", etc. (nullable)
  trackingNumber: String,             // Carrier tracking number (nullable)
  trackingUrl: String,                // Full URL to carrier tracking (nullable)
  estimatedDelivery: String,          // ISO date string (nullable)
  
  // ⭐ TIMELINE
  timeline: [
    {
      status: String,                 // "Order Placed", "Shipped", "Delivered"
      date: String,                   // ISO date string
      description: String             // Human-readable description
    }
  ],
  
  // Timestamps
  createdAt: String,                  // ISO date string
  updatedAt: String,                  // ISO date string
  orderDate: String,                  // ISO date string (same as createdAt)
  
  // VornifyDB Default
  isPrivate: Boolean                  // Always true (auto-added by VornifyDB)
}
```

---

## 🔄 Order Status Flow

### Valid Status Values:
1. **`processing`** - Order received, being prepared
2. **`confirmed`** - Payment confirmed, ready to ship
3. **`shipped`** - In transit
4. **`delivered`** - Delivered to customer
5. **`cancelled`** - Order cancelled

### Typical Flow:
```
1. Order Created → status: "processing"
   Timeline: "Order Placed"

2. Admin Confirms → status: "confirmed" (optional)
   Timeline: "Payment confirmed, ready to ship"

3. Admin Ships → status: "shipped"
   Timeline: "Order shipped with [Provider] - Tracking: [Number]"
   + Add: shippingProvider, trackingNumber, trackingUrl, estimatedDelivery

4. Order Arrives → status: "delivered"
   Timeline: "Order has been delivered"
```

---

## 🧪 Testing Examples

### Test 1: Create Order
```bash
curl -X POST http://vornify-server.onrender.com/api/orders/create \
  -H "Content-Type: application/json" \
  -d '{
    "customer": {"name": "Test", "email": "test@test.com", "phone": "+46701234567"},
    "items": [{"productId": "p1", "name": "Test Product", "quantity": 1, "price": 499}],
    "totals": {"subtotal": 499, "discount": 0, "tax": 124.75, "shipping": 0, "total": 623.75},
    "shippingAddress": {"name": "Test", "street": "Street 1", "city": "Stockholm", "postalCode": "12345", "country": "Sweden", "phone": "+46701234567"},
    "billingAddress": {"name": "Test", "street": "Street 1", "city": "Stockholm", "postalCode": "12345", "country": "Sweden"},
    "paymentMethod": "card",
    "paymentStatus": "paid"
  }'
```

**Expected:** Returns `orderId` like `PM123456`

---

### Test 2: Track Order
```bash
curl http://vornify-server.onrender.com/api/orders/track/PM123456
```

**Expected:** Returns complete order with:
- ✅ `status: "processing"`
- ✅ `timeline` with 1 entry
- ✅ All order fields

---

### Test 3: Update Status
```bash
curl -X POST http://vornify-server.onrender.com/api/orders/update-status \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "PM123456",
    "status": "shipped",
    "shippingProvider": "PostNord",
    "trackingNumber": "ABC123",
    "trackingUrl": "https://www.postnord.se/track?id=ABC123",
    "estimatedDelivery": "2025-10-07"
  }'
```

**Expected:** Returns `success: true`

---

### Test 4: Track Updated Order
```bash
curl http://vornify-server.onrender.com/api/orders/track/PM123456
```

**Expected:** Returns order with:
- ✅ `status: "shipped"`
- ✅ `timeline` with 2 entries
- ✅ `shippingProvider: "PostNord"`
- ✅ `trackingNumber: "ABC123"`
- ✅ `trackingUrl: "https://..."`
- ✅ `estimatedDelivery: "2025-10-07"`

---

## 🔗 VornifyDB Integration

The order tracking system works seamlessly with VornifyDB. You can also query orders directly:

### Query Order via VornifyDB:
```javascript
POST /api/vornifydb
{
  "database_name": "peakmode",
  "collection_name": "orders",
  "command": "--read",
  "data": { "orderId": "PM123456" }
}
```

**Response:**
```javascript
{
  "success": true,
  "data": { /* complete order object */ }
}
```

### Query All Orders:
```javascript
POST /api/vornifydb
{
  "database_name": "peakmode",
  "collection_name": "orders",
  "command": "--read",
  "data": {}
}
```

**Response:**
```javascript
{
  "success": true,
  "data": [ /* array of all orders */ ]
}
```

---

## ✅ Checklist for Frontend Integration

- [x] Order ID generation (PM + 6 digits)
- [x] Unique Order ID validation
- [x] Initial timeline entry on creation
- [x] Order creation endpoint (`/api/orders/create`)
- [x] Order tracking endpoint (`/api/orders/track/:orderId`)
- [x] Status update endpoint (`/api/orders/update-status`)
- [x] Timeline array management
- [x] Shipping fields (provider, number, URL, delivery date)
- [x] Timestamp management (createdAt, updatedAt)
- [x] VornifyDB compatibility
- [x] All endpoints tested and working

---

## 🚀 Frontend Integration Points

### Customer Tracking Page
```javascript
// Fetch order by orderId
const response = await fetch(`https://vornify-server.onrender.com/api/orders/track/${orderId}`);
const { success, data } = await response.json();

if (success) {
  console.log('Order:', data.orderId);
  console.log('Status:', data.status);
  console.log('Timeline:', data.timeline);
  console.log('Tracking:', data.trackingNumber);
}
```

### Admin Status Update
```javascript
// Update order status
const response = await fetch('https://vornify-server.onrender.com/api/orders/update-status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orderId: 'PM123456',
    status: 'shipped',
    shippingProvider: 'PostNord',
    trackingNumber: 'ABC123',
    trackingUrl: 'https://www.postnord.se/track?id=ABC123',
    estimatedDelivery: '2025-10-07'
  })
});

const { success, message } = await response.json();
```

---

## 🎉 Everything is Ready!

The backend is fully implemented and tested. The frontend can now:
1. Create orders with unique Order IDs
2. Track orders using the Order ID
3. Display complete timeline
4. Show shipping information
5. Update order status from admin panel

**Test Order Available:** `PM632053`  
**Backend URL:** `https://vornify-server.onrender.com`

Happy coding! 🚀

