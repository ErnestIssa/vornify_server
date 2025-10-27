# Review Status Filtering - Implementation Complete

**Date:** Current Date  
**Status:** ✅ Complete and Ready

## Overview

The backend API now fully supports filtering reviews by approval status. This allows the frontend to:
- Display only approved reviews on public pages
- Show all reviews (including pending/rejected) in the admin panel
- Filter reviews by specific product

## Current Implementation

### ✅ GET /api/reviews Endpoint

The endpoint now supports the following query parameters:

**Query Parameters:**
- `status` - Filter by status (`approved`, `pending`, `rejected`, or omit for all)
- `productId` - Filter by specific product
- `source` - Filter by review source
- `rating` - Filter by rating (1-5)
- `verified` - Filter by verified purchase status
- `flagged` - Filter by flagged status
- `search` - Search in title, comment, product name, customer name
- `startDate` / `endDate` - Filter by date range
- `page` - Page number for pagination (default: 1)
- `limit` - Results per page (default: 50)
- `sortBy` - Field to sort by (default: createdAt)
- `sortOrder` - Sort order (`asc` or `desc`, default: desc)

### Implementation Details

**File:** `routes/reviews.js`

```javascript
// GET /api/reviews endpoint supports:
const { status, productId, ... } = req.query;

let query = {};

// Status filtering
if (status) query.status = status;

// Product filtering
if (productId) query.productId = productId;

// ... other filters
```

## API Usage Examples

### 1. Get All Reviews (Admin Panel)
```http
GET /api/reviews
```
**Response:** All reviews (pending, approved, rejected)

### 2. Get Approved Reviews Only (Public Pages)
```http
GET /api/reviews?status=approved
```
**Response:** Only approved reviews visible to public

### 3. Get Pending Reviews (Admin Panel)
```http
GET /api/reviews?status=pending
```
**Response:** Only pending reviews waiting for approval

### 4. Get Product-Specific Approved Reviews
```http
GET /api/reviews?productId=shorts&status=approved
```
**Response:** Only approved reviews for "shorts" product

### 5. Get Rejected Reviews (Admin Panel)
```http
GET /api/reviews?status=rejected
```
**Response:** Only rejected reviews

## Response Format

All endpoints return consistent format:

```json
{
  "success": true,
  "data": [
    {
      "id": "review-id",
      "productId": "product-id",
      "customerName": "John Doe",
      "customerEmail": "john@example.com",
      "rating": 5,
      "comment": "Great product!",
      "reviewSource": "product_page",
      "verifiedPurchase": true,
      "status": "approved",
      "images": ["base64..."],
      "location": "Stockholm",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T11:45:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 10,
    "pages": 1
  }
}
```

## Review Status Values

### Supported Status Values

1. **`pending`** - Newly submitted, waiting for admin approval
   - Created by default when user submits review
   - Not visible on public pages
   - Visible in admin panel for moderation

2. **`approved`** - Approved by admin, visible to public
   - Set by admin when approving review
   - Visible on all public pages
   - Shown in product detail pages

3. **`rejected`** - Rejected by admin, not visible to public
   - Set by admin when rejecting review
   - Hidden from public pages
   - Still stored for admin reference

### Default Status

When a review is created via `POST /api/reviews`:
- **Status is automatically set to:** `"pending"`
- **Requires admin approval** before being visible to public
- **Admin can approve/reject** via admin panel

## Frontend Integration

### Public Review Pages

**Code Example:**
```typescript
// Fetch only approved reviews for public display
const approvedReviews = await fetch('/api/reviews?status=approved');
```

### Admin Panel

**Code Example:**
```typescript
// Fetch all reviews for admin (no status filter)
const allReviews = await fetch('/api/reviews');

// Fetch pending reviews for moderation
const pendingReviews = await fetch('/api/reviews?status=pending');
```

### Product Detail Pages

**Code Example:**
```typescript
// Fetch approved reviews for specific product
const productReviews = await fetch(
  `/api/reviews?productId=${productId}&status=approved`
);
```

## Status Filtering Behavior

### Without Status Parameter
```
GET /api/reviews
```
**Returns:** ALL reviews (pending, approved, rejected)

**Use Case:** Admin panel to see all reviews

### With Status Parameter
```
GET /api/reviews?status=approved
```
**Returns:** ONLY approved reviews

**Use Case:** Public pages displaying reviews

### Combining Filters
```
GET /api/reviews?productId=shorts&status=approved&rating=5
```
**Returns:** ONLY 5-star approved reviews for "shorts" product

## Testing

### Test Cases

1. **Get All Reviews** ✅
   ```
   GET /api/reviews
   ```
   Expected: All reviews regardless of status

2. **Get Approved Reviews Only** ✅
   ```
   GET /api/reviews?status=approved
   ```
   Expected: Only approved reviews

3. **Get Pending Reviews** ✅
   ```
   GET /api/reviews?status=pending
   ```
   Expected: Only pending reviews

4. **Get Rejected Reviews** ✅
   ```
   GET /api/reviews?status=rejected
   ```
   Expected: Only rejected reviews

5. **Get Approved Reviews for Product** ✅
   ```
   GET /api/reviews?productId=shorts&status=approved
   ```
   Expected: Only approved reviews for "shorts" product

## Key Features

### ✅ Status Filtering
- Filter by `approved`, `pending`, or `rejected`
- No parameter returns all reviews
- Works with other filters

### ✅ Product Filtering
- Filter by specific `productId`
- Can combine with status filter
- Returns reviews for that product only

### ✅ Pagination
- Supports `page` and `limit` parameters
- Returns pagination metadata
- Sorted by creation date (newest first)

### ✅ Flexible Filtering
- Combine multiple filters
- Search functionality
- Date range filtering
- Rating filtering
- Verified purchase filtering

## Backend Database Query

The backend query now supports:

```javascript
// Example query object
{
  status: 'approved',        // Filter by status
  productId: 'shorts',       // Filter by product
  rating: 5,                 // Filter by rating
  verifiedPurchase: true,    // Filter by verified purchase
  // ... other filters
}
```

## Admin Workflow

### Review Submission
1. User submits review
2. Status set to `"pending"`
3. Review saved to database
4. Confirmation email sent to user

### Review Approval
1. Admin reviews pending reviews
2. Admin approves/rejects
3. Status updated to `"approved"` or `"rejected"`
4. Approved reviews become visible to public

## Public Display Behavior

### Reviews Page
- Shows only approved reviews
- Uses `?status=approved` filter
- Shows location, images, rating, comment
- Displays verified purchase badge when applicable

### Product Pages
- Shows only approved reviews for that product
- Uses `?productId={id}&status=approved` filter
- Sorted by most recent

### Admin Panel
- Shows all reviews (approved, pending, rejected)
- No status filter applied
- Admin can filter by status manually

## Important Notes

1. **Default Status**: New reviews are created with `status: "pending"`
2. **Filtering is Case-Sensitive**: Use lowercase (`approved`, not `Approved`)
3. **Public Pages**: Should always use `?status=approved` to hide pending/rejected
4. **Admin Panel**: Can omit status parameter to see all reviews
5. **Combined Filters**: Can combine status with productId, rating, etc.

## Status

✅ Status filtering implemented  
✅ Product filtering implemented  
✅ Pagination working  
✅ All query parameters supported  
✅ Backward compatible  
✅ No breaking changes  
✅ Ready for frontend integration

## Related Files

- `routes/reviews.js` - Updated GET endpoint with productId filtering
- Frontend review service - Uses status filtering
- Admin panel - Already has approval functionality

## Summary

The backend now fully supports review status filtering:

- ✅ Accepts `status` query parameter (approved, pending, rejected)
- ✅ Accepts `productId` query parameter
- ✅ Returns all reviews when no status parameter provided
- ✅ Filters reviews by status when parameter is provided
- ✅ Combines multiple filters (status + productId + rating, etc.)
- ✅ Pagination support
- ✅ Consistent response format

**Frontend can now:**
- Fetch approved reviews for public display
- Fetch all reviews for admin panel
- Fetch reviews for specific products
- Filter by multiple criteria

