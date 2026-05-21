**Still optional later**
Migrate Reviews.tsx page to useApprovedReviewsQuery (same pattern as PDP)
Route cart line getProductById through queryClient everywhere (Navbar already prefetches)
Wire currencyDisplayService through apiCall for ETag on VAT/currency raw fetch

for the followign purpose:
 only if you want maximum polish: finish the 3 storefront optional items, add CDN for static assets + API, or add Redis if you scale to multiple backend instances.