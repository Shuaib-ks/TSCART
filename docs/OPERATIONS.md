# Running the store

## Products

Admin → Products → Add product. Enter a name, URL slug, category, rupee price, available stock, description, specifications and photos. Check Published to show the product. Check Featured to include it in the first four homepage products. New category names appear as collection filters. The editorial home-category cards and top navigation remain Kitchen, Living and Bath; edit `public/js/app.js` if you want to rebrand those sections.

Uploaded JPEG, PNG and WebP files are limited to 5 MB each and saved under `data/uploads/`. Use up to eight images. HTTPS image URLs are also supported; local uploads avoid reliance on another image host. SVG uploads are intentionally rejected. Archive hides a product without damaging historical orders. Edit the archived product and check Published to restore it.

To permanently remove a product, choose **Delete** in the product list or **Delete product** in its editor, then confirm. It disappears from both the storefront and admin catalogue. This cannot be undone in the panel; use Archive if you may want to restore it later. Existing orders keep their item names, quantities, prices and images, and still need fulfilment. Deletion does not cancel or refund an order. Uploaded images are retained for historical receipts and other products that may share them.

New checkouts cannot buy deleted items. Cancelling an existing order restores stock only for products that still exist; it does not recreate a deleted product. A stale editor tab cannot recreate a deleted product by saving it. You can add a new product with the same name and URL slug; it receives a new identity.

Available stock excludes quantities reserved by existing orders. If checkout changes stock while an admin edits a product, saving is rejected until the product is reloaded. When updating stock from a supplier, account for outstanding reserved units; the app does not synchronise inventory with your supplier.

## COD order flow

1. Checkout saves a confirmed order, reserves stock and makes its details available in Admin → Orders.
2. Check the admin order, verify serviceability and arrange supplier fulfilment.
3. Move Confirmed → Processing → Shipped. Add courier name and tracking reference.
4. Move Shipped → Delivered after delivery.
5. Check “COD money has been collected” only after receiving/confirming the collection. Delivery alone does not mark the money collected.

The admin is the source of truth. Use the TSCART order reference to fulfil each order once.

## Online orders and reservations

An online order begins as `awaiting_payment`. It reserves stock, then uses one Razorpay order for payment attempts. Captured payment changes it to Confirmed. Webhooks and browser verification both use the same idempotent transition. A failed attempt does not override a successful payment.

There is deliberately no automatic stock-release timer. Review abandoned online orders in admin. Before cancelling, inspect the Razorpay dashboard for authorised or captured payments. Complete any required refund/capture decision, then confirm the review checkbox and cancel. Cancellation restores stock once. A later capture is recorded as paid + `needs_review` and is not automatically sent for fulfilment.

Interrupted payment-order creation becomes `needs_review` in its gateway state. Find the Razorpay order by its TSCART receipt, and enter the provider order ID in the admin reconciliation form. The server verifies receipt, currency and amount before attaching it and checks for a captured payment.

Refunds are performed in the Razorpay dashboard. This release does not implement a refund API or automatic refund-status synchronisation. The payment record retains the original capture; the revenue card therefore reflects captured/collected amounts, not net revenue after manual refunds. Maintain your refund ledger separately.

## Customer confirmations

Customers receive an on-screen order reference and private confirmation link. They can copy that link to revisit the status. Its token is stored in browser session storage, not exposed in the normal page URL. The copied link contains the token in the URL fragment and should be kept private. The app does not send customer email/SMS confirmations; an email field is optional contact information only.

## View customer and order details

Open **Admin → Orders → View** to see the customer's name, phone, optional email, full delivery address, delivery notes, item names, quantities, prices, shipping, total, payment method/status and tracking details. Orders are saved at checkout and remain available after restarting the server. Reload the Orders page to see the latest orders.

Online orders also appear before payment is completed, marked Awaiting payment. Fulfil only confirmed orders; use payment reconciliation if a payment needs review. Order records and all existing product/payment settings are preserved when updating the app; keep `data/` and `.env`.

## Export and retention

Admin → Orders → Export CSV exports up to the latest 500 orders shown. The CSV includes private delivery/customer information; share it only with authorised fulfilment staff. Formula-leading characters are neutralised before export. Demo orders are labelled and excluded from the collected-revenue summary.

SQLite holds complete order history beyond the 500-order admin window. For larger stores, add pagination/reporting or migrate to a managed database before reaching that operational limit. Establish your own retention period and support process; there is no customer self-service data deletion or tax filing system in this release.

## Password and backups

Changing the password invalidates all current admin sessions. The starter credentials only seed a new database and are not a recovery backdoor. Back up before maintenance. Recovery of a lost administrator password requires a trusted server operator to update the stored hash; do not delete the production database to reset the login.

Keep `.env`, `data/`, logs and backups private. Never commit live secrets or customer records to Git. The package includes no customer database or live credentials.
