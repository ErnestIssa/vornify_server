# 🛒 Cart & Product API System - Complete Implementation

**Date:** January 2025  
**Backend URL:** `https://vornify-server.onrender.com`  
**Database:** VornifyDB (MongoDB)

---

## 🎉 NEW CART & PRODUCT ENDPOINTS IMPLEMENTED

### ✅ Cart Management System (`/api/cart`)

| Endpoint | Method | Description | Status |
|----------|--------|-------------|--------|
| `GET /api/cart/:userId` | GET | Get user's cart with variant support | ✅ WORKING |
| `POST /api/cart/:userId/add` | POST | Add item to cart with size/color variants | ✅ WORKING |
| `PUT /api/cart/:userId/update` | PUT | Update cart item quantity | ✅ WORKING |
| `DELETE /api/cart/:userId/remove/:cartItemId` | DELETE | Remove specific item from cart | ✅ WORKING |
| `DELETE /api/cart/:userId/clear` | DELETE | Clear entire cart | ✅ WORKING |
| `POST /api/cart/:userId/apply-discount` | POST | Apply discount code to cart | ✅ WORKING |

### ✅ Product Management System (`/api/products`)

| Endpoint | Method | Description | Status |
|----------|--------|-------------|--------|
| `GET /api/products/:id` | GET | Get product by ID with complete inventory | ✅ WORKING |
| `GET /api/products` | GET | Get all products with filtering | ✅ WORKING |
| `POST /api/products` | POST | Create new product (admin) | ✅ WORKING |
| `PUT /api/products/:id` | PUT | Update product (admin) | ✅ WORKING |
| `DELETE /api/products/:id` | DELETE | Delete product (admin) | ✅ WORKING |
| `GET /api/products/:id/variants` | GET | Get product variants only | ✅ WORKING |

---

## 🛒 CART API DETAILED DOCUMENTATION

### 1. **Get User Cart**
```javascript
GET /api/cart/:userId

Response:
{
  "success": true,
  "data": {
    "userId": "user123",
    "items": [
      {
        "cartItemId": "cart_1704067200000_abc123",
        "id": "prod_001",
        "name": "Peak Mode Training Shorts",
        "price": 499,
        "image": "https://example.com/shorts.jpg",
        "size": "M",
        "color": "Black",
        "sizeId": "size_m_001",
        "colorId": "color_black_001",
        "variantId": "variant_black_m_001",
        "quantity": 2,
        "currency": "SEK",
        "source": "shop",
        "addedAt": "2025-01-01T12:00:00.000Z"
      }
    ],
    "totals": {
      "subtotal": 998,
      "tax": 249.5,
      "shipping": 0,
      "discount": 0,
      "total": 1247.5
    },
    "createdAt": "2025-01-01T12:00:00.000Z",
    "updatedAt": "2025-01-01T12:00:00.000Z"
  }
}
```

### 2. **Add Item to Cart**
```javascript
POST /api/cart/:userId/add

Request Body:
{
  "id": "prod_001",
  "name": "Peak Mode Training Shorts",
  "price": 499,
  "image": "https://example.com/shorts.jpg",
  "size": "M",
  "color": "Black",
  "sizeId": "size_m_001",
  "colorId": "color_black_001",
  "variantId": "variant_black_m_001",
  "quantity": 1,
  "currency": "SEK",
  "source": "shop"
}

Response:
{
  "success": true,
  "message": "Item added to cart",
  "data": { /* Updated cart object */ }
}
```

**Features:**
- ✅ **Variant Support** - Handles sizeId, colorId, variantId fields
- ✅ **Duplicate Detection** - Merges items with same product + variant
- ✅ **Auto ID Generation** - Generates unique cartItemId if not provided
- ✅ **Validation** - Validates required fields and data types
- ✅ **Totals Calculation** - Auto-calculates cart totals

### 3. **Update Cart Item Quantity**
```javascript
PUT /api/cart/:userId/update

Request Body:
{
  "cartItemId": "cart_1704067200000_abc123",
  "quantity": 3
}

Response:
{
  "success": true,
  "message": "Cart item updated",
  "data": { /* Updated cart object */ }
}
```

**Features:**
- ✅ **Quantity Validation** - Prevents negative quantities
- ✅ **Auto Removal** - Removes item if quantity set to 0
- ✅ **Totals Update** - Recalculates cart totals

### 4. **Remove Item from Cart**
```javascript
DELETE /api/cart/:userId/remove/:cartItemId

Response:
{
  "success": true,
  "message": "Item removed from cart",
  "data": { /* Updated cart object */ }
}
```

### 5. **Clear Entire Cart**
```javascript
DELETE /api/cart/:userId/clear

Response:
{
  "success": true,
  "message": "Cart cleared successfully"
}
```

### 6. **Apply Discount Code**
```javascript
POST /api/cart/:userId/apply-discount

Request Body:
{
  "discountCode": "PEAK10-ABC123"
}

Response:
{
  "success": true,
  "message": "Discount applied successfully",
  "data": {
    "appliedDiscount": {
      "code": "PEAK10-ABC123",
      "value": 10,
      "appliedAt": "2025-01-01T12:00:00.000Z"
    },
    "totals": {
      "subtotal": 998,
      "tax": 249.5,
      "shipping": 0,
      "discount": 99.8,
      "total": 1147.7
    }
  }
}
```

---

## 📦 PRODUCT API DETAILED DOCUMENTATION

### 1. **Get Product by ID**
```javascript
GET /api/products/:id

Response:
{
  "success": true,
  "data": {
    "id": "prod_001",
    "name": "Peak Mode Training Shorts",
    "description": "High-performance training shorts",
    "price": 499,
    "category": "clothing",
    "images": ["https://example.com/shorts1.jpg"],
    "inventory": {
      "colors": [
        {
          "id": "color_black_001",
          "name": "Black",
          "hex": "#000000",
          "available": true,
          "sortOrder": 0
        },
        {
          "id": "color_navy_001",
          "name": "Navy",
          "hex": "#1a237e",
          "available": true,
          "sortOrder": 1
        }
      ],
      "sizes": [
        {
          "id": "size_s_001",
          "name": "S",
          "description": "Small",
          "available": true,
          "sortOrder": 0
        },
        {
          "id": "size_m_001",
          "name": "M",
          "description": "Medium",
          "available": true,
          "sortOrder": 1
        }
      ],
      "variants": [
        {
          "id": "variant_black_s_001",
          "colorId": "color_black_001",
          "sizeId": "size_s_001",
          "sku": "PM-SHORTS-BLK-S",
          "price": 499,
          "stock": 10,
          "available": true,
          "images": ["https://example.com/shorts-black-s.jpg"],
          "sortOrder": 0
        },
        {
          "id": "variant_black_m_001",
          "colorId": "color_black_001",
          "sizeId": "size_m_001",
          "sku": "PM-SHORTS-BLK-M",
          "price": 499,
          "stock": 15,
          "available": true,
          "images": ["https://example.com/shorts-black-m.jpg"],
          "sortOrder": 1
        }
      ]
    },
    "active": true,
    "featured": true,
    "createdAt": "2025-01-01T12:00:00.000Z",
    "updatedAt": "2025-01-01T12:00:00.000Z"
  }
}
```

**Features:**
- ✅ **Complete Inventory Data** - Colors, sizes, variants with stock info
- ✅ **Variant Processing** - Auto-generates IDs and validates structure
- ✅ **Stock Information** - Real-time stock levels per variant
- ✅ **Image Support** - Variant-specific images

### 2. **Get All Products**
```javascript
GET /api/products?category=clothing&featured=true&limit=10

Response:
{
  "success": true,
  "data": [
    { /* Product objects with inventory */ }
  ],
  "count": 5
}
```

**Query Parameters:**
- `category` - Filter by product category
- `featured` - Filter featured products (true/false)
- `limit` - Limit number of results

### 3. **Create Product (Admin)**
```javascript
POST /api/products

Request Body:
{
  "name": "Peak Mode Training Shorts",
  "description": "High-performance training shorts",
  "price": 499,
  "category": "clothing",
  "images": ["https://example.com/shorts.jpg"],
  "inventory": {
    "colors": [
      {
        "name": "Black",
        "hex": "#000000",
        "available": true
      }
    ],
    "sizes": [
      {
        "name": "M",
        "description": "Medium",
        "available": true
      }
    ],
    "variants": [
      {
        "colorId": "color_black_001",
        "sizeId": "size_m_001",
        "sku": "PM-SHORTS-BLK-M",
        "price": 499,
        "stock": 15,
        "available": true
      }
    ]
  },
  "active": true,
  "featured": false
}

Response:
{
  "success": true,
  "message": "Product created successfully",
  "data": { /* Created product object */ }
}
```

### 4. **Update Product (Admin)**
```javascript
PUT /api/products/:id

Request Body:
{
  "name": "Updated Product Name",
  "inventory": {
    "variants": [
      {
        "id": "variant_black_m_001",
        "stock": 20
      }
    ]
  }
}

Response:
{
  "success": true,
  "message": "Product updated successfully",
  "data": { /* Updated product object */ }
}
```

### 5. **Delete Product (Admin)**
```javascript
DELETE /api/products/:id

Response:
{
  "success": true,
  "message": "Product deleted successfully"
}
```

### 6. **Get Product Variants**
```javascript
GET /api/products/:id/variants

Response:
{
  "success": true,
  "data": [
    {
      "id": "variant_black_m_001",
      "colorId": "color_black_001",
      "sizeId": "size_m_001",
      "sku": "PM-SHORTS-BLK-M",
      "price": 499,
      "stock": 15,
      "available": true,
      "images": ["https://example.com/shorts-black-m.jpg"],
      "sortOrder": 0
    }
  ]
}
```

---

## 🗄️ DATABASE SCHEMA UPDATES

### **Cart Collection** (`peakmode.carts`)
```javascript
{
  userId: String (unique),
  items: [
    {
      cartItemId: String (unique),
      id: String (product ID),
      name: String,
      price: Number,
      image: String,
      size: String | null,        // Display name
      color: String | null,       // Display name
      sizeId: String | null,      // Database ID
      colorId: String | null,     // Database ID
      variantId: String | null,   // Combined variant ID
      quantity: Number,
      currency: String,
      source: String | null,
      addedAt: ISO Date String
    }
  ],
  totals: {
    subtotal: Number,
    tax: Number,
    shipping: Number,
    discount: Number,
    total: Number
  },
  appliedDiscount: {
    code: String,
    value: Number,
    appliedAt: ISO Date String
  } | null,
  createdAt: ISO Date String,
  updatedAt: ISO Date String
}
```

### **Product Collection** (`peakmode.products`)
```javascript
{
  id: String (unique),
  name: String,
  description: String,
  price: Number,
  category: String,
  images: [String],
  inventory: {
    colors: [
      {
        id: String,
        name: String,
        hex: String,
        available: Boolean,
        sortOrder: Number
      }
    ],
    sizes: [
      {
        id: String,
        name: String,
        description: String,
        available: Boolean,
        sortOrder: Number
      }
    ],
    variants: [
      {
        id: String,
        colorId: String,
        sizeId: String,
        sku: String,
        price: Number,
        stock: Number,
        available: Boolean,
        images: [String],
        sortOrder: Number
      }
    ]
  },
  active: Boolean,
  featured: Boolean,
  createdAt: ISO Date String,
  updatedAt: ISO Date String
}
```

### **Order Collection** (`peakmode.orders`) - Updated
```javascript
{
  orderId: String (unique),
  items: [
    {
      // ... existing order item fields
      sizeId: String | null,      // NEW: Database ID
      colorId: String | null,     // NEW: Database ID
      variantId: String | null,   // NEW: Combined variant ID
      size: String | null,       // NEW: Display name
      color: String | null       // NEW: Display name
    }
  ],
  // ... rest of order fields
}
```

---

## 🔄 ORDER PROCESSING INTEGRATION

### **Updated Order Creation**
The order creation endpoint now preserves all variant information from cart items:

```javascript
POST /api/orders/create

Request Body:
{
  "customer": { /* customer info */ },
  "items": [
    {
      "id": "prod_001",
      "name": "Peak Mode Training Shorts",
      "price": 499,
      "quantity": 2,
      "sizeId": "size_m_001",
      "colorId": "color_black_001",
      "variantId": "variant_black_m_001",
      "size": "M",
      "color": "Black"
    }
  ],
  "totals": { /* totals */ },
  "shippingAddress": { /* address */ }
}

Response:
{
  "success": true,
  "orderId": "PM123456",
  "data": { /* Order with variant information preserved */ }
}
```

**Features:**
- ✅ **Variant Preservation** - All sizeId, colorId, variantId fields maintained
- ✅ **Display Names** - Size and color display names included
- ✅ **Order Tracking** - Variant info available in order tracking
- ✅ **Email Integration** - Order emails include variant details

---

## 🚀 FRONTEND INTEGRATION READY

### **Cart Service Integration**
Your frontend cart service can now use these endpoints:

```javascript
// Add item to cart
const addToCart = async (userId, item) => {
  const response = await fetch(`/api/cart/${userId}/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: item.id,
      name: item.name,
      price: item.price,
      sizeId: item.sizeId,
      colorId: item.colorId,
      variantId: item.variantId,
      size: item.size,
      color: item.color,
      quantity: item.quantity
    })
  });
  return response.json();
};

// Get user cart
const getCart = async (userId) => {
  const response = await fetch(`/api/cart/${userId}`);
  return response.json();
};

// Update cart item
const updateCartItem = async (userId, cartItemId, quantity) => {
  const response = await fetch(`/api/cart/${userId}/update`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cartItemId, quantity })
  });
  return response.json();
};
```

### **Product Service Integration**
Your frontend product service can now use:

```javascript
// Get product with complete inventory
const getProductById = async (productId) => {
  const response = await fetch(`/api/products/${productId}`);
  return response.json();
};

// Get all products
const getProducts = async (filters = {}) => {
  const params = new URLSearchParams(filters);
  const response = await fetch(`/api/products?${params}`);
  return response.json();
};
```

---

## ✨ SUMMARY

**New Endpoints Added:** 12  
**Cart Features:** 6 endpoints with variant support  
**Product Features:** 6 endpoints with inventory management  
**Database Collections:** 2 (carts, products)  
**Order Integration:** Updated to preserve variant information  
**Frontend Ready:** Complete API compatibility with your cart system  

---

## 🧪 Testing the New APIs

### **Test Cart Operations:**
```bash
# Add item to cart
curl -X POST http://localhost:10000/api/cart/user123/add \
  -H "Content-Type: application/json" \
  -d '{
    "id": "prod_001",
    "name": "Test Product",
    "price": 499,
    "sizeId": "size_m_001",
    "colorId": "color_black_001",
    "variantId": "variant_black_m_001",
    "size": "M",
    "color": "Black",
    "quantity": 1
  }'

# Get cart
curl http://localhost:10000/api/cart/user123

# Update cart item
curl -X PUT http://localhost:10000/api/cart/user123/update \
  -H "Content-Type: application/json" \
  -d '{"cartItemId": "cart_1704067200000_abc123", "quantity": 2}'
```

### **Test Product Operations:**
```bash
# Get product with inventory
curl http://localhost:10000/api/products/prod_001

# Get all products
curl http://localhost:10000/api/products?featured=true&limit=5
```

---

**Last Updated:** January 2025  
**Status:** ✅ Complete - All Cart & Product APIs Ready
