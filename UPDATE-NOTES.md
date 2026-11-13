# TSCART v1.0.7 — product controls and rolling announcement

## What was corrected

- The request-origin check could reject same-site admin saves/deletes when the browser used a different HTTPS hostname from APP_URL. It now accepts the current request host. Forwarded host/protocol headers are used only with TRUST_PROXY=true. Foreign origins, cross-site requests and missing request-protection headers remain blocked.
- New products now have **Published in the storefront** checked by default. Existing archived products remain archived. Saving an unpublished item explicitly says that it was saved as a draft.
- Delete and Archive now use an in-page confirmation showing the product name. This works without native browser confirmation popups. A failed deletion keeps the product and displays the server error in the dialog; success refreshes the product list. Existing order snapshots are preserved.
- Saves wait for both gallery-photo and description-media uploads. Product validation/server errors are visible, and entered form details remain available for correction and retry.
- The announcement bar now scrolls continuously, pauses on hover/focus, and has a pause/resume button. Reduced-motion preferences display a static message. Its text is still controlled in Admin → Settings.

## Install this fix

1. Stop your running server and back up the current project.
2. Replace the project code with the contents of this ZIP's `tscart` folder. **Keep your current `.env` and entire `data/` folder**; do not overwrite newer orders, products or settings with the archive's older snapshot.
3. Restart `START-WINDOWS.bat` (or your hosted backend), then press **Ctrl+F5**. Update the server files as well as `public/`; copying only the frontend cannot apply the server fix.

This archive preserves the private configuration and database supplied earlier. It contains no UI-fixture files or test data. Store it privately. The database and upload hosting arrangement has not been changed; this application still needs persistent, writable storage. No live deployment was modified or verified in this update.

## Verification and retained limitations

Three new HTTP regression tests pass: add/delete on the current HTTPS host, foreign-origin/cross-site rejection, and explicitly trusted reverse-proxy handling. The full suite has **48 passes and the same 4 previously documented failures** related to your retained login and checkout-check changes.

Browser checks used an isolated admin UI fixture with simulated data: new product creation with publishing enabled, edit/save, visible save error and successful retry, cancellation without deletion, visible deletion error, successful deletion, and refreshed product lists. Real authentication and database operations were checked through HTTP tests; no credentials were entered into the browser. The real storefront was checked for scrolling, pause/resume behavior, readable announcement text and horizontal overflow.

Your existing admin-cookie bypass and disabled checkout-readiness checks remain unchanged as previously requested. The previous version's features and setup notes follow below.

---

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
