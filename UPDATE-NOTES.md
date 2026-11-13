# TSCART v1.0.6 — update to your edited version

## Changes

- Every product card and product detail page has a Buy Now button. The detail-page quantity is respected. Buy Now checks out that product and leaves the existing shopping bag intact.
- Delivery is free on all new COD and Razorpay orders. The backend ignores old delivery-fee settings. Historical order totals remain unchanged.
- Every product has customer reviews with a 1–5-star rating, an average score and a review count. Reviews persist in the database. Visitors can submit a display name, rating and review; reviews are not labeled as verified purchases. Admins can delete reviews from the product editor.
- Admin → Products → Add product/Edit now includes **Media in the description**. Upload JPG, PNG, WebP or GIF images (up to 5 MB each), MP4/WebM videos or MP3/WAV audio (up to 20 MB each). You can also add direct HTTPS media URLs. Add captions, reorder or remove media, then save the product. Up to 10 media items appear below its description text; the existing product gallery works as before.

The storefront design, product deletion, order-management flow, Razorpay integration and your existing login/checkout changes are retained.

## Updating your computer

1. Stop the running server and back up your current project folder.
2. Extract the ZIP. Copy the contents of its `tscart` folder into your current project, replacing the code files. **Keep your current `.env` and entire `data/` folder** if you have made changes or received orders since uploading the RAR. Do not overwrite newer data with the archive's snapshot.
3. Start `START-WINDOWS.bat` as before, then press Ctrl+F5 in the browser. The reviews table is created automatically; there is no database-reset step.

For a separate copy, extract to a new folder and run `START-WINDOWS.bat` there. The ZIP includes your uploaded configuration and data snapshot, unchanged. It contains no preview reviews, orders or media created during this update. Keep this archive private because it includes your store's configuration and data.

## Preserved issue in your edited version

As you selected, your login changes were kept. The existing backend accepts any non-empty `tscart_session` cookie as admin access and ignores expiry, so an unauthenticated person can obtain admin access by setting that cookie. Logout and password changes do not reliably invalidate it. This is a known issue in the supplied version, not a security guarantee of this update.

Your disabled checkout-readiness and unconfigured-payment guards are also retained. Payment signature/capture verification code has not been changed. Live provider payments were not exercised.

## Verification

- All 10 new feature tests pass: free delivery for both payment methods, preservation of historical order totals, Buy Now bag isolation, rating aggregation/validation, review pagination/deletion/persistence, safe rendered text, and image/video/audio upload validation, persistence and streaming.
- Full suite: **45 passed, 4 failed**. The same four failures occurred before this update in your supplied source. They concern session invalidation, unconfigured Razorpay checkout and disabled live-checkout readiness checks. Existing tests were retained.
- Browser checks confirmed product-card Buy Now, checkout of only the chosen item, zero delivery charge, successful demo COD receipt, preservation of the shopping bag, review submission and five-star average display.
- An isolated copy of your uploaded database passed integrity checks. All nine existing tables' records, original order secret and configuration were preserved. New reviews start empty. Authenticated admin features were tested through HTTP; a signed-in admin browser session and real Razorpay transactions were not exercised.

Earlier release reports in `docs/VERIFICATION.md` are historical; this report describes this archive.
