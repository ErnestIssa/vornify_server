### Peak Mode Backend – Cloudinary + Email + Meta Catalog Feed Summary

This document summarizes **all backend work completed** in this repository, and what you should do next.

---

### Cloudinary integration (backend)

#### Step 3 – Cloudinary setup
- **Installed packages**
  - `cloudinary`
  - `multer-storage-cloudinary`
  - (kept existing) `multer`
- **Created** `config/cloudinary.js` (ENV-based only)
  - Uses:
    - `CLOUDINARY_CLOUD_NAME`
    - `CLOUDINARY_API_KEY`
    - `CLOUDINARY_API_SECRET`
- **Added a startup sanity log** in `app.js`:
  - Logs configured Cloudinary cloud name.

#### Step 4 – Unified upload endpoint (products only)
- **Created storage + upload middleware**
  - `middleware/cloudinaryStorage.js` (CloudinaryStorage configs)
  - `middleware/uploadProductImage.js` (multer instances for product/review/message/support)
- **Created controller**
  - `controllers/uploadController.js`
- **Created/registered route**
  - `routes/uploadRoutes.js`
  - Mounted in `app.js` as:
    - `app.use('/api/uploads', cloudinaryUploadRoutes);`
- **Product upload endpoint**
  - `POST /api/uploads/product-image`
  - multipart field name: `image`
  - Returns:
    - `{ url, public_id }`

#### Step 6 – Persist product image data in MongoDB
- Updated existing product create/update logic in `routes/products.js`:
  - Accepts `media` (Cloudinary URLs) and `imagePublicIds` (Cloudinary public_ids) from `req.body`
  - Validates:
    - if one exists the other must exist
    - `media.length` must equal `imagePublicIds.length`
  - Defaults both to empty arrays when missing
  - Saves directly to MongoDB via existing `db.executeOperation(...)`

#### Step 8 – Optional cleanup endpoint (products)
- Added:
  - `POST /api/uploads/cleanup-products`
- Logic:
  - Reads all product `imagePublicIds` from MongoDB
  - Lists all Cloudinary assets under `peakmode/products/`
  - Deletes only Cloudinary assets not referenced in MongoDB

#### Step 9 – Extended uploads: reviews / messages / support
Added folders + upload endpoints:
- Cloudinary folders:
  - `peakmode/reviews/`
  - `peakmode/messages/`
  - `peakmode/support/`
- Upload endpoints:
  - `POST /api/uploads/review` (field: `file`)
  - `POST /api/uploads/review/multiple` (field: `files`, max 10)
  - `POST /api/uploads/message` (field: `attachment`)
  - `POST /api/uploads/message/multiple` (field: `attachments`, max 10)
  - `POST /api/uploads/support` (field: `attachment`)
  - `POST /api/uploads/support/multiple` (field: `attachments`, max 10)
- Cleanup endpoints (same “safe orphan cleanup” approach):
  - `POST /api/uploads/cleanup-reviews`
  - `POST /api/uploads/cleanup-messages`
  - `POST /api/uploads/cleanup-support`

#### Fixes applied during rollout
- **AVIF support**
  - Added `avif` to `allowed_formats` for:
    - product uploads (`peakmode/products`)
    - support uploads (`peakmode/support`)
- **Consistent response structure to avoid frontend `.map()` crashes**
  - Support upload responses now include **both**:
    - `files: []`
    - `attachments: []`
  - (So the frontend can safely map either.)
- **Multer error handling**
  - Added `handleMulterError` middleware to key routes so format/size errors return a structured JSON response.

---

### SendGrid support-email automation

#### What was happening
- Support messages were being saved successfully, but email sending failed whenever a **placeholder template ID** was used.

#### What was changed
- The backend now:
  - Tries to send support emails via SendGrid
  - If a placeholder template ID is detected (e.g. `d-support_confirmation_template_id`), it **falls back to sending a plain text/html email** so users still receive confirmation.
- Added a test endpoint:
  - `POST /api/email/test-support`
  - Body: `{ "to": "...", "firstName": "...", "ticketId": "..." }`

#### Why your email looked different than the SendGrid template
- If the backend cannot find a valid SendGrid dynamic template ID at runtime, it uses the fallback plain email content.

#### Important Render env-var note
You had the correct SendGrid template ID stored under different key names (typos/variants), e.g.:
- `SENDGRID_SUPPORT_COMFIRMATION_TEMPLATE_ID` (typo)
- `SENDGRID_SUPPORT_CONFIRMATION_ID` (variant)
But the code expects:
- `SENDGRID_SUPPORT_CONFIRMATION_TEMPLATE_ID`

We updated the code to also check the typo/variant keys so it can still find the correct template ID.

---

### Meta (Facebook/Instagram) Commerce Manager product feed (CSV)

#### What was added
- A dynamic CSV feed endpoint backed by MongoDB:
  - **Route:** `GET /meta-feed.csv`
  - **File:** `routes/metaFeed.js`
  - Registered in `app.js` via `app.use('/', metaFeedRoutes);`

#### CSV columns included
`id,title,description,availability,condition,price,link,image_link,brand,gtin,mpn,shipping_weight,shipping_price`

#### How “automatic updates” work
- The CSV is generated **on every request** from MongoDB, so it always reflects your latest products.
- Meta will periodically re-fetch the URL when you enable scheduled updates in Commerce Manager.
- Response has a short cache header (5 minutes) to reduce load.

---

### What you should do next (you)

#### 1) Meta Commerce Manager – feed URL to paste
Use one of these:
- **Recommended (always works):**
  - `https://vornify-server.onrender.com/meta-feed.csv`
- **If your domain routes to this server:**
  - `https://peakmode.se/meta-feed.csv`

In Meta Commerce Manager:
- Catalog → Data Sources → Add Items → **Use URL**
- Paste the feed URL
- Choose schedule (daily is typical)

#### 2) (Optional but recommended) set the correct SendGrid template keys
In Render, set these to your real SendGrid dynamic template IDs:
- `SENDGRID_SUPPORT_CONFIRMATION_TEMPLATE_ID` = your SendGrid template ID (starts with `d-...`)
- `SENDGRID_SUPPORT_INBOX_TEMPLATE_ID` = your SendGrid template ID (starts with `d-...`)

This ensures the email matches your SendGrid template (and avoids fallback text).

#### 3) Security hardening (recommended)
- The cleanup endpoints should be **admin-protected** before exposing broadly:
  - `/api/uploads/cleanup-*`

#### 4) (Optional) remove the temporary startup log
- `app.js` currently logs Cloudinary config on startup. You can remove it once you’re confident everything is stable.

---

### Quick reference – key new/updated endpoints

#### Uploads
- `POST /api/uploads/product-image`
- `POST /api/uploads/review`
- `POST /api/uploads/review/multiple`
- `POST /api/uploads/message`
- `POST /api/uploads/message/multiple`
- `POST /api/uploads/support`
- `POST /api/uploads/support/multiple`

#### Cleanup (admin recommended)
- `POST /api/uploads/cleanup-products`
- `POST /api/uploads/cleanup-reviews`
- `POST /api/uploads/cleanup-messages`
- `POST /api/uploads/cleanup-support`

#### Meta feed
- `GET /meta-feed.csv`

#### Email test
- `POST /api/email/test-support`


