# Your TSCART store

A complete, portable store for home essentials. Start here; the detailed guides are in `docs/`.

**v1.0.7 fix:** Product creation publishes by default; same-site admin requests work on alternate site addresses; Delete/Archive use an in-page confirmation with visible errors. The announcement bar scrolls. Update both server and frontend files, keep your current `.env` and `data/`, restart, and press Ctrl+F5. See `UPDATE-NOTES.md`.

**v1.0.6 product update:** Buy Now buttons, free delivery on all new orders, customer reviews with 1–5-star ratings, and image/video/audio attachments in product descriptions. See `UPDATE-NOTES.md` for update instructions and the known limitations preserved from your edited version.

**v1.0.5 admin orders:** All customer addresses, contact details, items, quantities, totals and payment statuses are saved directly in Admin → Orders → View. No messaging setup is needed. To update, stop the server, replace the project files while keeping `data/` and `.env`, restart, and press Ctrl+F5. Existing orders, products and payment settings are preserved.

**v1.0.4 product deletion:** Admin → Products now has a Delete button beside each product and in the product editor. Confirm to permanently remove a product; past orders and their item details stay intact. Archive is still available when you only want to hide an item.

**v1.0.3 Windows correction:** If the original ZIP showed an unstyled loading screen, stop the server and copy this ZIP’s `tscart` contents over your existing `tscart` folder. Allow file replacements, keep `data/` and `.env`, restart `START-WINDOWS.bat`, and press Ctrl+F5.

## Open it in five minutes

1. Install **Node.js 24.x LTS** from https://nodejs.org/ (the application targets major version 24).
2. Extract this ZIP. Open the `tscart` folder.
3. On Windows, double-click **START-WINDOWS.bat**. On macOS/Linux, open a terminal in this folder and run `sh start.sh`.
4. Visit **http://localhost:3000**. Keep the terminal open while using the store.
5. Visit **http://localhost:3000/admin** to manage the store.

Alternatively, use `npm run setup` followed by `npm start`. You do **not** need `npm install`. Node provides the server, SQLite database, cryptography and API client.

**First admin login**

| Field | Value |
|---|---|
| Email | `tscart@gmai.com` |
| Password | `TSCART123` |

The email intentionally uses **gmai.com**, exactly as requested. These are first-run credentials, not a hidden login bypass. After changing the password in Admin → Settings, the starter password stops working. Changing ADMIN_INITIAL_PASSWORD later does not reset an existing account.

The store starts in **demo mode**. COD test orders work and are saved, but no real order is dispatched. The included products and photos are a sample catalogue; replace them with your own supplier-backed products before selling.

## What is included

- Responsive storefront, custom SVG branding, local images and fonts.
- Product pages, categories, search, sorting, persistent bag and quantity controls.
- Indian-address checkout with COD selected by default.
- Razorpay order creation, hosted checkout, server signature verification, capture checks and signed webhooks.
- Admin product creation/editing, up to eight photos per product, local uploads, price/stock controls, publish/archive, permanent deletion with confirmation, and homepage features.
- Saved customer names, phone numbers, emails, full delivery addresses, delivery notes, item names/quantities/prices, totals, payment statuses, fulfilment statuses, tracking notes, CSV export and payment reconciliation.
- Shipping thresholds, contact details and editable delivery/returns copy.
- Hashed admin passwords, HttpOnly sessions, request protection, login limits, private order links and server-calculated prices.
- Tests, Docker configuration, backup script and setup documentation.

## Ask your friend for these

**Razorpay:** a merchant Payment Gateway account with activation/KYC completed for live payments; the **Test Key ID + Test Key Secret** for testing; later the **Live Key ID + Live Key Secret**; a separate webhook signing secret; and confirmation that automatic payment capture is enabled. A Razorpay app or QR code alone is not an API integration. Your friend can enter secrets directly in the host environment instead of sending them to you. You do not need their password, OTP, bank login or UPI PIN.

**Store details:** legal/business name and address, support email/phone, supplier-approved product photos/descriptions, real stock and prices, serviceable PIN codes, delivery timelines and return/refund terms. Fulfilment is manual via the admin panel; no supplier ordering or courier booking API is included.

Detailed, field-by-field instructions: `docs/RAZORPAY.md`.

## Before accepting real orders

1. Sign in, set a new password of at least 12 characters in Admin → Settings, then sign in again.
2. Replace or archive the sample products. Add real product details and photos. Set prices in rupees and available stock.
3. Enter the real business address, support email and delivery/returns terms in Settings. Review all policy pages for your business.
4. Deploy the app with a **persistent writable data directory and HTTPS**. See `docs/DEPLOYMENT.md`.
5. In `.env` or your host environment, set `APP_URL` to your full HTTPS domain and `NODE_ENV=production`. Set `STORE_MODE=live` to enable actual order handling. Restart after environment changes.
6. Place a test COD order on a staging copy and check its customer, address, item and payment details in Admin → Orders → View.
7. Test Razorpay with test credentials on a staging copy. Then switch to live credentials, configure the live webhook, set `REQUIRE_LIVE_KEYS=true` and complete one small genuine transaction and refund with the account owner.
8. Back up `data/` and confirm that orders, uploaded images and sign-ins survive a restart.

Your edited version disables the live-checkout readiness checks; this update preserves that behavior. The admin integration status only checks whether settings are present; it cannot prove that payment credentials are valid. Your existing session-validation bypass is also preserved as requested; see `UPDATE-NOTES.md`.

## Customer data handling

Checkout saves the customer’s name, phone number, optional email, delivery address, notes, item details and totals directly in the database. Authorised admins can view these in Admin → Orders. COD orders are confirmed immediately; online orders appear as awaiting payment until Razorpay capture is verified. Checkout retains a notice and checkbox explaining use of details for order fulfilment.

## Practical limits

This version is designed for one always-on Node process and modest store traffic. SQLite and uploads need persistent disk; this is **not a static-only site or an unmodified Vercel serverless deployment**. This ZIP retains the private configuration and data from your uploaded archive. Razorpay is implemented and tested with a simulated provider, but requires your account, hosting and live verification. Payment fees, hosting and fulfilment costs are external.

Online orders reserve stock until payment or manual cancellation; there is no automatic reservation expiry. Review abandoned payments in admin. This avoids silently releasing stock while a payment may still capture. A captured payment received after cancellation is flagged for review and is not automatically dispatched. Cancel/refund actions are separate; issue refunds in Razorpay. See `docs/OPERATIONS.md`.

## Commands

| Command | Purpose |
|---|---|
| `npm run setup` | Create `.env` without overwriting an existing file |
| `npm start` | Start the app |
| `npm test` | Run database, checkout, payment and admin tests |
| `npm run backup` | Snapshot SQLite and copy uploaded images/order secret |

Main folders: `public/` (storefront), `server/` (backend), `scripts/` (setup/backup), `tests/`, `docs/`. The `data/` folder is created automatically on first launch and must stay private.
